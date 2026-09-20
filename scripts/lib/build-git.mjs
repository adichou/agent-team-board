// REQ-20260913-001 构建模块 Git 执行层（build-git）—— server.mjs 使用，全部 spawnSync 本机 git。
// 只提供 design.md 落定的六类操作：分支列表（只读）、分支提交记录（只读）、同步远端
//（受限写：BUG-20260914-011 起 = fetch --all --prune 后推送除主分支外的本地开发分支，
// 使本地与远端记录一致；主分支归发布模块，不在此推送）、推送分支 push（受限写，首推建立
// 上游）、合并入主分支（受限写：临时工作树隔离执行 + 逐条目 --no-ff 合并 + 冲突即 abort，
// 不触碰当前工作树）。除此外不提供任何 git 写操作（无 pull / rebase / 删分支 / 改历史 / --force）。
// REQ-20260916-005：主分支统一解析（优先 main，本地仅 master 时回退 master）——同步跳过
// 名单与合并目标均按解析结果取用。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtbError } from './core.mjs';
import { resolveMainBranch } from './git-flow.mjs';

const GIT_TIMEOUT_MS = 120_000;
// 临时工作树根：优先系统临时目录；不可用（或挂载不允许执行 git）时回退项目内 .git/atb-tmp
function realTmpdir() {
  try {
    const p = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-wt-probe-'));
    fs.rmSync(p, { recursive: true, force: true });
    return os.tmpdir();
  } catch {
    return '.git/atb-tmp';
  }
}
// ref 名校验：防参数注入（不以 - 开头；仅安全字符；不含 .. ；无空白与 git 非法字符）
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

function gitRaw(root, args, timeout = GIT_TIMEOUT_MS) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout });
}

function gitOk(root, args, label) {
  const r = gitRaw(root, args);
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 4).join('；');
    throw new AtbError(`${label || `git ${args[0]}`}失败${detail ? `：${detail}` : ''}`.slice(0, 400));
  }
  return String(r.stdout || '');
}

export function isGitRepo(root) {
  const r = gitRaw(root, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

export function assertRefName(branch) {
  const name = String(branch || '').trim();
  if (!name || !REF_RE.test(name) || name.includes('..') || name.endsWith('.lock') || name.includes('//')) {
    throw new AtbError(`分支名不合法：${branch || '（空）'}`);
  }
  return name;
}

// 只读：当前分支 + 本地分支 + 远端分支（origin/xxx 短名；排除 origin/HEAD 指针）+ 已配置远端名。
// BUG-20260914-006：remotes（git remote，本地配置读、非网络）供前端区分
// 「未配置远端」/「已配置但本地无跟踪引用」/「同步成功后仍为空 = 远端仓库为空」三种空态。
// REQ-20260916-005：mainBranch = 主分支解析结果（优先 main，本地仅有 master 时回退
// master，两者皆无为 null）——前端 main 缺失提示与主分支行推送豁免以此为准。
export function listBranches(root) {
  if (!isGitRepo(root)) return { isRepo: false, current: null, local: [], remote: [], remotes: [], mainBranch: null };
  const current = String(gitRaw(root, ['branch', '--show-current']).stdout || '').trim() || null;
  const local = String(gitRaw(root, ['branch', '--format=%(refname:short)']).stdout || '')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const remote = String(gitRaw(root, ['branch', '-r', '--format=%(refname:short)']).stdout || '')
    .split('\n').map((s) => s.trim())
    .filter((s) => s && !s.endsWith('/HEAD'));
  return { isRepo: true, current, local, remote, remotes: remoteNames(root), mainBranch: resolveMainBranch(root) };
}

// 只读：指定分支提交记录（分页，新→旧）。BUG-20260914-009：放开原「默认 50 / 上限 200 且无翻页」
// 截断——limit 缺省 50、归一 clamp [1,500]；offset 缺省 0、负数归 0（git log -n + --skip 偏移）；
// 附 rev-list --count 总数 total，响应 { branch, commits, total, limit, offset }，
// offset ≥ total 时返回空页（前端按 total 计算页码不会请求，接口层保持宽容不报错）。
// REQ-20260920-001：每条 commit 附 parents（%P 父提交 hash 数组，根提交为 []）——前端拓扑图
// 连线以真实父子关系为据，不得从主题文本 / 行序推测。
export function branchLog(root, branch, { limit = 50, offset = 0 } = {}) {
  const ref = assertRefName(branch);
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库，无法读取提交记录');
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  const skip = Math.max(0, Math.floor(Number(offset) || 0));
  gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], '分支不存在');
  const total = Number(gitOk(root, ['rev-list', '--count', ref], '统计提交总数').trim()) || 0;
  const out = gitOk(root, ['log', ref, '-n', String(n), '--skip', String(skip), '--format=%H%x09%h%x09%an%x09%aI%x09%P%x09%s'], '读取提交记录');
  const commits = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [hash, short, author, date, parentsRaw, ...rest] = line.split('\t');
    commits.push({ hash, short, author, date, parents: parentsRaw ? parentsRaw.split(' ') : [], subject: rest.join('\t') });
  }
  return { branch: ref, commits, total, limit: n, offset: skip };
}

// 只读：指定分支提交记录关键词搜索（REQ-20260914-002）——提交说明 subject / 作者 author /
// 短 hash / 完整 hash 四字段任一命中即算，大小写不敏感的固定子串匹配（非正则）。一次读全量
// 提交元数据在 Node 侧过滤（关键词不进 git 参数，无注入面），limit/offset 在命中结果上分页
//（归一口径同 branchLog），total 为命中总数，响应 { branch, query, commits, total, limit, offset }；
// q 空白（trim 后空）走 branchLog 默认分页。校验口径与 branchLog 一致（assertRefName / 非仓库 /
// refs/heads/<ref> 存在性），纯只读，不引入任何 git 写操作。
// REQ-20260920-001：命中行同样解析 parents（口径与 branchLog 一致）。
export function branchSearchLog(root, branch, { q, limit = 50, offset = 0 } = {}) {
  const ref = assertRefName(branch);
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库，无法读取提交记录');
  const kw = String(q || '').trim().slice(0, 200);
  if (!kw) return branchLog(root, ref, { limit, offset });
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  const skip = Math.max(0, Math.floor(Number(offset) || 0));
  gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], '分支不存在');
  const out = gitOk(root, ['log', ref, '--format=%H%x09%h%x09%an%x09%aI%x09%P%x09%s'], '搜索提交记录');
  const lower = kw.toLowerCase();
  const hits = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [hash, short, author, date, parentsRaw, ...rest] = line.split('\t');
    const subject = rest.join('\t');
    if (subject.toLowerCase().includes(lower) || author.toLowerCase().includes(lower)
      || short.toLowerCase().includes(lower) || hash.toLowerCase().includes(lower)) {
      hits.push({ hash, short, author, date, parents: parentsRaw ? parentsRaw.split(' ') : [], subject });
    }
  }
  return { branch: ref, query: kw, commits: hits.slice(skip, skip + n), total: hits.length, limit: n, offset: skip };
}

// 受限写：同步远端（fetch --all --prune；附带清理失效远端分支引用——design.md 落定口径）。
export function fetchRemote(root) {
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库：请先初始化 git（可经 atb init），再同步远端');
  const r = gitRaw(root, ['fetch', '--all', '--prune']);
  const output = String(r.stderr || r.stdout || '').trim();
  if (r.status !== 0) throw new AtbError(`同步远端失败：${output.split('\n').filter(Boolean).slice(0, 4).join('；')}`.slice(0, 400));
  return { ok: true, output: output.slice(0, 800) };
}

// 受限写：与远端同步（BUG-20260914-011 design.md 落定口径）——先 fetch --all --prune（失败即
// 整体抛错，不进推送），再推送除主分支外的全部本地分支（主分支归发布模块管理，不在此推送；
// 未建上游的首推 -u 建立跟踪），使本地与远端记录一致。单分支推送失败不中断其他分支，逐条
// 收集结果（failed 含原因）；不用 --force、不强推——远端领先（非快进被拒）时该分支计入
// failed 并携带 git 原因，不自动改写本地历史。远端未显式指定时 origin 优先、否则取已配置
// 远端第一个（与分支行推送确认框默认一致）。
// REQ-20260916-005：受控推送跳过名单与主分支解析结果一致——本地仅有 master 的历史仓库
// 跳过 master（dev 等其余分支照常推送）；main 与 master 并存仍只跳 main（无回归）。
export function syncRemote(root, { remote } = {}) {
  fetchRemote(root); // 前置校验（非 git 仓库）+ fetch 失败整体报错口径复用
  const remotes = remoteNames(root);
  if (!remotes.length) throw new AtbError('尚未配置远端（git remote add origin <url>），无法与远端同步');
  const rm = String(remote || '').trim();
  const target = rm && remotes.includes(rm) ? rm : (remotes.includes('origin') ? 'origin' : remotes[0]);
  const mainBranch = resolveMainBranch(root);
  const pushed = [];
  const failed = [];
  const skipped = [];
  for (const branch of listBranches(root).local) {
    if (mainBranch && branch === mainBranch) { skipped.push(branch); continue; } // 主分支：发布模块受控推送
    try {
      pushed.push({ branch, ...pushBranch(root, { remote: target, branch }) });
    } catch (e) {
      failed.push({ branch, error: String(e && e.message ? e.message : e).slice(0, 300) });
    }
  }
  return { ok: failed.length === 0, remote: target, fetch: { ok: true }, pushed, failed, skipped };
}

function remoteNames(root) {
  return String(gitRaw(root, ['remote']).stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// 本地分支是否已建立上游跟踪；返回 { remote, merge } 或 null。
function upstreamOf(root, branch) {
  const r = gitRaw(root, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
  if (r.status !== 0) return null;
  const full = String(r.stdout || '').trim(); // 形如 origin/dev
  const i = full.indexOf('/');
  if (i <= 0) return null;
  return { remote: full.slice(0, i), merge: full.slice(i + 1) };
}

// 受限写：推送本地分支到远端。未建立上游跟踪的分支首推加 -u 建立跟踪（design.md 落定口径）。
export function pushBranch(root, { remote, branch } = {}) {
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库：请先初始化 git（可经 atb init），再推送分支');
  const ref = assertRefName(branch);
  const rm = String(remote || '').trim();
  if (!REF_RE.test(rm)) throw new AtbError(`远端名不合法：${rm || '（空）'}`);
  if (!remoteNames(root).includes(rm)) throw new AtbError(`远端 ${rm} 未配置（git remote add ${rm} <url>）`);
  gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], '本地分支不存在');
  const hadUpstream = upstreamOf(root, ref);
  const args = hadUpstream && hadUpstream.remote === rm
    ? ['push', rm, ref]
    : ['push', '-u', rm, ref];
  const r = gitRaw(root, args);
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 4).join('；');
    throw new AtbError(`推送 ${ref} 到 ${rm} 失败：${detail}`.slice(0, 400));
  }
  return { ok: true, setUpstream: !(hadUpstream && hadUpstream.remote === rm), remoteBranch: `${rm}/${ref}`, hadUpstream: !!hadUpstream };
}

// 合并前置校验（只读，状态变更前由服务端调用）：非仓库 / 主分支缺失 / 提交缺失 / detached。
// 工作区不再要求干净：合并经临时工作树执行（见 mergeCommitsIntoMain），不触碰当前工作区。
// 返回当前分支（仅用于记录 baseBranch；合并本身不切分支）。
// REQ-20260916-005：合并目标按主分支解析结果取 main 或 master（本地仅 master 的历史
// 仓库以 master 为目标，不再报「main 分支不存在」）；两者皆无（如 dev-only 未补建）
// 时仍按 main 报缺失（与 build.js main 缺失提示口径一致）。
export function precheckMerge(root, items = []) {
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库：请先初始化 git（可经 atb init），再合并入 main');
  const baseBranch = String(gitRaw(root, ['branch', '--show-current']).stdout || '').trim();
  if (!baseBranch) throw new AtbError('当前处于 detached HEAD，无法自动合并；请先切到一个本地分支');
  gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${resolveMainBranch(root) || 'main'}`], 'main 分支不存在');
  for (const it of items) {
    const r = gitRaw(root, ['rev-parse', '--verify', '--quiet', `${it.commit}^{commit}`]);
    if (r.status !== 0) throw new AtbError(`提交不存在：${it.itemId} → ${String(it.commit).slice(0, 12)}`);
  }
  return baseBranch;
}

// 受限写：把版本所选条目的 commit 逐条合并入主分支（--no-ff 保留合并语义，消息含版本与条目号）。
// 执行隔离（design.md 落定口径）：当前分支非主分支时，在 os.tmpdir() 建临时工作树检出台
// 主分支，逐条 merge 后移除——全程不切换、不触碰用户当前工作区（未提交改动保留、不被卷入，
// 脏工作区不阻塞）；单条失败即中止并 git merge --abort，已成功条目保持已合并（重试只补
// 未合并，幂等续传：已在主分支的提交再合并返回 Already up to date，结果仍为成功）。
// REQ-20260916-005：主分支名按解析结果取 main 或 master（回退 master 场景合并入 master）。
export function mergeCommitsIntoMain(root, { versionId, versionName, items = [] } = {}) {
  const baseBranch = precheckMerge(root, items);
  const targetBranch = resolveMainBranch(root) || 'main';
  const results = [];
  const warnings = [];
  const inPlace = baseBranch === targetBranch; // 当前就在主分支：原地合并，无需临时工作树
  let wt = null;
  if (!inPlace) {
    wt = path.join(realTmpdir(), `atb-merge-${versionId || 'v'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const r = gitRaw(root, ['worktree', 'add', wt, targetBranch]);
    if (r.status !== 0) {
      const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
      throw new AtbError(`创建合并工作树失败：${detail}`.slice(0, 300));
    }
  }
  const cwd = inPlace ? root : wt;
  try {
    for (const it of items) {
      const msg = `build: ${versionName || versionId} 合并 ${it.itemId}（${versionId}）`;
      const r = gitRaw(cwd, ['merge', '--no-ff', '-m', msg, it.commit]);
      if (r.status === 0) {
        results.push({ itemId: it.itemId, commit: it.commit, ok: true });
        continue;
      }
      const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
      gitRaw(cwd, ['merge', '--abort']); // 冲突现场清理（best-effort，不吞并报错）
      results.push({ itemId: it.itemId, commit: it.commit, ok: false, error: detail.slice(0, 300) || '合并失败' });
      break; // 逐条推进：一条失败即中止，保留已成功条目供重试续传
    }
  } finally {
    if (wt) {
      const rm = gitRaw(root, ['worktree', 'remove', '--force', wt]);
      if (rm.status !== 0) {
        gitRaw(root, ['worktree', 'prune']);
        warnings.push(`临时合并工作树清理失败（${String(rm.stderr || '').trim().slice(0, 120)}），可忽略或手动 git worktree prune`);
      }
    }
  }
  return { results, baseBranch, warnings };
}
