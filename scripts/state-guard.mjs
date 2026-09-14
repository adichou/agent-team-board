#!/usr/bin/env node
// PreToolUse 守卫 —— 确定性拦截 Agent 的越权操作（REQ-20260901-003 扩展后含两层）。
// 由 hooks 配置以两种模式调起（ZCode 用 hooks/hooks.json 的 process schema，
// Codex 用 hooks/codex.json 的 command schema——BUG-20260906-014），hook 输入 JSON 从 stdin 读取：
//   state-guard.mjs file  ① Write/Edit 直写 docs/agent-team-board/**/status.json
//                         ② 无有效认领锁时 Write/Edit 本插件源码（scripts/commands/skills/hooks/manifest 等）
//   state-guard.mjs bash  ① 改写 intent 触碰 status.json（cat 等只读放行）
//                         ② atb status <ID> accepted|planned|done（人工专属）
//                         ③ curl 打 Status Board 人工 API
//                         ④ 无有效认领锁时 Bash 改写本插件源码（sed/tee/重定向等）
//                         ⑤ 流程外 git commit（仅看板项目内；REQ-20260911-009——系统自动
//                            提交不经 Agent Bash；REQ-20260911-010 起 CMT 豁免已随回退移除）
// 放行条件（源码保护）：当前项目看板 .locks/ 下存在未过期（24h）认领锁。
// 锁生命周期（BUG-20260903-002）：claim 创建 → report / 确认完成 / 驳回 即释放，
// 残留锁可用 atb prune-locks 清理——「有锁=确有会话在开发中」的放行条件因此重新收紧。
// 退出码：0 放行；2 拒绝（stderr 原因会反馈给 Agent）；其他非零视为错误。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {}
let hook = {};
try {
  hook = JSON.parse(raw);
} catch {}

const toolInput = hook.tool_input || {};

function deny(reason) {
  process.stderr.write(`[agent-team-board] 已拦截：${reason}\n`);
  process.exit(2);
}

const HUMAN_STATE_HINT =
  'accepted / planned / done 仅限人工操作：请在 Status Board（/board）点击按钮，' +
  '或由用户在终端执行 node <插件>/scripts/atb.mjs status <ID> <状态>。';

const CODE_GUARD_HINT =
  '插件源码受看板流程保护：改动前请先 /req 或 /bug 登记 → 人工接受 → /dev 认领（claim 产生认领锁），' +
  '认领锁有效期间方可修改。当前项目看板无有效认领锁。';

// ---------- 插件源码保护（REQ-20260901-003）----------

// 以本脚本自身位置解析插件根（realpath 兼容软链与缓存两种安装形态）。
// 本脚本位于 <插件根>/scripts/ 下，只上跳一层即插件根（BUG-20260906-015：
// 早期多跳一层到插件根父目录，导致 docs/ 豁免永不命中、保护范围整体上移）。
const PLUGIN_ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const PROTECTED_DIRS = ['scripts', 'commands', 'skills', 'hooks', '.zcode-plugin', '.codex-plugin', 'assets'];
const CLAIM_LOCK_STALE_MS = 24 * 60 * 60 * 1000;

// BUG-20260908-001：目标不存在（新建文件）时上溯最近存在的祖先做 realpath 归一，再以
// 剩余后缀段判定落点是否插件源码（docs/ 豁免照旧）。此前 file 模式先 existsSync 再
// 判定（isPluginSource 注释「调用方先 existsSync」），新建文件直接跳过源码保护；现与
// Bash 侧 token 判定（BUG-20260907-008）统一口径。
function realpathAncestralHitsPluginRoot(absPath) {
  let abs = path.resolve(absPath);
  const suffix = [];
  for (;;) {
    if (fs.existsSync(abs)) {
      try {
        const real = fs.realpathSync(abs);
        const rel = path.relative(PLUGIN_ROOT, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) return false; // 插件根之外
        if (rel === '') return suffix.length > 0 && suffix[0] !== 'docs'; // 祖先即插件根：剩余段决定落点
        return !rel.startsWith(`docs${path.sep}`); // 看板数据目录豁免
      } catch {
        return false;
      }
    }
    const parent = path.dirname(abs);
    if (parent === abs) return false;
    suffix.unshift(path.basename(abs));
    abs = parent;
  }
}

// 从 cwd 向上找看板目录，检查 .locks/ 下是否有未过期认领锁
function hasValidClaimLock(cwd) {
  let dir = path.resolve(cwd || process.cwd());
  for (;;) {
    const locks = path.join(dir, 'docs', 'agent-team-board', '.locks');
    if (fs.existsSync(locks)) {
      try {
        for (const f of fs.readdirSync(locks)) {
          if (!f.endsWith('.lock')) continue;
          try {
            const st = fs.statSync(path.join(locks, f));
            if (Date.now() - st.mtimeMs < CLAIM_LOCK_STALE_MS) return true;
          } catch {}
        }
      } catch {}
      return false; // 找到看板但无有效锁
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function denyIfSourceLocked(absNorm) {
  // BUG-20260908-001：不再要求目标已存在——新建文件经祖先回溯同样判定（与 Bash 侧同口径）。
  if (realpathAncestralHitsPluginRoot(absNorm) && !hasValidClaimLock(hook.cwd)) {
    deny(`插件源码受保护（${absNorm}）。${CODE_GUARD_HINT}`);
  }
}

// ---------- 模式一：Write / Edit ----------

// Codex 宿主的文件编辑经 apply_patch 工具下发：目标路径在 patch 文本头部行，
// tool_input 没有 file_path 字段（BUG-20260906-014）——无此解析时 file 模式会静默放行。
function patchTargetPaths(command) {
  const paths = [];
  const text = String(command || '');
  if (!text.includes('*** ')) return paths;
  for (const m of text.matchAll(/\*\*\*\s+(?:Update|Add|Delete|Move)\s+(?:File|to):\s*(.+)/g)) {
    const p = m[1].trim();
    if (p) paths.push(p);
  }
  return paths;
}

if (mode === 'file') {
  const targets = [String(toolInput.file_path || toolInput.path || ''), ...patchTargetPaths(toolInput.command)];
  for (const fp of targets) {
    if (!fp) continue;
    const norm = path.resolve(hook.cwd || process.cwd(), fp);
    const inBoard = /(^|\/)docs\/agent-team-board(\/|$)/.test(norm);
    if (inBoard && path.basename(norm) === 'status.json') {
      deny(
        `status.json 是机器状态文件，禁止直写修改（${norm}）。` +
        '状态变更只能通过 node <插件>/scripts/atb.mjs 的子命令完成。' + HUMAN_STATE_HINT
      );
    }
    denyIfSourceLocked(norm);
  }
  process.exit(0);
}

// ---------- 模式二：Bash ----------

// 轻量切分 shell 命令：只处理守卫关心的分隔符，并避免拆开引号内的 sed 脚本。
function splitShellSegments(command) {
  const segments = [];
  let current = '';
  let quote = '';
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    // &> 是输出重定向，不是后台命令分隔符。
    if (char === '&' && command[i + 1] === '>') {
      current += char;
      continue;
    }
    if (char === '\n' || char === ';' || char === '&' || char === '|') {
      if (current.trim()) segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) segments.push(current);
  return segments;
}

// 保留引号内文字为单个 token；只有未加引号的 > / >> 才作为重定向操作符。
function shellTokens(segment) {
  const tokens = [];
  let current = '';
  let quote = '';
  let escaped = false;

  const pushCurrent = () => {
    if (!current) return;
    tokens.push(current);
    current = '';
  };

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }
    if (char === '>') {
      pushCurrent();
      const operator = segment[i + 1] === '>' ? '>>' : '>';
      if (operator === '>>') i++;
      tokens.push(operator);
      continue;
    }
    current += char;
  }
  pushCurrent();
  return tokens;
}

function commandName(token) {
  return path.basename(token || '').toLowerCase();
}

// 引号内拼接归一（BUG-20260907-006）：shell 中成对引号是「词内连接」，st""atus / ac""cepted
// 实际就是 status / accepted。删除成对引号（而非替换为空格）后再切 token / 做子串匹配，
// 防止引号拆词绕过守卫关键词；反斜杠转义保守保留原字符（\" 不会参与拼接，宁可漏并不可误并）。
// 未闭合引号：已进入引号的后续内容按无引号字符保留（与 shell 报语法错误不执行相比偏保守拦截）。
function stripPairedQuotes(str) {
  let out = '';
  let quote = '';
  let escaped = false;
  for (const char of str) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      out += char;
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else out += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    out += char;
  }
  return out;
}

function sedScripts(tokens, sedIndex) {
  const scripts = [];
  for (let i = sedIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') {
      if (tokens[i + 1]) scripts.push(tokens[i + 1]);
      break;
    }
    if (token === '-e' || token === '--expression') {
      if (tokens[i + 1]) scripts.push(tokens[++i]);
      continue;
    }
    if (token.startsWith('--expression=')) {
      scripts.push(token.slice('--expression='.length));
      continue;
    }
    const shortExpression = token.match(/^-[^-]*e(.*)$/);
    if (shortExpression) {
      if (shortExpression[1]) scripts.push(shortExpression[1]);
      else if (tokens[i + 1]) scripts.push(tokens[++i]);
      continue;
    }
    if (token === '-f' || token === '--file') {
      i++;
      continue;
    }
    if (token.startsWith('--file=') || token.startsWith('-')) continue;
    scripts.push(token);
    break;
  }
  return scripts;
}

const SED_ADDRESS = String.raw`(?:\d+|\$|\/(?:\\.|[^/])*\/)`;
const SED_DANGEROUS_COMMAND = new RegExp(
  String.raw`(?:^|[;\n{}])\s*(?:(?:${SED_ADDRESS})(?:\s*,\s*(?:${SED_ADDRESS}))?\s*)?!?\s*[wWre](?=\s|$)`
);

function hasSedRewriteIntent(tokens) {
  for (let sedIndex = 0; sedIndex < tokens.length; sedIndex++) {
    if (commandName(tokens[sedIndex]) !== 'sed') continue;
    const args = tokens.slice(sedIndex + 1);
    const hasInPlaceOption = args.some((token) =>
      /^--in-place(?:=.*)?$/.test(token) || /^-[^-]*i/.test(token)
    );
    if (hasInPlaceOption) return true;
    if (sedScripts(tokens, sedIndex).some((script) => SED_DANGEROUS_COMMAND.test(script))) return true;
  }
  return false;
}

function hasNonDiscardingRedirection(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== '>' && tokens[i] !== '>>') continue;
    if (tokens[i + 1] !== '/dev/null') return true;
  }
  return false;
}

// BUG-20260907-007：脚本解释器内联代码（node -e/--eval/-p、ruby/perl/osascript -e、
// python -c、php -r 等）可在命令文本里不出现任何写动词的情况下改写文件，与既有
// python -c 判例同口径计为改写意图。选项扫描到首个非选项操作数（脚本路径）即止：
// `node atb.mjs …` 之类「解释器 + 脚本文件」的正常调用不参与判定。
const INTERPRETER_EVAL_SHORTS = {
  node: 'ep', nodejs: 'ep', deno: 'e', bun: 'e',
  ruby: 'e', perl: 'e', php: 'r', python: 'c', python3: 'c', osascript: 'e',
};

function hasInterpreterEvalIntent(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const shorts = INTERPRETER_EVAL_SHORTS[commandName(tokens[i])];
    if (!shorts) continue;
    const shortFlag = new RegExp(`^-[^-]*[${shorts}]`);
    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j];
      if (token === '--') break;
      if (token.startsWith('--')) {
        if (/^--(eval|print|run)(=|$)/.test(token)) return true;
        continue;
      }
      if (token.length > 1 && token.startsWith('-')) {
        if (shortFlag.test(token)) return true;
        continue;
      }
      break; // 首个非选项 token：脚本操作数，解释器选项区结束
    }
  }
  return false;
}

// BUG-20260907-007：find 的写动作谓词——-delete 删除、-fprint/-fprint0/-fprintf/-fls
// 写文件——直接产生落盘效果，计为改写意图；只读谓词（-name/-print 等）不受影响。
function hasFindWriteAction(tokens) {
  const findIndex = tokens.findIndex((token) => commandName(token) === 'find');
  return (
    findIndex !== -1 &&
    tokens.slice(findIndex + 1).some((token) => /^-(delete|fls|fprintf|fprint0?)(=|$)/.test(token))
  );
}

function hasRewriteIntent(segment) {
  const tokens = shellTokens(segment);
  if (hasNonDiscardingRedirection(tokens) || hasSedRewriteIntent(tokens)) return true;
  if (tokens.some((token) => ['tee', 'cp', 'mv', 'rm', 'chmod'].includes(commandName(token)))) return true;
  if (hasInterpreterEvalIntent(tokens)) return true; // 含既有 python -c 判例（扩展自本 Bug）
  if (hasFindWriteAction(tokens)) return true;

  const perlIndex = tokens.findIndex((token) => commandName(token) === 'perl');
  return perlIndex !== -1 && /^-pi/.test(tokens[perlIndex + 1] || '');
}

// 「插件源码目标」特征：插件根路径，或带插件名的源码子目录（避免误拦其他项目的同名相对路径）
// BUG-20260907-008：前两种是纯文本形态匹配，命令经符号链接别名路径（生产形态
// ~/.zcode/cli/plugins/cache/… 软链指向源码仓库）改写时两者都不命中——命令文本中的
// 路径 token 须再做符号链接归一化：token 解析为绝对路径后 realpath；目标尚不存在
// （写新文件）时向上取最近存在的祖先做 realpath，落在插件根内（docs/ 豁免同上）即命中。
// 选项 / 环境变量 / URL 形态 token 跳过，避免把非路径操作数误判为源码目标。
function tokenRealpathHitsPluginRoot(token) {
  const t = token.replace(/^(>{1,2})+/, '').replace(/[,:;]+$/, ''); // 吸附的重定向操作符与尾标点
  if (!t || t.startsWith('-') || t.startsWith('$') || t.includes('://')) return false;
  const expanded = t.startsWith('~') ? path.join(os.homedir(), t.slice(1)) : t;
  if (!expanded.includes('/')) return false; // 非路径形态（裸命令名等）
  // 含目标不存在（写新文件）时的最近存在祖先回溯（BUG-20260908-001 抽取为公共实现）
  return realpathAncestralHitsPluginRoot(path.resolve(hook.cwd || process.cwd(), expanded));
}

function hitsPluginSource(seg) {
  if (seg.includes(PLUGIN_ROOT)) return true;
  if (/agent-team-board\/(scripts|commands|skills|hooks|\.zcode-plugin|\.codex-plugin|assets)(\/|$)/i.test(seg)) return true;
  return seg.split(/\s+/).some(tokenRealpathHitsPluginRoot);
}

// 「status.json 目标」形态：/ 前缀的路径形态（文档/测试内容中「提及」不算），或 find
// 按名定位的谓词形态（-name status.json）——BUG-20260907-007：find 段中文件名与目录
// 路径分离（`find <board> -name status.json -delete`），路径形态匹配不到目标。
function hitsBoardStatusTarget(norm) {
  return /\/status\.json/i.test(norm) || /(^|\s)-i?name\s+status\.json(\s|$)/i.test(norm);
}

// ---------- BUG-20260907-013：改写意图与插件源码按「写目标」语义关联 ----------
// 旧逻辑：hasRewriteIntent 与 hitsPluginSource 在段内各自独立命中即拦，`node <插件>/
// scripts/server.mjs > /tmp/x.log`（插件路径仅被读取/执行、写目标是插件外文件）被误拦。
// 新口径：提取每个写动作的落盘目标 token，目标解析为插件源码路径才拦；插件路径仅在
// 参数/输入位置出现不计入。写目标无法静态解析（解释器内联代码、sed w 脚本、残缺命令）
// 时回退段级检测保守拦截，不弱于旧保护面。

// sed 的文件操作数（-i 原地改写对象）：与 sedScripts 同一选项扫描骨架，首个脚本
// token 之后的操作数才是文件（-e/--expression/--file 的参数均是脚本，不是写目标）。
function sedFileOperands(tokens, sedIndex) {
  for (let i = sedIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') return tokens.slice(i + 1);
    if (token === '-e' || token === '--expression') { i++; continue; }
    if (token.startsWith('--expression=')) continue;
    const shortExpression = token.match(/^-[^-]*e(.*)$/);
    if (shortExpression) { if (!shortExpression[1]) i++; continue; }
    if (token === '-f' || token === '--file') { i++; continue; }
    if (token.startsWith('--file=') || token.startsWith('-')) continue;
    return tokens.slice(i + 1); // 首个脚本 token 之后即文件操作数
  }
  return [];
}

// 提取段内「写动作」的落盘目标 token：
//   > / >>    → 操作符后随操作数（&fd 引用不是文件目标）
//   tee       → 全部非选项操作数（输入写入每个操作数文件）
//   cp        → 末操作数（写目标；-t/--target-directory 的值）。源操作数仅被读取，
//               与 cat <SRC> >/tmp 同口径不计入（BUG-20260907-013 判例演进）
//   mv        → 全部非选项操作数（源被移出插件根同样是改写插件源码）
//   rm / chmod → 全部非选项操作数
//   sed -i    → 首个脚本之后的文件操作数（原地改写对象）
//   perl -pi  → 脚本之后的文件操作数（-e 参数或裸脚本均先跳过）
//   find      → -delete 删除遍历树：起点路径即目标；-fprint/-fprintf/-fprint0/-fls
//               写清单文件：选项值即目标（起点仅被遍历读取）
// 返回空数组 = 写目标不可静态解析，调用方回退段级检测。
function rewriteTargetTokens(tokens) {
  const targets = [];
  const isFlag = (t) => t.length > 1 && t.startsWith('-');
  const commandOps = (start, { lastOnly = false, withTargetDir = false } = {}) => {
    const ops = [];
    for (let i = start; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '--') { for (let k = i + 1; k < tokens.length; k++) ops.push(tokens[k]); break; }
      if (t === '<') { i++; continue; } // 输入重定向对 < 来源：是读取目标，不是写目标
      if (isFlag(t)) {
        if (withTargetDir && (t === '-t' || t === '--target-directory') && tokens[i + 1]) targets.push(tokens[++i]);
        continue;
      }
      ops.push(t);
    }
    if (lastOnly) return ops.slice(-1);
    return ops;
  };
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '>' || tokens[i] === '>>') {
      const t = tokens[i + 1];
      if (t && !t.startsWith('&')) targets.push(t);
      continue;
    }
    const name = commandName(tokens[i]);
    if (name === 'tee') targets.push(...commandOps(i + 1));
    else if (name === 'cp') targets.push(...commandOps(i + 1, { lastOnly: true, withTargetDir: true }));
    else if (name === 'mv' || name === 'rm' || name === 'chmod') targets.push(...commandOps(i + 1));
    else if (name === 'sed') {
      const hasInPlace = tokens
        .slice(i + 1)
        .some((t) => /^--in-place(?:=.*)?$/.test(t) || /^-[^-]*i/.test(t));
      if (hasInPlace) targets.push(...sedFileOperands(tokens, i));
    } else if (name === 'perl') {
      if (/^-pi/.test(tokens[i + 1] || '')) {
        let scriptConsumed = false; // -e 的参数或首个裸操作数是脚本，先跳过
        for (let j = i + 2; j < tokens.length; j++) {
          if (tokens[j] === '-e' && tokens[j + 1] !== undefined) { scriptConsumed = true; j++; continue; }
          if (isFlag(tokens[j])) continue;
          if (!scriptConsumed) { scriptConsumed = true; continue; }
          targets.push(tokens[j]);
        }
      }
    } else if (name === 'find') {
      const startPoints = [];
      let j = i + 1;
      for (; j < tokens.length && !tokens[j].startsWith('-'); j++) startPoints.push(tokens[j]);
      for (; j < tokens.length; j++) {
        const m = tokens[j].match(/^-(delete|fls|fprintf|fprint0?)(?:=(.+))?$/);
        if (!m) continue;
        if (m[1] === 'delete') targets.push(...startPoints);
        else targets.push(m[2] !== undefined ? m[2] : tokens[j + 1] || '');
      }
    }
  }
  return targets;
}

// 无锁 Bash 改写插件源码判定：写目标语义关联（BUG-20260907-013）。
function bashRewritesPluginSource(seg, norm) {
  if (!hasRewriteIntent(seg) || !hitsPluginSource(norm)) return false;
  const targets = rewriteTargetTokens(shellTokens(seg));
  if (targets.length === 0) return true; // 目标不可静态解析：回退段级检测保守拦截
  return targets.some((t) => tokenRealpathHitsPluginRoot(t));
}

// ---------- REQ-20260911-009 流程外 git commit 拦截（仅看板项目内） ----------
// 授权口径：到待测试自动提交由 atb 进程内部 spawnSync 执行 git，不经 Agent Bash 工具，
// 天然不经过本守卫；Agent 经 Bash 的 git commit 一律拦截（REQ-20260911-010：人工触发的
// CMT 批次提交通道已随回退下线，不再存在豁免场景），需要提交时由人工在终端执行。

// 解析 git 子命令：git [全局选项] <子命令> …（跳过 -C/-c/--git-dir 等带值选项）
function gitSubcommandOf(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (commandName(tokens[i]) !== 'git') continue;
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j];
      if (t === '--') break;
      if (t.startsWith('--')) {
        if (/^--(git-dir|work-tree|namespace|exec-path|super-prefix)$/.test(t)) j++;
        continue;
      }
      if (t.length > 1 && t.startsWith('-')) {
        if (t === '-C' || t === '-c') j++;
        continue;
      }
      return t; // 首个非选项 token 即子命令（commit / commit-tree 等精确区分）
    }
  }
  return null;
}

// 从 cwd 向上找看板数据目录（docs/agent-team-board）；无看板 = 非看板项目，不管辖
function boardDataDirOf(cwd) {
  let dir = path.resolve(cwd || process.cwd());
  for (;;) {
    const cand = path.join(dir, 'docs', 'agent-team-board');
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

if (mode === 'bash') {
  const cmd = String(toolInput.command || '');
  if (!cmd) process.exit(0);

  // 按 shell 分隔符切段，逐段检查，避免 ";"/"&&" 拼接绕过。
  const segments = splitShellSegments(cmd);
  for (const seg of segments) {
    // 先做引号内拼接归一（BUG-20260907-006），再切 token / 子串匹配：st""atus → status。
    const norm = stripPairedQuotes(seg);
    const tokens = norm.split(/\s+/).filter(Boolean);

    // (1) 改写 intent 触碰 status.json（路径形态或 find -name 目标形态；cat 等只读放行——
    //     BUG-20260901-002 修复。/ 前缀路径形态：文档/测试内容中「提及」status.json 不算目标。
    //     子串匹配用 norm（引号拼接归一，防 st""atus.json 绕过）；改写意图检测用原始 seg——
    //     hasRewriteIntent 内的 shellTokens 本就引号感知，传入去引号文本会把 's/>/x/' 里的
    //     > 误判为重定向（B1 回归教训）。
    if (hitsBoardStatusTarget(norm) && /agent-team-board/i.test(norm) && hasRewriteIntent(seg)) {
      deny(
        `禁止用 Bash 改写 docs/agent-team-board 下的 status.json（命令片段：${seg.trim()}）。` +
        '状态变更只能通过 atb 子命令完成；只读查看请用 atb show。' + HUMAN_STATE_HINT
      );
    }

    // (2) atb status <ID> accepted|planned|done —— 人工专属（REQ-20260903-001 回退：认领即实施，in-progress 由 Agent claim；
    //     planned 置计划/移出计划为人工排期操作，REQ-20260908-010）
    const isAtb = tokens.some((t) => t === 'atb' || /atb\.mjs$/i.test(t) || t.includes('atb.mjs'));
    if (isAtb) {
      const statusIdx = tokens.findIndex((t) => t === 'status');
      if (statusIdx !== -1) {
        const later = tokens.slice(statusIdx + 1);
        const hit = later.find((t) => {
          const v = t.startsWith('--to=') ? t.slice(5) : t;
          return v === 'accepted' || v === 'planned' || v === 'done';
        });
        if (hit) {
          deny(
            `Agent 不能把条目置为 accepted / planned / done（命令片段：${seg.trim()}）。` +
            'Agent 允许的状态操作：atb claim（认领 → in-progress）与 atb report（上报测试报告）。' +
            HUMAN_STATE_HINT
          );
        }
      }
      // (2b) REQ-20260910-015：atb new … --accept 创建并接受同为人工专属（一步直达 accepted）；
      //      裸 --accept / --accept=true 均拦（=false 为无效开关不生效，放行对齐 --to= 前缀口径）
      const newIdx = tokens.findIndex((t) => t === 'new');
      if (newIdx !== -1) {
        const hit = tokens.slice(newIdx + 1).find((t) => t === '--accept' || t === '--accept=true');
        if (hit) {
          deny(
            `Agent 不能用「创建并接受」一步置 accepted（命令片段：${seg.trim()}）。` +
            '创建后请保持 submitted，由人工在 Status Board 或终端执行接受。' + HUMAN_STATE_HINT
          );
        }
      }
      // (2c) REQ-20260911-007：atb hold answer|resume|cancel —— 人工专属（Agent 不代人工作决策、
      //      不自动复工；declare / list / show 面向 worker 声明与查询，放行）
      const holdIdx = tokens.findIndex((t) => t === 'hold');
      if (holdIdx !== -1) {
        const act = tokens[holdIdx + 1];
        if (act === 'answer' || act === 'resume' || act === 'cancel') {
          deny(
            `Agent 不能代人工作出决策或复工（命令片段：${seg.trim()}）。` +
            '待人工决策的作答 / 复工 / 作废仅限人工：请在 Status Board「待人工确认」操作，或由用户在终端执行。'
          );
        }
      }
      // (2d) REQ-20260914-001：挂起确认的人工闭环操作（核验/保持挂起/作答/确认并继续）为人工专属
      //      ——Agent 不代人工确认提交归属、不代答分析问题、不代恢复队列；
      //      atb confirm list|show 只读呈现与 atb refine hold worker 声明放行（不经此分支）。
      const confirmIdx = tokens.findIndex((t, i) => t === 'confirm' && tokens[i - 1] !== 'refine');
      if (confirmIdx !== -1) {
        const act = tokens[confirmIdx + 1];
        if (act === 'verify' || act === 'keep' || act === 'answer' || act === 'continue' || act === 'cancel') {
          deny(
            `Agent 不能代人工完成挂起确认（命令片段：${seg.trim()}）。` +
            '重新核验 / 保持挂起 / 作答 / 确认并继续仅限人工：请在 Status Board 任务页「待人工确认」操作。'
          );
        }
      }
    }

    // (3) curl 等直接调 Status Board 的人工 API
    if (/(7736|8888)|agent-team-board.*\/api\//i.test(norm) && /\/api\/(item|new)/i.test(norm)) {
      const hit = tokens.find((t) => {
        const v = t.startsWith('--to=') || t.startsWith('to=') ? t.split('=')[1] : t;
        return v === 'accepted' || v === 'planned' || v === 'done';
      });
      // REQ-20260910-015：/api/new 携带「创建并接受」标记（JSON "accept":true 或表单/查询 accept=true）
      // 同为人工专属——不拦即成越权后门；accept:false / 不带标记的旧调用不受影响
      const acceptMark = /\/api\/new/i.test(norm)
        && (/"?accept"?\s*:\s*true\b/i.test(norm) || /\baccept=true\b/i.test(norm));
      if (hit || acceptMark) {
        deny(
          `Agent 不能通过 HTTP 调用 Status Board 的人工状态接口（命令片段：${seg.trim()}）。` + HUMAN_STATE_HINT
        );
      }
    }

    // (3b) REQ-20260911-007：待人工决策写接口（/api/hold/<id>/answer|resume|cancel）同为人工专属；
    //      GET /api/holds 聚合清单与 /api/hold/<id> 详情为只读呈现，不在此列。
    if (/(7736|8888)|agent-team-board.*\/api\//i.test(norm) && /\/api\/hold\/[^/\s"']*\/(answer|resume|cancel)\b/i.test(norm)) {
      deny(
        `Agent 不能通过 HTTP 代人工作出决策或复工（命令片段：${seg.trim()}）。` +
        '作答 / 复工 / 作废仅限人工：请在 Status Board「待人工确认」操作。'
      );
    }

    // (3c) REQ-20260914-001：挂起确认写接口（/api/confirms/<id>/(answer|verify|keep|continue)）人工专属；
    //      GET /api/confirms 清单 / 详情 / diff 为只读呈现，不在此列。
    if (/(7736|8888)|agent-team-board.*\/api\//i.test(norm) && /\/api\/confirms\/[^/\s"']*\/(answer|verify|keep|continue)\b/i.test(norm)) {
      deny(
        `Agent 不能通过 HTTP 代人工完成挂起确认（命令片段：${seg.trim()}）。` +
        '重新核验 / 保持挂起 / 作答 / 确认并继续仅限人工：请在 Status Board 任务页「待人工确认」操作。'
      );
    }

    // (4) 无有效认领锁时改写插件源码（sed/tee/重定向等；只读放行）。
    //     BUG-20260907-013：改写意图与插件源码按「写目标」语义关联——插件路径仅作为
    //     读取/执行/遍历来源出现时放行，仅当写动作落盘目标在插件内才拦。
    //     hasRewriteIntent 用原始 seg（引号感知）；hitsPluginSource 用 norm（路径可被引号拆词）。
    if (!hasValidClaimLock(hook.cwd) && bashRewritesPluginSource(seg, norm)) {
      deny(`插件源码受看板流程保护，禁止无认领锁时用 Bash 改写（命令片段：${seg.trim()}）。${CODE_GUARD_HINT}`);
    }

    // (5) REQ-20260911-009 流程外 git commit（仅看板项目内）：提交进版本库绑定两条授权
    //     通道——批量开发到待测试的系统自动提交（atb 进程内部执行，不经本守卫）与人工
    //     终端提交；其余 Agent Bash 提交一律拦截。REQ-20260911-010：人工触发的批量
    //     commit（CMT）批次通道已回退下线，其豁免随之移除。
    if (gitSubcommandOf(tokens) === 'commit') {
      const boardDir = boardDataDirOf(hook.cwd);
      if (boardDir) {
        deny(
          `流程外 git commit 已拦截（命令片段：${seg.trim()}）。提交通道：` +
          'AI 开发到待测试由系统自动提交（run receipt 核验通过后执行，不经 Agent）。' +
          '其余场景请人工在终端执行 git commit。'
        );
      }
    }
  }
  process.exit(0);
}

// 未知模式：放行（钩子配置错误不应阻断会话）
process.exit(0);
