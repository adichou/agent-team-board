// 提交规范与已提交索引共享内核（原 REQ-20260910-013 批量 commit 数据层的保留部分）。
// REQ-20260911-010 回退人工触发的批量 Commit（CMT 批次）流程：创建/领取/回执核验/
// 暂停/终止/排队等执行函数整体移除，本地 git 提交唯一路径为 REQ-20260911-009 的
// 「开发完成到待测试自动提交」（scripts/lib/git-flow.mjs）。本模块只保留其底层复用件：
//   1. 提交规范常量与主题核验（validateCommitSubject）——自动提交消息与 atb commit log 共用；
//   2. git 只读幂等判定（gitLogMessages / itemCommittedInGit）；
//   3. committedItemIndex——条目 → 经核验成功提交索引（REQ-009 自动提交账本同源；
//      存量 CMT 核验记录保留在 commits/runs/ 内，聚合天然兼容，不做破坏性删除）。
// 对 git 只做只读操作；不提供任何提交/推送/丢弃通道。全部 JSON 原子写入；Agent 不手写。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const REASON_MAX_CHARS = 200;   // 失败原因 / 摘要上限（与批次回执口径一致）
export const RECEIPT_MAX_BYTES = 2048; // 回执/check 协议载荷上限
// 提交消息规范：类型五选一前缀 + 描述（不含单号）非空且 ≤120 字 + 消息含单号。
// BUG-20260914-021：上限 20 → 120，与 core.mjs 条目标题上限（≤120 字）对齐——自动提交
// 描述即条目标题，标题合规则消息必然过核验；拼装端不再截断，超上限走显式报错。
export const COMMIT_TYPES = ['feat', 'fix', 'chore', 'doc', 'test'];
export const DESC_MAX_CHARS = 120;
// 测试代码路径前缀（README：本项目测试代码集中在 scripts/tests/*.test.mjs）
export const TEST_PATH_PREFIX = 'scripts/tests/';

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// ---------- 目录助手（事实源：<dataDir>/commits/runs/<runId>/run.json） ----------

export function commitsDir(dataDir) {
  return path.join(dataDir, 'commits');
}
export function commitRunsDir(dataDir) {
  return path.join(commitsDir(dataDir), 'runs');
}

// ---------- git 只读助手（本模块不执行任何 git 写操作） ----------

function gitRaw(projectRoot, args) {
  return spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', timeout: 30_000 });
}

export function isGitRepo(projectRoot) {
  const r = gitRaw(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

// 全量提交消息（%B 拼接）：幂等判定依据——「git 历史已含该单号」
export function gitLogMessages(projectRoot) {
  const r = gitRaw(projectRoot, ['log', '--format=%B%x00']);
  return r.status === 0 ? String(r.stdout || '') : '';
}

export function itemCommittedInGit(projectRoot, itemId, logText = null) {
  const text = logText != null ? logText : gitLogMessages(projectRoot);
  return text.includes(itemId);
}

// ---------- 提交规范核验（REQ-20260911-009 自动提交共用） ----------

const SUBJECT_RE = new RegExp(`^(${COMMIT_TYPES.join('|')}):\\s*(.+)$`);

// 主题行核验：五类前缀 + 含单号 + 描述（去前缀与单号）非空且 ≤120 字（BUG-20260914-021 口径）
export function validateCommitSubject(subject, itemId) {
  const subj = String(subject || '').trim();
  const m = SUBJECT_RE.exec(subj);
  if (!m) {
    return `提交消息主题必须是「类型: 描述 单号」（类型限 ${COMMIT_TYPES.join('/')}）：${subj}`;
  }
  if (!subj.includes(itemId)) return `提交消息必须包含单号 ${itemId}：${subj}`;
  // 描述 = 主题行去掉「类型: 」前缀与单号后的剩余文本（不含单号）
  const desc = subj
    .slice(subj.indexOf(':') + 1)
    .replace(new RegExp(itemId, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!desc) return `提交消息描述不能为空（格式「类型: 描述 单号」）：${subj}`;
  if ([...desc].length > DESC_MAX_CHARS) {
    return `提交消息描述超过 ${DESC_MAX_CHARS} 字（不含单号，当前 ${[...desc].length} 字）：${subj}`;
  }
  return null;
}

// ---------- 条目已提交索引（看板「已提交」徽标数据源，只读） ----------

// 条目 → 经核验的成功提交索引：仅统计 phase=committed 的运行（REQ-20260911-009 自动提交
// 账本；存量 CMT done 回执核验记录同口径）的完整 hash；失败/跳过/中断不计入——与
// 「不得仅凭存在任意 Git hash 推定条目已提交」口径一致。同一条目多次运行按创建时间序
// 合并去重；返回 Map<itemId, record>。
export function committedItemIndex(dataDir) {
  const dir = commitRunsDir(dataDir);
  const byItem = new Map();
  if (!fs.existsSync(dir)) return byItem;
  const runs = fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'run.json')))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const r of runs) {
    if (r.phase !== 'committed' || !r.itemId) continue;
    const rec = byItem.get(r.itemId) || { itemId: r.itemId, commits: [], batchIds: [] };
    for (const c of r.commits || []) {
      if (c && c.hash && !rec.commits.includes(c.hash)) rec.commits.push(c.hash);
    }
    if (r.batchId && !rec.batchIds.includes(r.batchId)) rec.batchIds.push(r.batchId);
    rec.lastCommittedAt = r.finishedAt || r.createdAt || rec.lastCommittedAt || null;
    byItem.set(r.itemId, rec);
  }
  return byItem;
}
