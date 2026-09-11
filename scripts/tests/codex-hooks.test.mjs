#!/usr/bin/env node
// BUG-20260906-014 Codex 宿主 hooks 兼容 —— schema 契约 + Codex 输入契约下守卫子进程实测
// 用法：node scripts/tests/codex-hooks.test.mjs
// 背景：Codex CLI 默认解析插件根 hooks/hooks.json，但 ZCode 的 process+args+timeoutMs
// schema 在 Codex 0.153.4 报 unknown variant `process`；且 Codex 文件编辑经 apply_patch
// 下发（路径在 patch 文本中，tool_input 无 file_path），file 模式原实现会直接放行。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const guard = path.join(pluginRoot, 'scripts', 'state-guard.mjs');

// ---------- 静态契约：Codex 侧配置 ----------

const codexHooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'codex.json'), 'utf8'));
const codexManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
const zcodeManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.zcode-plugin', 'plugin.json'), 'utf8'));
const zcodeHooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));

function preToolUseEntries(cfg) {
  return (cfg.hooks && cfg.hooks.PreToolUse) || [];
}
function allHandlers(cfg) {
  return preToolUseEntries(cfg).flatMap((e) => e.hooks || []);
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// H1 codex.json 全部 handler 符合 Codex schema：type=command、无 process/args/timeoutMs
t('H1 codex.json 符合 Codex schema（type=command，无 process/args/timeoutMs）', () => {
  const handlers = allHandlers(codexHooks);
  assert.ok(handlers.length >= 2, '应有至少两条 PreToolUse 守卫');
  for (const h of handlers) {
    assert.equal(h.type, 'command', `handler type 应为 command，得到 ${h.type}`);
    assert.equal(typeof h.command, 'string', 'command 应为字符串');
    assert.ok(h.command.length > 0, 'command 不应为空');
    assert.ok(!('args' in h), 'Codex schema 无 args 字段');
    assert.ok(!('timeoutMs' in h), 'Codex schema 无 timeoutMs 字段（用 timeout 秒）');
    if ('timeout' in h) {
      assert.ok(Number.isInteger(h.timeout) && h.timeout > 0, 'timeout 应为正整数（秒）');
    }
  }
});

// H2 matcher 覆盖文件编辑与 shell；command 引用守卫脚本与正确模式
t('H2 matcher 覆盖 Edit|Write 与 Bash，command 引用 state-guard 正确模式', () => {
  const fileEntry = preToolUseEntries(codexHooks).find((e) => /Edit/.test(e.matcher) && /Write/.test(e.matcher));
  const bashEntry = preToolUseEntries(codexHooks).find((e) => /Bash/.test(e.matcher));
  assert.ok(fileEntry, '应有用 Edit|Write 匹配文件编辑的条目（Codex 的 apply_patch 兼容 Edit/Write）');
  assert.ok(bashEntry, '应有用 Bash 匹配 shell 命令的条目');
  assert.ok(
    fileEntry.hooks.every((h) => h.command.includes('state-guard.mjs') && h.command.includes(' file')),
    'Edit|Write 条目应调 state-guard.mjs file 模式'
  );
  assert.ok(
    bashEntry.hooks.every((h) => h.command.includes('state-guard.mjs') && h.command.includes(' bash')),
    'Bash 条目应调 state-guard.mjs bash 模式'
  );
  assert.match(fileEntry.hooks[0].command, /\$\{?PLUGIN_ROOT\}?/, 'command 应用 PLUGIN_ROOT 变量定位插件根');
});

// H3 .codex-plugin manifest 声明 hooks 覆盖默认 hooks/hooks.json（消除解析错误的机制前提）
t('H3 .codex-plugin/plugin.json 声明 hooks 指向 codex.json', () => {
  assert.equal(codexManifest.hooks, './hooks/codex.json', 'manifest 应声明 Codex 格式 hooks 文件');
  assert.ok(fs.existsSync(path.join(pluginRoot, 'hooks', 'codex.json')), 'hooks/codex.json 应存在');
});

// H4 回归：ZCode 侧 hooks/hooks.json 保持 process schema，不被本次修复改坏
t('H4 ZCode 侧 hooks/hooks.json 保持 process schema 不变', () => {
  assert.equal(zcodeManifest.hooks, './hooks/hooks.json');
  const handlers = allHandlers(zcodeHooks);
  assert.ok(handlers.length >= 2, 'ZCode 侧守卫条目不应减少');
  for (const h of handlers) {
    assert.equal(h.type, 'process', 'ZCode schema 应保持 process');
    assert.ok(Array.isArray(h.args), 'ZCode schema 应保持 args 数组');
  }
});

// ---------- 子进程实测：Codex 输入契约下守卫生效 ----------

// 临时项目：有看板与有效锁（claim 场景）与无锁两种 cwd
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-codexhooks-'));
fs.mkdirSync(path.join(tmp, 'proj-locked', 'docs', 'agent-team-board', '.locks'), { recursive: true });
const projLocked = fs.realpathSync(path.join(tmp, 'proj-locked'));
fs.writeFileSync(path.join(projLocked, 'docs', 'agent-team-board', '.locks', 'claim.lock'), 'lock');
fs.mkdirSync(path.join(tmp, 'proj-nolock'), { recursive: true });
const projNoLock = fs.realpathSync(path.join(tmp, 'proj-nolock'));

function run(mode, toolName, toolInput, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [guard, mode], {
      cwd: cwd || pluginRoot,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    // Codex PreToolUse stdin 契约：tool_name + tool_input（apply_patch 用 command 字段承载 patch 文本）
    p.stdin.write(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, cwd: cwd || pluginRoot, tool_input: toolInput }));
    p.stdin.end();
  });
}

function patch(target, body = '+x') {
  return `*** Begin Patch\n*** Update File: ${target}\n@@\n ${body}\n*** End Patch`;
}

// H5 Codex 文件编辑（apply_patch patch 文本）直写 status.json → 拦截
t('H5 apply_patch 直写 status.json 被拦（Codex file 输入契约）', async () => {
  const r = await run('file', 'apply_patch', {
    command: patch('docs/agent-team-board/requirements/REQ-20260906-003/bugs/BUG-20260906-014/status.json'),
  }, projLocked);
  assert.equal(r.code, 2, `期望 2，得到 ${r.code}：${r.err}`);
  assert.match(r.err, /status\.json/, '拒绝原因应指明 status.json');
});

// H6 apply_patch 更新看板 markdown（含 status.json 字样但目标非它）→ 放行
t('H6 apply_patch 更新看板 markdown 放行（不误拦提及字样）', async () => {
  const r = await run('file', 'apply_patch', {
    command: patch('docs/agent-team-board/requirements/REQ-20260906-003/bugs/BUG-20260906-014/README.md', '+提及 status.json 字样不算目标'),
  }, projLocked);
  assert.equal(r.code, 0, `期望 0，得到 ${r.code}：${r.err}`);
});

// H7 apply_patch 更新插件源码：无锁 → 拦；有锁 → 放行
// patch 目标用绝对路径（apply_patch 相对路径随会话 cwd 解析，无关项目下相对路径不构成源码目标）
t('H7 apply_patch 改插件源码：无锁拦截、有锁放行', async () => {
  const srcAbs = path.join(pluginRoot, 'scripts', 'web', 'app.js');
  const denied = await run('file', 'apply_patch', { command: patch(srcAbs) }, projNoLock);
  assert.equal(denied.code, 2, `无锁应拦（exit=${denied.code}）：${denied.err}`);
  assert.match(denied.err, /插件源码受保护/, '应给出源码保护提示');
  const allowed = await run('file', 'apply_patch', { command: patch(srcAbs) }, projLocked);
  assert.equal(allowed.code, 0, `有锁应放行（exit=${allowed.code}）：${allowed.err}`);
});

// H8 Codex Bash 输入契约：atb status <ID> done 拦截；cat status.json 放行
t('H8 Codex Bash 契约：人工专属状态命令拦截、只读放行', async () => {
  const denied = await run('bash', 'Bash', {
    command: `node ${pluginRoot}/scripts/atb.mjs status REQ-20260906-003 done`,
  }, projLocked);
  assert.equal(denied.code, 2, `期望 2，得到 ${denied.code}：${denied.err}`);
  const ro = await run('bash', 'Bash', {
    command: `cat ${projLocked}/docs/agent-team-board/requirements/REQ-20260906-003/status.json`,
  }, projLocked);
  assert.equal(ro.code, 0, `只读应放行（exit=${ro.code}）：${ro.err}`);
});

// H9 ZCode file 契约（file_path 字段）回归：status.json 仍拦
t('H9 ZCode file 契约回归：file_path 直写 status.json 仍拦', async () => {
  const r = await run('file', 'Write', {
    file_path: `${projLocked}/docs/agent-team-board/requirements/REQ-20260906-003/status.json`,
  }, projLocked);
  assert.equal(r.code, 2, `期望 2，得到 ${r.code}：${r.err}`);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
