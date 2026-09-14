// REQ-20260911-009 dev 分支开发 + 到待测试自动 commit —— Git 工作流数据层。
// 三个职责：
//   1. 初始化：ensureDevWorkflow —— 按需 `git init`（-b main）、按需创建 dev 分支并把
//      工作区切到 dev（幂等；空仓库走「未出生分支改名」等价路径），并幂等补建本地 main
//      （BUG-20260914-003：该路径下 main 从未出生，详见 ensureMainBranch）。只做本地分支
//      操作，不 push、不配置远端、不执行丢弃/还原/暂存无关改动。
//   2. 自动提交：autoCommitForRun —— 批量开发回执核验通过（reported）后，以
//      「领取时工作区快照 → 收尾时差集」做确定性归因，把本单改动按 doc / test /
//      业务三组提交（git add -A 指定路径 + git commit --only，只 commit 不 push）。
//      由 atb 进程内部 spawnSync 执行，不经 Agent Bash 工具，天然不受 state-guard
//      拦截（REQ-20260911-009 授权口径：批量批次内 = 视同人工授权）。
//   3. 索引：itemCommitLog / itemOfCommit —— 条目 ↔ commit 双向关联；正向与看板
//      「已提交」徽标同源（账本 committedItemIndex + git 历史消息含单号扫描）。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  AtbError,
  writeJsonAtomic,
  resolveItemDir,
  readStatus,
} from './core.mjs';
import {
  DESC_MAX_CHARS,
  TEST_PATH_PREFIX,
  validateCommitSubject,
  itemCommittedInGit,
  committedItemIndex,
} from './commit-store.mjs';

export const DEV_BRANCH = 'dev';
export const MAIN_BRANCH = 'main';
// 快照/提交时路径分块上限（防超长命令行）
const PATH_CHUNK = 200;
const GIT_TIMEOUT_MS = 60_000;

const nowIso = () => new Date().toISOString();

function gitRaw(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
}

function gitOk(root, args, label) {
  const r = gitRaw(root, args);
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
    throw new AtbError(`${label || `git ${args[0]}`}失败${detail ? `：${detail}` : ''}`);
  }
  return String(r.stdout || '');
}

// ---------- 1. 分支初始化（initData / 设置页按钮共用） ----------

export function isGitRepo(root) {
  const r = gitRaw(root, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

// 只读分支状态（设置页加载用）：branch 在非仓库/detached 时为 null。
// devExists：refs/heads/dev 存在，或当前就在 dev（空仓库未出生的 dev 也算已就绪）。
export function gitBranchState(root) {
  if (!isGitRepo(root)) return { isRepo: false, branch: null, devExists: false };
  const branch = String(gitRaw(root, ['branch', '--show-current']).stdout || '').trim() || null;
  const devExists = branch === DEV_BRANCH
    || gitRaw(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${DEV_BRANCH}`]).status === 0;
  return { isRepo: true, branch, devExists };
}

// 幂等初始化：非 git 项目 → git init -b main；随后按需创建 dev 并切换工作区。
// 空仓库（尚无任何提交）：HEAD 未出生，`git switch -c dev` 等价于把未出生分支改名，
// 首个提交自然落在 dev（README「待确认」的等价方案结论）。
// BUG-20260914-003：该路径使 `refs/heads/main` 从未出生（构建模块「合并入 main」与
// 分支浏览均以本地 main 存在为前提）——收尾调用 ensureMainBranch 幂等补建。
export function ensureDevWorkflow(root) {
  if (!isGitRepo(root)) {
    gitOk(root, ['init', '-q', '-b', MAIN_BRANCH], 'git init');
  }
  const before = gitBranchState(root);
  let devCreated = false;
  let switched = false;
  if (!before.devExists) {
    // 空仓库（HEAD 未出生）时等价于把未出生分支改名为 dev，首个提交自然落在 dev
    gitOk(root, ['switch', '-q', '-c', DEV_BRANCH], '创建 dev 分支');
    devCreated = true;
    switched = true;
  } else if (before.branch !== DEV_BRANCH) {
    gitOk(root, ['switch', '-q', DEV_BRANCH], '切换到 dev 分支');
    switched = true;
  }
  const after = gitBranchState(root);
  if (after.branch !== DEV_BRANCH) {
    throw new AtbError(`初始化后当前分支应为 ${DEV_BRANCH}（实际 ${after.branch || '未知'}）`);
  }
  const mainCreated = ensureMainBranch(root);
  return { isRepo: true, gitInited: !before.isRepo, devCreated, switched, mainCreated, before, after };
}

// BUG-20260914-003 main 出生保障（幂等补建，ensureDevWorkflow 收尾调用）：
// 仓库已有提交且 `refs/heads/main` 缺失时，在当前分支历史的根提交
// （`git rev-list --max-parents=0 HEAD` 首行；多根历史取首行，罕见场景）上
// `git branch main <root>` 补建本地 main——只创建分支，不切换、不推送、不触碰工作区。
// 空仓库（HEAD 未出生，尚无基点）跳过不报错；main 已存在不动。补建后本地 main 作为
// 版本合并目标累积合并提交，口径与 build-git precheckMerge「main 分支不存在」一致。
export function ensureMainBranch(root) {
  if (gitRaw(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${MAIN_BRANCH}`]).status === 0) {
    return false; // main 已存在：幂等不动
  }
  const roots = gitRaw(root, ['rev-list', '--max-parents=0', 'HEAD']);
  if (roots.status !== 0) return false; // HEAD 未出生（尚无提交）：无补建基点
  const first = String(roots.stdout || '').trim().split('\n').map((s) => s.trim()).filter(Boolean)[0];
  if (!first) return false;
  gitOk(root, ['branch', MAIN_BRANCH, first], '补建 main 分支');
  return true;
}

// ---------- 2. 工作区快照与归因 ----------
// BUG-20260913-006：预留时已脏的已跟踪文件也记录内容哈希（trackedHashes）；差集区分
// changed（可归因）与 dirtyTouched（预留前已脏且本单动过——无法安全归因，待人工），
// 收尾不再静默留脏。

const sha1Of = (file) => {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

// 工作区快照：porcelain 条目 path→XY 码；未跟踪文件（??）与预留时已脏的已跟踪文件
// 都记录内容哈希——这两类的 porcelain 码不随内容修改变化，必须以内容哈希探测变更。
// BUG-20260913-006：预留时已脏的已跟踪文件原先只有状态码（如 ' M'），运行期再改仍同码，
// 差集永远看不到 → 改动永久无归属、静默留脏；比照未跟踪文件补记内容哈希作识别基线。
// 旧快照（无 trackedHashes 字段）没有内容基线：差集维持升级前行为，不做猜测归因。
// 非 git 项目返回 null（自动提交跳过）。
export function workingTreeSnapshot(root) {
  if (!isGitRepo(root)) return null;
  const out = gitRaw(root, ['status', '--porcelain', '-uall']);
  if (out.status !== 0) return null;
  const entries = {};
  const untracked = {};
  const trackedHashes = {};
  for (const line of String(out.stdout || '').split('\n')) {
    if (!line) continue;
    const code = line.slice(0, 2);
    let p = line.slice(3).trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (p.includes(' -> ')) p = p.split(' -> ').pop().trim(); // 重命名取目标路径
    if (!p) continue;
    entries[p] = code;
    const h = sha1Of(path.join(root, p));
    if (code === '??') {
      if (h != null) untracked[p] = h;
    } else if (h != null) {
      trackedHashes[p] = h; // 预留时已脏的已跟踪文件（含暂存/工作区任一位脏）
    }
  }
  return { entries, untracked, trackedHashes, at: nowIso() };
}

// 快照 → 现在的差集（BUG-20260913-006 细化口径）：
//   changed      —— 状态码变化或未跟踪内容哈希变化的路径（可确定性归因，进本单 test/业务组）；
//   dirtyTouched —— 预留时已脏（快照有 trackedHashes 基线）且状态码不变但内容哈希变化的
//                   路径：无法区分「预留前改动」与「本单改动」，不得整文件自动提交 → 待人工。
// 已被提交的路径退出 porcelain（不再脏）→ 不再计入（重试不重复提交）；
// 预留前就脏且运行期间未动过的路径保持同码同哈希 → 不计入（不卷入无关改动）。
export function diffWorkingTree(root, snapshot) {
  const now = workingTreeSnapshot(root);
  if (!now || !snapshot) return null;
  const changed = [];
  const dirtyTouched = [];
  for (const [p, code] of Object.entries(now.entries)) {
    const beforeCode = snapshot.entries ? snapshot.entries[p] : undefined;
    if (code === '??') {
      const beforeHash = snapshot.untracked ? snapshot.untracked[p] : undefined;
      const nowHash = now.untracked[p];
      if (beforeHash !== nowHash) changed.push(p); // 新未跟踪文件（beforeHash=undefined）或内容已变
      continue;
    }
    if (beforeCode !== code) { changed.push(p); continue; }
    const beforeHash = snapshot.trackedHashes ? snapshot.trackedHashes[p] : undefined;
    if (beforeHash == null) continue; // 旧快照无哈希基线 / 预留时该路径未脏：无可比内容
    const nowHash = now.trackedHashes ? now.trackedHashes[p] : undefined;
    if (nowHash !== beforeHash) dirtyTouched.push(p); // 同码但内容变：预留前已脏且本单动过
  }
  return { changed, dirtyTouched };
}

// 兼容口径：快照以来发生变化的全部路径（含待人工的 dirtyTouched）。
export function changedPathsSince(root, snapshot) {
  const diff = diffWorkingTree(root, snapshot);
  if (!diff) return null;
  return [...diff.changed, ...diff.dirtyTouched];
}

// 数据账本 .gitignore 补齐：自动提交账本目录（commits/runs、commits/batches）不进版本控制。
// 返回是否发生修改（看板共享文件由 doc 组整体收纳，保持工作区干净）。
function ensureLedgerIgnore(dataDir) {
  const gi = path.join(dataDir, '.gitignore');
  const wanted = ['commits/runs/', 'commits/batches/'];
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  const add = wanted.filter((l) => !cur.split('\n').includes(l));
  if (!add.length) return false;
  fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + add.join('\n') + '\n');
  return true;
}

// ---------- 3. 到待测试自动提交 ----------

// 条目目录相对路径归属解析：boardRel 下的路径 → 所属条目编号（首个 REQ-/BUG- 段）
function owningItemIdOf(boardRel, p) {
  const pref = boardRel ? boardRel + '/' : 'docs/agent-team-board/';
  if (!p.startsWith(pref)) return null;
  const m = /^(?:requirements|bugs)\/((?:REQ|BUG)-\d{8}-\d{3,})(?:\/|$)/.exec(p.slice(pref.length));
  return m ? m[1] : null;
}

function commitSubjectOf(type, desc, itemId) {
  return `${type}: ${desc} ${itemId}`;
}

function commitPaths(root, paths, subject) {
  for (let i = 0; i < paths.length; i += PATH_CHUNK) {
    gitOk(root, ['add', '-A', '--', ...paths.slice(i, i + PATH_CHUNK)], 'git add');
  }
  // --only：只提交指定路径的工作区内容，不卷入预留前已暂存的其他内容
  for (let i = 0; i < paths.length; i += PATH_CHUNK) {
    gitOk(root, ['commit', '-q', '--only', '-m', subject, '--', ...paths.slice(i, i + PATH_CHUNK)], 'git commit');
  }
  const hash = gitOk(root, ['rev-parse', 'HEAD'], '读取提交号').trim();
  return { hash, subject };
}

// 自动提交主入口（永不抛错：失败原样记录，改动保留在工作区，可 atb run autocommit 重试）。
// run 需携带预留时的工作区快照（batch.nextItem 写入 run.treeSnapshot）。
export function autoCommitForRun({ dataDir, projectRoot, run }) {
  const itemId = run.itemId;
  try {
    if (!isGitRepo(projectRoot)) {
      return { status: 'skipped', commits: [], reason: '项目不是 git 仓库，无法自动提交' };
    }
    // 幂等：git 历史已含单号 → 整单跳过（重复上报/回执重放不产生新提交）。
    // 例外：上次尝试 failed（可能已有部分组提交落历史）时按差集续传，已提交路径已
    // 退出脏集合天然去重，不做整单跳过——否则部分失败的单永远补不齐剩余分组。
    const prevFailed = run.autoCommit && run.autoCommit.status === 'failed';
    if (!prevFailed && itemCommittedInGit(projectRoot, itemId)) {
      return { status: 'skipped', commits: [], reason: 'git 历史已含该单号提交（幂等跳过）' };
    }
    if (!run.treeSnapshot || !run.treeSnapshot.entries) {
      return { status: 'skipped', commits: [], reason: '缺少预留时工作区快照（旧版本预留），不做猜测归因；可人工核对后经批量 commit 提交' };
    }
    ensureLedgerIgnore(dataDir);
    const nowSnap = workingTreeSnapshot(projectRoot);
    if (!nowSnap) {
      return { status: 'skipped', commits: [], reason: '无法读取当前工作区状态，跳过自动提交' };
    }
    // BUG-20260913-006：diff 细化为 changed（可归因）与 dirtyTouched（预留前已脏且本单
    // 动过、同码内容变——无法区分预留前/本单改动，不得整文件自动提交）。
    const diff = diffWorkingTree(projectRoot, run.treeSnapshot);
    const changed = diff ? diff.changed : [];
    const dirtyTouched = diff ? diff.dirtyTouched : [];
    if (!changed.length && !dirtyTouched.length && !Object.keys(nowSnap.entries).length) {
      return { status: 'skipped', commits: [], reason: '本单无待提交改动（工作区相对预留时无变化）' };
    }

    const itemDir = resolveItemDir(dataDir, itemId).dir;
    const title = readStatus(itemDir).title || itemId;
    const desc = [...String(title)].slice(0, DESC_MAX_CHARS).join('');
    const repoTop = gitOk(projectRoot, ['rev-parse', '--show-toplevel'], '定位仓库根').trim();
    const itemRel = path.relative(repoTop, itemDir);
    const boardRel = path.relative(repoTop, dataDir);
    const boardPref = boardRel + '/';

    // 归因集合（design 定稿口径）：
    //   doc 组 = 看板数据目录内当前全部脏路径，排除其他条目目录——本单条目目录整体
    //            纳入（含预留前注册产生的未跟踪文档，它们从属于本单）；看板共享文件
    //            （.gitignore / config.json / dispatch 索引等）随本单 doc 提交收纳；
    //   test / 业务组 = 严格按快照差集（非看板路径）——预留前已存在的无关改动绝不卷入。
    //   BUG-20260913-006：非看板路径若「预留前已脏且本单动过」（同码内容变，或码也变
    //   但快照有预留前内容基线——整文件提交会连带预留前旧脏内容），不自动归因，列入
    //   pendingManual 待人工核对，不再静默留脏。
    const groups = { doc: [], test: [], biz: [] };
    const excluded = [];
    const pendingManual = [];
    const preReservedDirty = (p) => Boolean(
      run.treeSnapshot.trackedHashes && run.treeSnapshot.trackedHashes[p] != null,
    );
    const allDirty = new Set([...Object.keys(nowSnap.entries), ...changed, ...dirtyTouched]);
    for (const p of allDirty) {
      const inItem = itemRel && (p === itemRel || p.startsWith(itemRel + '/'));
      if (p.startsWith(boardPref) || inItem) {
        const owner = owningItemIdOf(boardRel, p);
        if (owner && owner !== itemId && !inItem) { excluded.push(p); continue; }
        groups.doc.push(p);
        continue;
      }
      if (dirtyTouched.includes(p) || (changed.includes(p) && preReservedDirty(p))) {
        pendingManual.push(p); // 预留前已脏且本单动过：无法安全归因 → 待人工
        continue;
      }
      if (!changed.includes(p)) continue; // 看板外路径只认快照差集
      if (p.startsWith(TEST_PATH_PREFIX)) groups.test.push(p);
      else groups.biz.push(p);
    }

    const bizType = itemId.startsWith('REQ') ? 'feat' : 'fix';
    let plan = [
      ['doc', groups.doc, commitSubjectOf('doc', desc, itemId)],
      ['test', groups.test, commitSubjectOf('test', desc, itemId)],
      ['biz', groups.biz, commitSubjectOf(bizType, desc, itemId)],
    ].filter(([, paths]) => paths.length);

    // BUG-20260913-006 历史自洽：存在待人工的非看板路径时，本单 test/业务组一并暂扣——
    // 待人工路径可能正是被测实现（本 Bug 即 build.js），单独提交 test 会重演「测试已
    // 提交、被测代码未提交」的矛盾历史。doc 组（看板数据，整目录归属本单）照常提交。
    const heldGroups = pendingManual.length
      ? { test: groups.test.slice(), biz: groups.biz.slice() }
      : null;
    if (pendingManual.length) plan = plan.filter(([kind]) => kind === 'doc');

    if (!plan.length) {
      // 无可自动提交分组（可能仍有待人工路径）：明细如实落盘，不误报 committed
      const reason = manualPendingReason(pendingManual, heldGroups);
      if (pendingManual.length) {
        writeAutoCommitLedger(dataDir, { run, itemId, title, commits: [], excluded, pendingManual, heldGroups });
      }
      return pendingManual.length
        ? { status: 'skipped', commits: [], excluded, pendingManual, heldGroups, reason }
        : { status: 'skipped', commits: [], reason: '变更均不归属本单（其他条目/账本文件），已保留在工作区' };
    }

    const commits = [];
    for (const [kind, paths, subject] of plan) {
      const c = commitPaths(projectRoot, paths, subject);
      const err = validateCommitSubject(c.subject, itemId);
      if (err) throw new AtbError(`${kind} 组提交消息不合规：${err}`);
      commits.push(c);
    }

    // 账本登记（与人工批量 commit 的 committedItemIndex 同源 → 看板「已提交」徽标点亮）
    writeAutoCommitLedger(dataDir, { run, itemId, title, commits, excluded, pendingManual, heldGroups });
    return pendingManual.length
      ? {
        status: 'committed', // 部分提交（doc 组）；待人工路径与暂扣组显式携带，不表现为全量
        commits,
        excluded,
        pendingManual,
        heldGroups,
        reason: manualPendingReason(pendingManual, heldGroups),
      }
      : { status: 'committed', commits, excluded, reason: null };
  } catch (e) {
    return { status: 'failed', commits: [], reason: String(e && e.message ? e.message : e).slice(0, 200) };
  }
}

// BUG-20260913-006 待人工路径的处理建议（落 auto-commit.json 明细）：
// 不做 hunk 级 diff 归属拆分（无法可靠归因）；人工核对后整文件提交（消息带单号），
// 再补提交暂扣的 test/业务路径。
const PENDING_MANUAL_ADVICE =
  '人工核对该路径中「预留前改动 / 本单改动」的归属后整文件提交（提交消息带单号），'
  + '再补提交暂扣的 test/业务路径；自动提交不做猜测归属，也不会拆分 hunk。';

// 待人工原因短句（≤200 字）：列路径与暂扣计数，供回执与账本引用。
function manualPendingReason(pendingManual, heldGroups) {
  const shown = pendingManual.slice(0, 5).join('、')
    + (pendingManual.length > 5 ? ` 等 ${pendingManual.length} 个` : '');
  const held = heldGroups ? heldGroups.test.length + heldGroups.biz.length : 0;
  return `预留前已脏且本单运行期被修改、无法安全归因，待人工核对提交：${shown}`
    + (held ? `；本单 test/业务 ${held} 个路径已一并暂扣待人工处理后补提交` : '');
}

// 自动提交账本：写入 commits/runs/（runId 采用 commit 账本形态），phase=committed 供
// committedItemIndex 收录；完整明细另落 dispatch 运行目录 auto-commit.json。
// BUG-20260913-006：仅有待人工路径、无实际提交时不写 commits/runs（徽标不误点亮），
// 但明细仍落盘如实记录 pendingManual（路径 + 建议）与 heldGroups。
function writeAutoCommitLedger(dataDir, { run, itemId, title, commits, excluded, pendingManual, heldGroups }) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex');
  const runId = `run-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${rand}`;
  const pending = Array.isArray(pendingManual) ? pendingManual : [];
  const record = {
    version: 1,
    runId,
    batchId: `auto:${run.runId}`,
    itemId,
    itemTitle: title,
    owner: 'auto-commit',
    phase: 'committed',
    createdAt: nowIso(),
    finishedAt: nowIso(),
    reason: null,
    summary: pending.length
      ? `到待测试自动提交（部分提交 ${commits.length} 组，${pending.length} 个路径待人工处理）`
      : '到待测试自动提交（AI 开发回执核验通过）',
    commits,
    autoForRun: run.runId,
  };
  if (commits.length) {
    const dir = path.join(dataDir, 'commits', 'runs', runId);
    fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(path.join(dir, 'run.json'), record);
  }
  // 明细（运行目录，dispatch/runs 已被 .gitignore 排除）
  try {
    const runDir = path.join(dataDir, 'dispatch', 'runs', run.runId);
    fs.mkdirSync(runDir, { recursive: true });
    writeJsonAtomic(path.join(runDir, 'auto-commit.json'), {
      ...record,
      status: commits.length ? 'committed' : 'skipped',
      excluded: excluded || [],
      pendingManual: pending,
      pendingManualAdvice: pending.length ? PENDING_MANUAL_ADVICE : undefined,
      ...(heldGroups ? { heldGroups } : {}),
    });
  } catch { /* 明细写失败不影响主流程 */ }
  return record;
}

// ---------- 4. 条目 ↔ commit 双向索引 ----------

// 正向：条目 → 全部提交。账本（经核验）与 git 历史（消息含单号）合并去重，按时间升序。
export function itemCommitLog(dataDir, projectRoot, itemId) {
  const byHash = new Map();
  const rec = committedItemIndex(dataDir).get(itemId);
  if (rec) {
    for (const h of rec.commits || []) byHash.set(h, { hash: h, subject: '', via: 'ledger' });
  }
  if (isGitRepo(projectRoot)) {
    const r = gitRaw(projectRoot, ['log', '--format=%H%x09%s']);
    if (r.status === 0) {
      for (const line of String(r.stdout || '').split('\n')) {
        if (!line.includes(itemId)) continue;
        const [h, ...rest] = line.split('\t');
        const subject = rest.join('\t');
        if (h && !byHash.has(h)) byHash.set(h, { hash: h, subject, via: 'git' });
        else if (h && byHash.has(h)) byHash.get(h).subject = subject;
      }
    }
  }
  return [...byHash.values()];
}

// 反向：commit（hash 或消息文本）→ 条目。提取消息中的 REQ-/BUG- 单号并核验条目存在。
export function itemOfCommit(dataDir, projectRoot, hashOrText) {
  let text = String(hashOrText || '').trim();
  if (/^[0-9a-f]{7,40}$/i.test(text) && isGitRepo(projectRoot)) {
    const r = gitRaw(projectRoot, ['show', '-s', '--format=%B', text]);
    if (r.status !== 0) return null;
    text = String(r.stdout || '');
  }
  const ids = text.match(/(?:REQ|BUG)-\d{8}-\d{3,}/g) || [];
  for (const id of [...new Set(ids)]) {
    try {
      const st = readStatus(resolveItemDir(dataDir, id).dir);
      return { itemId: id, title: st.title };
    } catch { /* 编号不在本看板：继续找下一个 */ }
  }
  return null;
}

// 批量版正向索引（REQ-20260911-010 已完成列表提交状态徽标的数据源，itemCommitLog 的
// 一次 git log 服务全部条目版本）：账本（committedItemIndex，含自动提交记录）∪ git 历史
// （消息含单号即关联）合并去重。一个 commit 消息含多个单号时自然关联多条目（一个 commit
// 可以关联多个单号）；一个单号可关联多个 commit（自动提交 doc/test/业务分组）。
// 非 git 项目退化为仅账本聚合。返回 Map<itemId, { itemId, commits, lastCommittedAt }>。
export function itemCommitStatusIndex(dataDir, projectRoot) {
  const byItem = new Map();
  const merge = (itemId, hash, at) => {
    const rec = byItem.get(itemId) || { itemId, commits: [], lastCommittedAt: null };
    if (hash && !rec.commits.includes(hash)) rec.commits.push(hash);
    if (at && String(at) > String(rec.lastCommittedAt || '')) rec.lastCommittedAt = at;
    byItem.set(itemId, rec);
  };
  for (const rec of committedItemIndex(dataDir).values()) {
    for (const h of rec.commits || []) merge(rec.itemId, h, rec.lastCommittedAt);
  }
  if (isGitRepo(projectRoot)) {
    const r = gitRaw(projectRoot, ['log', '--format=%H%x09%cI%x09%s']);
    if (r.status === 0) {
      for (const line of String(r.stdout || '').split('\n')) {
        const [hash, at, ...rest] = line.split('\t');
        if (!hash) continue;
        const subject = rest.join('\t');
        const ids = subject.match(/(?:REQ|BUG)-\d{8}-\d{3,}/g) || [];
        for (const id of new Set(ids)) merge(id, hash, at);
      }
    }
  }
  return byItem;
}
