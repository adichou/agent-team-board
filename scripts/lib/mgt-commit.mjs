// REQ-20260914-007 管理记录自动提交（mgt-commit）—— 两个人工闭环入口的入库数据层。
// 职责：
//   1. 确认完成（in-progress → done）成功后，自动提交本次刷新的条目 status.json 与
//      confirmations.md / decisions.md 等条目管理留痕文档；
//   2. 版本合并成功写入最终结果后，自动提交 builds/versions/<BLD>/version.json ——
//      提交到持有最终版本数据的合并目标分支 main（当前分支非 main 时经临时工作树隔离执行，
//      不切换当前工作区分支、不推送远端），并在当前分支做同内容提交使工作区不再遗留记录；
//   3. 提交纪律：路径限定提交（git add 指定路径 + git commit --only），绝不全量 add，
//      不夹带业务源码 / 其他条目 / 未跟踪需求资料 / 用户预先暂存内容；目标文件操作前已暂存
//      且暂存内容与本次产物不同（无法安全分离）→ 不提交，pendingManual 明确报告待人工；
//   4. 幂等：无新变化 → noop（已同步）不制造空提交；重试与重复请求不重复提交；
//   5. 失败反馈：结果持久化到被忽略的账本目录 commits/mgt/（刷新 / 重启后仍可见），
//      重试只补交管理记录，成功（committed / noop）后清除失败提示；
//   6. 串行协调：同一数据目录的管理记录 Git 写操作经 .locks/mgt-git-write.lock 文件锁串行。
// 提交失败不抛出到业务层：结果对象如实返回（status/原因/文件/建议），业务状态不受影响。

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AtbError, acquireLock, releaseLock, resolveItemDir } from './core.mjs';
import { validateCommitSubject } from './commit-store.mjs';

const GIT_TIMEOUT_MS = 120_000;
const LOCK_STALE_MS = 60_000;
const MGT_LOCK = 'mgt-git-write.lock';
const MGT_IGNORE_LINE = 'commits/mgt/';
// 待人工处理的通用建议（pendingManual 场景）
const PENDING_MANUAL_ADVICE =
  '目标文件暂存区已有与本次产物不同的内容，无法安全分离：请人工核对暂存区后自行提交'
  + '（提交消息带单号），再点「重试提交」补交剩余管理记录。';

const nowIso = () => new Date().toISOString();
const sha1Of = (file) => {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};
const relOf = (repoTop, abs) => path.relative(repoTop, abs).split(path.sep).join('/');

function gitRaw(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
}

function gitOk(root, args, label) {
  const r = gitRaw(root, args);
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
    throw new AtbError(`${label || `git ${args[0]}`}失败${detail ? `：${detail}` : ''}`.slice(0, 300));
  }
  return String(r.stdout || '');
}

export function isGitRepo(root) {
  const r = gitRaw(root, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

// ---------- 目标文件集合 ----------

// 确认完成的目标管理文件（操作前静态确定；提交时按「本次确有刷新」过滤，未刷新不卷入）
export function itemMgtFiles(dataDir, itemId) {
  const { dir } = resolveItemDir(dataDir, itemId);
  return ['status.json', 'confirmations.md', 'decisions.md'].map((n) => path.join(dir, n));
}

// 版本合并的目标管理文件（version.json）
export function versionMgtFile(dataDir, versionId) {
  return path.join(dataDir, 'builds', 'versions', String(versionId || ''), 'version.json');
}

// ---------- 操作前基线 ----------

function repoTopOf(root) {
  return String(gitRaw(root, ['rev-parse', '--show-toplevel']).stdout || '').trim() || root;
}

// 指定路径的 porcelain 状态码映射（'clean' = 不在脏列表；其余 XY 码原样，?? 为未跟踪）
function porcelainCodes(root, absFiles) {
  const out = gitRaw(root, ['status', '--porcelain', '-uall']);
  const byName = new Map();
  if (out.status === 0) {
    for (const line of String(out.stdout || '').split('\n')) {
      if (!line) continue;
      const code = line.slice(0, 2);
      let p = line.slice(3).trim();
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
      if (p) byName.set(p, code);
    }
  }
  const repoTop = repoTopOf(root);
  const codes = {};
  for (const f of absFiles) codes[f] = byName.has(relOf(repoTop, f)) ? byName.get(relOf(repoTop, f)) : 'clean';
  return codes;
}

// 操作前基线：目标文件内容哈希 + porcelain 状态码（入口在业务操作前调用）
export function beforeBaseline(root, absFiles) {
  const sha1 = {};
  for (const f of absFiles) sha1[f] = sha1Of(f);
  if (!isGitRepo(root)) return { isRepo: false, sha1 };
  return { isRepo: true, sha1, codes: porcelainCodes(root, absFiles), repoTop: repoTopOf(root) };
}

// ---------- 账本（被忽略目录 commits/mgt/：刷新 / 重启后失败提示仍可见） ----------

const mgtDir = (dataDir) => path.join(dataDir, 'commits', 'mgt');
const stateFileOf = (dataDir, kind, id) =>
  path.join(mgtDir(dataDir), `${kind}-${String(id || '').replace(/[^A-Za-z0-9-]/g, '')}.json`);

// 幂等补一行 'commits/mgt/'；账本目录不进版本控制 → 状态反馈不引起受跟踪文件反复变脏。
// 该一次性 .gitignore 变更随下一次管理提交一并收纳（见 pendingIgnoreExtra）。
function ensureLedgerIgnore(dataDir) {
  const gi = path.join(dataDir, '.gitignore');
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  if (cur.split('\n').includes(MGT_IGNORE_LINE)) return false;
  try {
    fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + MGT_IGNORE_LINE + '\n');
    return true;
  } catch {
    return false;
  }
}

function writeState(dataDir, result) {
  try {
    // 账本目录先保证被忽略（幂等一次性补行；.gitignore 变更随下一次管理提交一并收纳）
    ensureLedgerIgnore(dataDir);
    fs.mkdirSync(mgtDir(dataDir), { recursive: true });
    fs.writeFileSync(stateFileOf(dataDir, result.kind, result.id), JSON.stringify(result, null, 2));
  } catch { /* 账本写失败不影响主流程（提交结果仍随响应返回） */ }
}

export function readMgtState(dataDir, kind, id) {
  try {
    return JSON.parse(fs.readFileSync(stateFileOf(dataDir, kind, id), 'utf8'));
  } catch {
    return null;
  }
}

// .gitignore 的待收纳判断：文件当前脏，且 HEAD 版本尚未包含账本忽略行（我们的未入库变更）。
// HEAD 已含该行但仍脏说明是用户自己的其他编辑，不卷入。
function pendingIgnoreExtra(projectRoot, repoTop, dataDir) {
  const gi = path.join(dataDir, '.gitignore');
  if (!fs.existsSync(gi)) return [];
  const rel = relOf(repoTop, gi);
  if (!gitRaw(projectRoot, ['status', '--porcelain', '--', rel]).stdout.trim()) return [];
  const head = gitRaw(projectRoot, ['show', `HEAD:${rel}`]);
  const headText = head.status === 0 ? String(head.stdout || '') : '';
  return headText.split('\n').includes(MGT_IGNORE_LINE) ? [] : [gi];
}

// ---------- 提交执行（路径限定；沿用 git-flow 既定 add + commit --only 模式） ----------

function shortHashOf(root, hash) {
  const r = gitRaw(root, ['rev-parse', '--short', hash]);
  return r.status === 0 ? String(r.stdout).trim() : String(hash).slice(0, 7);
}

// 在 root（当前工作区）路径限定提交：逐路径 add（未跟踪文件需要），commit --only 只提交
// 指定路径的工作区内容，不卷入预先暂存的其他内容。
function commitPathsInWorktree(root, repoTop, absFiles, subject, branch) {
  const rels = absFiles.map((f) => relOf(repoTop, f));
  for (const rel of rels) gitOk(root, ['add', '-A', '--', rel], 'git add');
  gitOk(root, ['commit', '-q', '--only', '-m', subject, '--', ...rels], 'git commit');
  const hash = gitOk(root, ['rev-parse', 'HEAD'], '读取提交号').trim();
  return { hash, short: shortHashOf(root, hash), subject, branch: branch || null };
}

// 提交到 main：当前分支即 main → 原地；否则临时工作树检出 main 隔离执行（不切当前分支、
// 不触碰当前工作区）。把目标文件内容复制进临时工作树后提交；main 已持有同内容 → 无提交（已同步）。
function commitVersionToMain(root, repoTop, absFiles, subject, currentBranch) {
  if (currentBranch === 'main') {
    return [commitPathsInWorktree(root, repoTop, absFiles, subject, 'main')];
  }
  gitOk(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], 'main 分支不存在');
  let wt = null;
  try {
    const base = (() => {
      try {
        const p = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-wt-probe-'));
        fs.rmSync(p, { recursive: true, force: true });
        return os.tmpdir();
      } catch {
        return '.git/atb-tmp';
      }
    })();
    wt = path.join(base, `atb-mgt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const r = gitRaw(root, ['worktree', 'add', wt, 'main']);
    if (r.status !== 0) {
      const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
      throw new AtbError(`创建管理提交工作树失败：${detail}`.slice(0, 200));
    }
    for (const f of absFiles) {
      const rel = relOf(repoTop, f);
      const dst = path.join(wt, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(f, dst);
      gitOk(wt, ['add', '--', rel], 'git add');
    }
    const commits = [];
    if (gitRaw(wt, ['diff', '--cached', '--quiet']).status !== 0) { // 有差异才提交，不制造空提交
      gitOk(wt, ['commit', '-q', '-m', subject], 'git commit');
      const hash = gitOk(wt, ['rev-parse', 'HEAD'], '读取提交号').trim();
      commits.push({ hash, short: shortHashOf(root, hash), subject, branch: 'main' });
    }
    return commits;
  } finally {
    if (wt) {
      if (gitRaw(root, ['worktree', 'remove', '--force', wt]).status !== 0) {
        gitRaw(root, ['worktree', 'prune']);
      }
    }
  }
}

// ---------- 分类（确定性归因） ----------

// XY 码判定：X（index 位）非空白且非 '?' → 暂存位有内容（含混合）。
// 工作区-only 脏（' M'）是条目管理记录的历史写入（如作答决策后的 decisions.md），
// 属本闭环应收纳的管理变更，不视为夹带；暂存位是否有「别的」内容需比对 blob（见 retry）。
const hasStagedEntry = (code) => code !== 'clean' && code !== '??' && code[0] !== ' ';

// 工作区文件的 git blob 哈希（与 index 条目可比）
function blobShaOf(root, abs) {
  const r = gitRaw(root, ['hash-object', abs]);
  return r.status === 0 ? String(r.stdout).trim() : null;
}

// 指定路径的 index blob 哈希（未入 index 为 null）
function indexBlobsOf(root, repoTop, absFiles) {
  const out = new Map();
  const r = gitRaw(root, ['ls-files', '-s', '--', ...absFiles.map((f) => relOf(repoTop, f))]);
  if (r.status !== 0) return out;
  for (const line of String(r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const [meta, p] = line.split('\t');
    const sha = (meta || '').split(/\s+/)[1] || null;
    if (p) out.set(p, sha);
  }
  return out;
}

// 初次分类（业务操作前基线 → 操作后）：
//   未刷新 → 不纳入（不触碰用户改动）；刷新且操作前暂存位有内容 → pendingManual；
//   其余（干净 / 工作区-only 脏 / 未跟踪）→ 可安全提交。
function classifyInitial(baseline, absFiles) {
  const refreshed = [];
  const pendingManual = [];
  const files = [];
  for (const f of absFiles) {
    const after = sha1Of(f);
    if (after == null || after === baseline.sha1[f]) continue;
    refreshed.push(f);
    files.push({ path: relOf(baseline.repoTop, f), sha1: after });
    if (baseline.codes && hasStagedEntry(baseline.codes[f])) pendingManual.push(f);
  }
  return { refreshed, pendingManual, files };
}

// 重试分类（按账本记录的内容哈希复核当前态，不重放业务操作）：
//   已 clean → 已同步；工作区内容与账本一致且暂存位无「别的」内容 → 可补交；
//   否则（内容已再变 / 暂存内容与本次产物不同）→ 待人工。
//   「暂存位无别的内容」= 无暂存条目，或暂存 blob 与工作区一致（如上次失败提交的 git add
//   遗留、soft reset 场景——提交不丢失任何内容）。
function classifyRetry(root, repoTop, state) {
  const absOf = (p) => path.join(repoTop, p);
  const absFiles = state.files.map((x) => absOf(x.path));
  const codes = porcelainCodes(root, absFiles);
  const idx = indexBlobsOf(root, repoTop, absFiles);
  const safe = [];
  const synced = [];
  const pendingManual = [];
  for (const rec of state.files) {
    const abs = absOf(rec.path);
    const code = codes[abs];
    if (code === 'clean') { synced.push(abs); continue; }
    if (sha1Of(abs) !== rec.sha1) { pendingManual.push(abs); continue; }
    if (hasStagedEntry(code) && idx.get(rec.path) !== blobShaOf(root, abs)) {
      pendingManual.push(abs); // 暂存内容与本次产物不同：无法安全分离
      continue;
    }
    safe.push(abs);
  }
  return { safe, synced, pendingManual };
}

// ---------- 结果装配 ----------

function resultOf({ kind, id, subject, status, commits = [], files = [], pendingManual = [], reason = null, advice = null }) {
  return {
    kind, id, status, subject,
    commits: commits.map((c) => ({ ...c })),
    files: files.map((f) => ({ path: f.path, sha1: f.sha1 })),
    pendingManual,
    reason, advice,
    updatedAt: nowIso(),
  };
}

// ---------- 主入口（业务操作成功后调用；永不抛错，失败如实入结果） ----------

// 确认完成管理提交。baseline 需为操作前采集（itemMgtFiles + beforeBaseline）。
export function commitItemDoneMgmt({ dataDir, projectRoot, itemId, baseline }) {
  const subject = `doc: 人工确认完成 ${itemId}`;
  return runGuarded({ dataDir, kind: 'item', id: itemId, subject }, () => {
    if (!baseline || !baseline.isRepo) {
      const r = resultOf({ kind: 'item', id: itemId, subject, status: 'skipped', reason: '项目不是 git 仓库，管理记录未自动提交（可人工提交）' });
      writeState(dataDir, r);
      return r;
    }
    const { refreshed, pendingManual, files } = classifyInitial(baseline, itemMgtFiles(dataDir, itemId));
    return performCommit({
      dataDir, projectRoot, kind: 'item', id: itemId, subject, repoTop: baseline.repoTop,
      refreshed, pendingManual, files, toMain: false,
      noopReason: '本次操作没有新的管理变更，视为已同步',
    });
  });
}

// 版本合并管理提交。baseline 需在合并开始前采集（versionMgtFile + beforeBaseline）。
export function commitVersionMergeMgmt({ dataDir, projectRoot, versionId, baseline }) {
  const subject = `doc: 版本合并记录 ${versionId}`;
  return runGuarded({ dataDir, kind: 'version', id: versionId, subject }, () => {
    if (!baseline || !baseline.isRepo) {
      const r = resultOf({ kind: 'version', id: versionId, subject, status: 'skipped', reason: '项目不是 git 仓库，管理记录未自动提交（可人工提交）' });
      writeState(dataDir, r);
      return r;
    }
    const { refreshed, pendingManual, files } = classifyInitial(baseline, [versionMgtFile(dataDir, versionId)]);
    return performCommit({
      dataDir, projectRoot, kind: 'version', id: versionId, subject, repoTop: baseline.repoTop,
      refreshed, pendingManual, files, toMain: true,
      noopReason: '版本记录无新变化，视为已同步',
    });
  });
}

// 重试：只补交管理记录（不重放确认完成 / 版本合并）
export function retryMgmt({ dataDir, projectRoot, kind, id }) {
  const state = readMgtState(dataDir, kind, id);
  if (!state || !Array.isArray(state.files) || !state.files.length) {
    throw new AtbError(`没有可重试的管理记录提交（${kind} ${id}）`);
  }
  const subject = state.subject || `doc: 管理记录补交 ${id}`;
  return runGuarded({ dataDir, kind, id, subject }, () => {
    if (!isGitRepo(projectRoot)) {
      const r = resultOf({ kind, id, subject, status: 'skipped', reason: '项目不是 git 仓库，无法补交' });
      writeState(dataDir, r);
      return r;
    }
    const repoTop = repoTopOf(projectRoot);
    const { safe, pendingManual } = classifyRetry(projectRoot, repoTop, state);
    return performCommit({
      dataDir, projectRoot, kind, id, subject, repoTop,
      refreshed: safe, pendingManual, files: state.files,
      toMain: kind === 'version',
      noopReason: '管理记录已全部入库，无新变化',
    });
  });
}

// ---------- 内部：锁、提交与结果落账 ----------

function runGuarded({ dataDir, kind, id, subject }, fn) {
  const lockPath = path.join(dataDir, '.locks', MGT_LOCK);
  let locked = false;
  try {
    try {
      acquireLock(lockPath, LOCK_STALE_MS, { owner: 'mgt-commit', at: nowIso() });
      locked = true;
    } catch (e) {
      // 串行协调：锁被占如实返回 failed（另一管理提交正在进行，可稍后重试）。
      // 瞬态占用不落账本——覆盖会抹掉既有 files 基线，导致锁释放后无法重试。
      return resultOf({ kind, id, subject, status: 'failed', reason: `${String(e.message || e).slice(0, 160)}（另一管理记录提交正在进行，可稍后重试）` });
    }
    return fn();
  } catch (e) {
    const r = resultOf({ kind, id, subject, status: 'failed', reason: String(e && e.message ? e.message : e).slice(0, 200) });
    writeState(dataDir, r);
    return r;
  } finally {
    if (locked) releaseLock(lockPath);
  }
}

const pendingReasonOf = (relPaths) =>
  `目标文件含无法安全分离的其他变更（操作前已暂存），待人工处理：${relPaths.slice(0, 5).join('、')}${relPaths.length > 5 ? ` 等 ${relPaths.length} 个` : ''}`;

function performCommit({
  dataDir, projectRoot, kind, id, subject, repoTop,
  refreshed, pendingManual, files, toMain, noopReason,
}) {
  const relPending = pendingManual.map((f) => relOf(repoTop, f));

  // 已暂存且无法安全分离 → 整操作不提交（不覆盖暂存内容），明确报告待人工处理
  if (relPending.length) {
    const r = resultOf({
      kind, id, subject, status: 'failed', files,
      pendingManual: relPending, reason: pendingReasonOf(relPending), advice: PENDING_MANUAL_ADVICE,
    });
    writeState(dataDir, r);
    return r;
  }
  if (!refreshed.length) {
    const r = resultOf({ kind, id, subject, status: 'noop', reason: noopReason });
    writeState(dataDir, r);
    return r;
  }

  ensureLedgerIgnore(dataDir); // writeState 亦会兜底；此处提前保证本次提交即可收纳忽略行
  const err0 = validateCommitSubject(subject, id);
  if (err0) {
    const r = resultOf({ kind, id, subject, status: 'failed', files, reason: `提交说明不合规：${err0}` });
    writeState(dataDir, r);
    return r;
  }

  try {
    // 账本 .gitignore 的一次性变更随本次当前分支提交一并收纳（不长期留脏；main 侧不卷入）
    const extra = pendingIgnoreExtra(projectRoot, repoTop, dataDir);
    const currentBranch = String(gitRaw(projectRoot, ['branch', '--show-current']).stdout || '').trim();
    if (!currentBranch) throw new AtbError('当前处于 detached HEAD，无法提交管理记录');

    const commits = [];
    if (toMain) {
      // 版本记录提交到持有最终版本数据的合并目标分支 main（当前即 main 时原地提交，
      // 账本 .gitignore 忽略行随本次一并收纳；临时工作树侧不卷入看板共享文件）
      const inPlaceExtra = currentBranch === 'main' ? extra : [];
      commits.push(...commitVersionToMain(projectRoot, repoTop, [...refreshed, ...inPlaceExtra], subject, currentBranch));
    }
    if (!(toMain && currentBranch === 'main')) {
      // 当前分支同内容提交（版本场景避免工作区遗留记录；条目场景即主提交）
      commits.push(commitPathsInWorktree(projectRoot, repoTop, [...refreshed, ...extra], subject, currentBranch));
    }
    if (!commits.length) {
      const r = resultOf({ kind, id, subject, status: 'noop', reason: '管理记录已同步（目标分支无新变化）', files });
      writeState(dataDir, r);
      return r;
    }
    const r = resultOf({ kind, id, subject, status: 'committed', commits, files });
    writeState(dataDir, r);
    return r;
  } catch (e) {
    const r = resultOf({
      kind, id, subject, status: 'failed', files,
      reason: String(e && e.message ? e.message : e).slice(0, 180),
      advice: '管理文件已保留在工作区：排查原因（如 Git 身份配置 / 锁文件 / 钩子）后点「重试提交」补交；已成功的业务操作不受影响。',
    });
    writeState(dataDir, r);
    return r;
  }
}
