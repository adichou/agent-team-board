// REQ-20260918-003 clone 后从 git 历史重建看板状态（atb rebuild）。
// 背景：runtime/ 整目录不进 git（ensureRuntimeIgnore 唯一忽略规则），新机器 clone 后
// data/ 条目文档齐全而 runtime/status/ 为空，看板无法得知条目状态；本模块从 git 历史
// 重建条目实时状态。
// 判定口径（与 BUG-20260918-003 design.md 一致，用户拍板；REQ-20260927-001 细化留痕排除）：
//   · git 提交历史消息含该单号（默认当前检出分支完整历史）且依据提交**不是**创建/删除
//     留痕提交（git-flow.isItemTraceCommitSubject：doc: 创建条目|删除待接受条目 <单号>）→ done；
//     留痕提交只证明条目创建/删除发生过，不得单独构成 done 依据——否则「仅创建过」的
//     条目会被创建留痕提交误判 done（REQ-20260927-001 创建即留痕引入的交互冲突）；
//   · 无提交痕迹（或仅有留痕提交）→ submitted；
//   · 不区分「已上报」与「已人工确认完成」，不为此新增进 git 的终态标记文件。
// 安全边界与幂等：
//   · 仅允许在 runtime 条目状态为空时重建（防误覆盖既有看板）：status/ 下已存在任何
//     非 rebuild 产生的 <ID>.json 即拒绝；
//   · 既有文件全部由本命令产生（history by 全为 REBUILD_ACTOR）时视为中断重跑：
//     沿用已判定条目（不重复追加 history、不翻转状态），补齐剩余条目——最终结果与
//     一次完整执行一致；
//   · 对 git 全程只读（仅 git log 类查询），不改 data/ 条目文档、不产生 commit / push /
//     分支操作，不动 runtime/status/ 之外的 runtime 文件（config.json 计数器等）。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AtbError, writeJsonAtomic, projectRootOfBoard } from './core.mjs';
import { isGitRepo } from './commit-store.mjs';
// REQ-20260927-001：创建/删除留痕提交排除出 done 判定（判定标记真源在 git-flow）
import { isItemTraceCommitSubject } from './git-flow.mjs';

// history 留痕标记：重建产生的状态文件，其全部 history 条目 by 均为该值（幂等重跑识别依据）
export const REBUILD_ACTOR = 'atb-rebuild';

const ID_RE = /^(REQ|BUG)-\d{8}-\d{3,}$/;
const GIT_TIMEOUT_MS = 60_000;

// ---------- 条目扫描 ----------

// 扫描 data/（requirements/ 与 bugs/）全部条目目录：顶层需求、顶层独立 Bug、需求内嵌
// 嵌套 Bug（与 core.listItems 的清单一致，重建后看板两处都能读到）。
function collectItems(dataDir) {
  const items = [];
  const seen = new Set();
  const push = (dir) => {
    const id = path.basename(dir);
    if (!ID_RE.test(id) || seen.has(id)) return;
    seen.add(id);
    items.push({ id, dir, type: id.startsWith('REQ') ? 'requirement' : 'bug' });
  };
  const reqRoot = path.join(dataDir, 'data', 'requirements');
  if (fs.existsSync(reqRoot)) {
    for (const name of fs.readdirSync(reqRoot).sort()) {
      const dir = path.join(reqRoot, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      push(dir);
      const nested = path.join(dir, 'bugs');
      if (!fs.existsSync(nested)) continue;
      for (const bn of fs.readdirSync(nested).sort()) {
        const bd = path.join(nested, bn);
        if (fs.statSync(bd).isDirectory()) push(bd);
      }
    }
  }
  const bugRoot = path.join(dataDir, 'data', 'bugs');
  if (fs.existsSync(bugRoot)) {
    for (const name of fs.readdirSync(bugRoot).sort()) {
      const dir = path.join(bugRoot, name);
      if (fs.statSync(dir).isDirectory()) push(dir);
    }
  }
  return items;
}

// 条目元信息：标题取 README 首行「# <ID> 标题」（与 createItem 模板同口径），创建时间取
// 「- 创建：<ISO>」行；README 缺失 / 首行不含 ID / 行不可解析时兜底（标题=ID、创建=现在），
// 不因此失败。
function readItemMeta(item) {
  let title = item.id;
  let createdAt = null;
  try {
    const lines = fs.readFileSync(path.join(item.dir, 'README.md'), 'utf8').split('\n');
    const head = lines[0] || '';
    if (head.startsWith('# ') && head.includes(item.id)) {
      const t = head.slice(head.indexOf(item.id) + item.id.length).trim();
      if (t) title = t;
    }
    for (const line of lines) {
      const m = /^-\s*创建[：:]\s*(\S+)/.exec(line.trim());
      if (!m) continue;
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
      break;
    }
  } catch { /* README 缺失：走兜底 */ }
  return { title, createdAt };
}

// ---------- git 依据（只读） ----------

// 一次结构化扫描当前检出分支历史（与 gitLogMessages 同范围）：记录 = hash + 主题 + 完整消息
// （%H 与消息以 \x1f 分隔、提交之间以 \x1e 分隔，多行消息不拆记录）。
// done/submitted 判定与依据提交选择都基于本清单：含单号且主题非创建/删除留痕的提交
// 才可作 done 依据（REQ-20260927-001 留痕排除）。
function commitRecords(projectRoot) {
  const r = spawnSync('git', ['--no-optional-locks', 'log', '--format=%H%x1f%B%x1e'], {
    cwd: projectRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS,
  });
  if (r.status !== 0) return [];
  const records = [];
  for (const chunk of String(r.stdout || '').split('\x1e')) {
    const rec = chunk.replace(/^\n+/, '').replace(/\n+$/, '');
    if (!rec) continue;
    const sep = rec.indexOf('\x1f');
    if (sep === -1) continue;
    const hash = rec.slice(0, sep).trim();
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) continue;
    const message = rec.slice(sep + 1).replace(/\n+$/, '');
    records.push({ hash, subject: message.split('\n')[0].trim(), text: message });
  }
  return records;
}

// ---------- 安全边界 ----------

// 状态文件是否由 rebuild 产生：全部 history 条目 by 均为 REBUILD_ACTOR（createItem 等
// 正常流程的 history by 是会话名 / 人工标记，不会全等于重建标记；文件损坏按非重建处理）。
function rebuildProduced(file, id) {
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Boolean(
      st && st.id === id
      && Array.isArray(st.history) && st.history.length > 0
      && st.history.every((h) => h && h.by === REBUILD_ACTOR),
    );
  } catch {
    return false;
  }
}

// ---------- 主入口 ----------

// 从 git 历史重建 runtime/status/<ID>.json。入参为板根（agent-team-board/，CLI 经
// core.requireDataDir 解析）。返回重建结果（清单 + 计数）供 CLI 呈现；条目文档与
// runtime 其余文件不动，对 git 只读。
export function rebuildBoardStatus(dataDir) {
  if (!dataDir || typeof dataDir !== 'string') throw new AtbError('缺少看板数据目录');
  const statusDir = path.join(dataDir, 'runtime', 'status');
  const projectRoot = projectRootOfBoard(dataDir);

  // 安全边界：runtime 条目状态非空时拒绝（既有文件全部由本命令产生 → 中断重跑，放行）
  const keptIds = new Map(); // id → status（沿用已判定状态）
  if (fs.existsSync(statusDir)) {
    for (const name of fs.readdirSync(statusDir).sort()) {
      if (!name.endsWith('.json')) continue;
      const base = name.slice(0, -'.json'.length);
      if (!ID_RE.test(base)) continue; // 只看条目状态文件，其余文件不据此拒绝
      if (!rebuildProduced(path.join(statusDir, name), base)) {
        throw new AtbError(
          `runtime/status/ 已存在条目状态文件（${base}.json，非 ${REBUILD_ACTOR} 产生），拒绝重建以免覆盖既有看板；` +
          '仅当 runtime 条目状态为空（或全部由 atb rebuild 产生）时允许重建。' +
          '如确需重建，请人工核对既有看板后清空 agent-team-board/runtime/status/ 再执行'
        );
      }
      keptIds.set(base, JSON.parse(fs.readFileSync(path.join(statusDir, name), 'utf8')).status);
    }
  }

  const items = collectItems(dataDir);
  fs.mkdirSync(statusDir, { recursive: true }); // 不存在时自动创建骨架（幂等）
  const repo = isGitRepo(projectRoot);
  const records = repo ? commitRecords(projectRoot) : [];

  const now = new Date().toISOString();
  const lines = [];
  let doneCount = 0;
  let submittedCount = 0;
  let written = 0;
  let kept = 0;
  for (const item of items) {
    // 依据提交：完整历史消息含单号的最新一条**非留痕**提交（git log 新→旧，取首个命中；
    // REQ-20260927-001：doc: 创建条目|删除待接受条目 <单号> 留痕提交不得单独构成 done 依据）
    const basis = records.find((c) => c.text.includes(item.id) && !isItemTraceCommitSubject(c.subject)) || null;
    const onlyTrace = !basis && records.some((c) => c.text.includes(item.id));
    const basisText = basis
      ? `依据提交 ${basis.hash.slice(0, 10)} ${basis.subject}`
      : (onlyTrace ? '仅有创建/删除留痕提交，按未开发处理' : '无提交痕迹');

    let status;
    if (keptIds.has(item.id)) {
      status = keptIds.get(item.id); // 幂等：沿用已判定状态，不翻转、不追加 history
      kept++;
    } else {
      // 判定与依据提交同源：存在非留痕的含单号提交 → done，否则 submitted
      status = basis ? 'done' : 'submitted';
      const meta = readItemMeta(item);
      const st = {
        id: item.id,
        type: item.type,
        title: meta.title,
        status,
        parent: null,
        owner: null,
        createdAt: meta.createdAt || now,
        updatedAt: now,
        agentCompletedAt: null,
        lastReport: null,
        history: [{ at: now, from: null, to: status, by: REBUILD_ACTOR, note: `rebuild 从 git 历史重建（${basisText}）` }],
      };
      writeJsonAtomic(path.join(statusDir, `${item.id}.json`), st);
      written++;
    }
    if (status === 'done') doneCount++;
    else submittedCount++;
    lines.push({ id: item.id, status, basis, kept: keptIds.has(item.id) });
  }

  return {
    dataDir,
    projectRoot,
    isRepo: repo,
    total: items.length,
    done: doneCount,
    submitted: submittedCount,
    written,
    kept,
    lines,
  };
}
