// REQ-20260913-001 构建模块 Git 执行层（build-git）—— server.mjs 使用，全部 spawnSync 本机 git。
// 只提供 design.md 落定的六类操作：分支列表（只读）、分支提交记录（只读）、同步远端
//（受限写：BUG-20260914-011 起 = fetch --all --prune 后推送除主分支外的本地开发分支，
// 使本地与远端记录一致；主分支归发布模块，不在此推送）、推送分支 push（受限写，首推建立
// 上游）、合并入主分支（受限写：临时工作树隔离执行 + 逐条目 --no-ff 合并 + 冲突即 abort，
// 不触碰当前工作树）。除此外不提供任何 git 写操作（无 pull / rebase / 删分支 / 改历史 / --force）。
// REQ-20260916-005：主分支统一解析（优先 main，本地仅 master 时回退 master）——同步跳过
// 名单与合并目标均按解析结果取用。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtbError } from './core.mjs';
import { DEV_BRANCH, resolveMainBranch } from './git-flow.mjs';
import { docLangsOf, customDocsOf } from './publish-flow.mjs';

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
// REQ-20260921-002：每条 commit 附 tags（指向该提交的标签名数组；无标签为 []）——提交树
// tag 标签与「message / 分支名 / tag」搜索以此为准。
// BUG-20260921-006：dev 单支口径——浏览 dev 只显示 dev 可达提交（等价 git log dev），
// 不再混入 main 独有提交（含「合并入 main」产生的版本合并提交），也不附并集专属字段。
// BUG-20260921-008：main（含 master 回退）也改回单支口径——回退 BUG-20260920-002 为主分支
// 引入的 main∪dev 双支并集（dualBranchScope / branchUnionLog 随之移除），所有分支一律
// 单支可达集合，响应不再附 heads / mergeBase / side；已并入 main 的 dev 提交经合并提交
// 自然可达，仍会出现在 main 视图。
export function branchLog(root, branch, { limit = 50, offset = 0 } = {}) {
  const ref = assertRefName(branch);
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库，无法读取提交记录');
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  const skip = Math.max(0, Math.floor(Number(offset) || 0));
  gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], '分支不存在');
  const total = Number(gitOk(root, ['rev-list', '--count', ref], '统计提交总数').trim()) || 0;
  const out = gitOk(root, ['log', ref, '-n', String(n), '--skip', String(skip), '--format=%H%x09%h%x09%an%x09%aI%x09%P%x09%s'], '读取提交记录');
  const tagMap = readCommitTags(root);
  const commits = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const row = parseLogLine(line);
    commits.push({ ...row, tags: tagMap.get(row.hash) || [] });
  }
  return { branch: ref, commits, total, limit: n, offset: skip };
}

// REQ-20260921-002：log --format 行解析（%H %h %an %aI %P %s，制表符分隔；subject 含余下制表符）。
function parseLogLine(line) {
  const [hash, short, author, date, parentsRaw, ...rest] = line.split('\t');
  return { hash, short, author, date, parents: parentsRaw ? parentsRaw.split(' ') : [], subject: rest.join('\t') };
}

// REQ-20260921-002：commit → 标签名数组映射（一次 for-each-ref 只读；annotated tag 以解引用
// %(*objectname) 取实际 commit，lightweight tag 的 objectname 即 commit hash）。
function readCommitTags(root) {
  const out = gitOk(root, ['for-each-ref', 'refs/tags',
    '--format=%(refname:short)%09%(objectname)%09%(*objectname)'], '读取标签');
  const map = new Map();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [name, obj, deref] = line.split('\t');
    const hash = String(deref || obj || '').trim();
    if (!name || !/^[0-9a-f]{7,40}$/i.test(hash)) continue;
    if (!map.has(hash)) map.set(hash, []);
    map.get(hash).push(name.trim());
  }
  return map;
}

// 只读：指定分支提交记录关键词搜索，双模式（REQ-20260914-002 搜索能力，REQ-20260921-002 升级）。
// 匹配字段（大小写不敏感固定子串，非正则）：提交说明 subject / 作者 author / 短 hash / 完整 hash
// / 标签名 tags（REQ-20260921-002）/ 分支名（选中分支名命中 ⇒ 数据集全部提交）。关键词不进
// git 参数（无注入面），一次读全量提交元数据在 Node 侧匹配。
// BUG-20260921-008：随 main 单支口径回退 BUG-20260920-002 的双支并集搜索语义——数据集恒为
// 所选分支单支可达集合（等价 git log <branch>），不再按双支 heads 名命中 side，响应不附
// heads / mergeBase / side（BUG-20260920-002 引入、BUG-20260921-006 起 dev 侧已无）。
// - mode=filter（默认）：保留集 = 匹配 ∪ 祖先闭包（沿 parents 回溯到根），在保留集上分页；
//   响应 { branch, query, mode, commits, total=保留集数, matchedTotal=匹配数, allTotal=全量数,
//   limit, offset }——泳道连通不断线。
// - mode=highlight：数据集与默认分页一致（不过滤），附全量命中清单 matchedHashes（数据集顺序）
//   与 matchedTotal，前端渲染后高亮定位；total 为全量数（分页条口径不变）。
// q 空白（trim 后空）走 branchLog 默认分页；mode 非法值归一为 filter。校验口径与 branchLog
// 一致（assertRefName / 非仓库 / refs/heads/<ref> 存在性），纯只读。
export function branchSearchLog(root, branch, { q, mode = 'filter', limit = 50, offset = 0 } = {}) {
  const ref = assertRefName(branch);
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库，无法读取提交记录');
  const kw = String(q || '').trim().slice(0, 200);
  if (!kw) return branchLog(root, ref, { limit, offset });
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  const skip = Math.max(0, Math.floor(Number(offset) || 0));
  gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], '分支不存在');
  // 全量读取（含 parents / tags），匹配与闭包在 Node 侧完成
  const tagMap = readCommitTags(root);
  const out = gitOk(root, ['log', ref, '--format=%H%x09%h%x09%an%x09%aI%x09%P%x09%s'], '搜索提交记录');
  const all = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const row = parseLogLine(line);
    all.push({ ...row, tags: tagMap.get(row.hash) || [] });
  }
  // 匹配集（六字段 + 选中分支名语义）
  const lower = kw.toLowerCase();
  const branchHit = ref.toLowerCase().includes(lower);
  const matched = all.filter((c) => {
    if (branchHit) return true;
    return c.subject.toLowerCase().includes(lower)
      || c.author.toLowerCase().includes(lower)
      || c.short.toLowerCase().includes(lower)
      || c.hash.toLowerCase().includes(lower)
      || (c.tags || []).some((tg) => tg.toLowerCase().includes(lower));
  });
  const matchedHashes = matched.map((c) => c.hash);
  const modeN = mode === 'highlight' ? 'highlight' : 'filter';
  const payload = {
    branch: ref,
    query: kw,
    mode: modeN,
    matchedTotal: matchedHashes.length,
    allTotal: all.length,
    limit: n,
    offset: skip,
  };
  if (modeN === 'highlight') {
    payload.commits = all.slice(skip, skip + n);
    payload.total = all.length;
    payload.matchedHashes = matchedHashes;
    return payload;
  }
  // filter：保留集 = 匹配 ∪ 祖先闭包（沿全量 parents，含不在匹配集内的中间提交）
  const byHash = new Map(all.map((c) => [c.hash, c]));
  const kept = new Set(matchedHashes);
  const stack = [...matchedHashes];
  while (stack.length) {
    const cur = byHash.get(stack.pop());
    if (!cur) continue;
    for (const p of cur.parents) {
      if (!kept.has(p)) { kept.add(p); stack.push(p); }
    }
  }
  const keptList = all.filter((c) => kept.has(c.hash));
  payload.commits = keptList.slice(skip, skip + n);
  payload.total = keptList.length;
  return payload;
}

// （BUG-20260920-002 引入的 main∪dev 双支并集读取——dualBranchScope / branchUnionLog
//  ——已随 BUG-20260921-008「main 单支口径」整段移除：所有分支一律单支可达集合。）

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

// BUG-20260921-015：条目多提交口径——items[].commits（数组）为事实源，旧单提交形态
//（items[].commit）读取时兜底为 [commit]；隔离分析 / 合并重放 / 前置校验均按展开后的
// 提交集合工作（与 build-store.commitsOf 同语义，Git 层不依赖数据层）。
function commitsOf(it) {
  const arr = Array.isArray(it?.commits) && it.commits.length
    ? it.commits
    : (it?.commit ? [it.commit] : []);
  return [...new Set(arr.map((h) => String(h || '').trim().toLowerCase()).filter(Boolean))];
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
    for (const c of commitsOf(it)) {
      const r = gitRaw(root, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`]);
      if (r.status !== 0) throw new AtbError(`提交不存在：${it.itemId} → ${c.slice(0, 12)}`);
    }
  }
  return baseBranch;
}

// BUG-20260921-015：把（条目 × 提交）展开为逐提交行，并按 Git 依赖顺序（祖先在前）排序，
// 供合并重放使用——补入的提交与原关联提交必须按真实父子顺序重放，乱序存储在同文件连续
// 变更场景会冲突。排序实现：rev-list --topo-order --reverse（新→旧反转即父先于子）从全部
// 所选提交出发、排除目标分支可达历史后过滤回所选集合；已在目标分支内的提交不在输出中
//（执行侧 isAncestorOf 幂等跳过），按输入顺序追加在末尾。rev-list 失败时回退输入顺序
//（保留旧行为，不因排序失败阻塞合并）。
function replayPairsOrdered(root, items, targetBranch) {
  const pairs = [];
  for (const it of items || []) {
    for (const c of commitsOf(it)) pairs.push({ itemId: String(it.itemId || ''), commit: c });
  }
  if (pairs.length < 2) return pairs;
  const unique = [...new Set(pairs.map((p) => p.commit))];
  let seq = [];
  try {
    const out = gitOk(root, ['rev-list', '--topo-order', '--reverse', `^${targetBranch}`, ...unique], '依赖排序');
    const inSet = new Set(unique);
    seq = out.split('\n').map((s) => s.trim().toLowerCase()).filter((h) => h && inSet.has(h));
  } catch { /* 排序失败回退输入顺序 */ }
  if (seq.length !== unique.length) {
    const seen = new Set(seq);
    seq = [...seq, ...unique.filter((h) => !seen.has(h))];
  }
  const rank = new Map(seq.map((h, i) => [h, i]));
  return pairs.map((p, i) => ({ ...p, i })).sort((a, b) => (rank.get(a.commit) ?? a.i) - (rank.get(b.commit) ?? b.i))
    .map(({ i, ...p }) => p);
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
    // BUG-20260921-015：一条目多提交逐条展开合并（it.commit 单提交路径等价保留）
    outer:
    for (const it of items) {
      for (const commit of commitsOf(it)) {
        const msg = `build: ${versionName || versionId} 合并 ${it.itemId}（${versionId}）`;
        const r = gitRaw(cwd, ['merge', '--no-ff', '-m', msg, commit]);
        if (r.status === 0) {
          results.push({ itemId: it.itemId, commit, ok: true });
          continue;
        }
        const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
        gitRaw(cwd, ['merge', '--abort']); // 冲突现场清理（best-effort，不吞并报错）
        results.push({ itemId: it.itemId, commit, ok: false, error: detail.slice(0, 300) || '合并失败' });
        break outer; // 逐条推进：一条失败即中止，保留已成功条目供重试续传
      }
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

/* ---------- REQ-20260920-003 发布流程：dev 前置 / 隔离合并 / 主分支推送 / 官网读取 ---------- */

// 发布前置（人工确认口径）：当前工作目录必须在 dev——main、其他分支及 detached HEAD 一律
// 阻止合并与推送，提示自行切回 dev 后重试；不自动切分支，也不允许经隔离执行绕过该前置。
export function assertOnDev(root) {
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库：请先初始化 git（可经 atb init）');
  const current = String(gitRaw(root, ['branch', '--show-current']).stdout || '').trim();
  if (!current) {
    throw new AtbError('当前处于 detached HEAD：请自行切换回 dev 后重试（发布前置：工作目录必须在 dev 分支）');
  }
  if (current !== DEV_BRANCH) {
    throw new AtbError(`当前分支是 ${current}，不在 dev：请自行切换回 dev 后重试（不自动切分支，也不能绕过该前置）`);
  }
  return current;
}

// 只读：commit 是否为 ref 的祖先（merge-base --is-ancestor）。
export function isAncestorOf(root, commit, ref) {
  const h = String(commit || '').trim().toLowerCase();
  if (!/^[0-9a-f]{4,40}$/.test(h)) return false;
  return gitRaw(root, ['merge-base', '--is-ancestor', h, String(ref || 'HEAD')]).status === 0;
}

// 只读影响分析（合并前展示）：对每个所选提交列出「目标分支可达之外、又不属于所选集合」的
// 祖先提交（普通 merge 会把它们一并带入；隔离合并不带入，若所选改动依赖其内容将在执行时
// 冲突阻止）。REQ-20260926-002：条目与提交是多对多关系——同一 commit 关联多个条目不再判
// 混合提交、不再阻断（blocked 随流程移除），shared 如实记录；执行侧 mergeIsolatedIntoMain
// 按提交 hash 去重，共享提交只 cherry-pick 一次，各关联条目展示一致的合入结果。
// BUG-20260921-015：所选集合 = 全部条目的全部提交（一条目多提交按提交 hash 去重展开，
// 不按条目去重）；perItem 按条目聚合其全部提交的未选祖先（hash 去重），commit 字段保留
// 首个提交（展示兼容）。
// REQ-20260927-004：未选祖先按变更文件静态分类——变更文件全部落在根第一层发布文档集合内
//（README / CHANGELOG / FEATURES / AGENTS / DESIGN 及语言变体、版本 v.customDocs 清单内
// 自定义文档随语言集展开）的提交判定为「发布文档提交」（intermediates 行附 docOnly=true，
// 并单列 docAncestors（按 hash 去重、附归属所选条目）供前端折叠行单独展示「随『文档合并』
// 步处理，不随挑选合并」）；混合变更不分类按现状展示。分类为只读展示：不改变合并执行集合、
// 拓扑排序、共享提交去重与冲突阻止行为；合并提交 / diff-tree 读取失败均按不分类处理（不阻塞）。
// langs / customDocs 由调用方传入版本记录字段（缺省语言集 cn,en、无自定义文档）。
export function analyzePublishIsolation(root, items = [], { langs, customDocs } = {}) {
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库，无法分析发布范围');
  const targetBranch = resolveMainBranch(root) || 'main';
  const selected = new Set(items.flatMap((it) => commitsOf(it)));
  const docNames = publishRootDocNames(langs, customDocs);
  const byCommit = new Map();
  for (const it of items) {
    for (const c of commitsOf(it)) {
      if (!byCommit.has(c)) byCommit.set(c, []);
      if (!byCommit.get(c).includes(it.itemId)) byCommit.get(c).push(it.itemId);
    }
  }
  const shared = [...byCommit.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([commit, itemIds]) => ({ commit, itemIds }));
  const perItem = items.map((it) => {
    const intermediates = [];
    const seen = new Set();
    for (const commit of commitsOf(it)) {
      try {
        // REQ-20260921-015：intermediates 附提交时间 %cI（date）；字段向后兼容（既有调用方不读）。
        // REQ-20260927-004：每行附 docOnly（发布文档提交分类，静态判定）。
        const out = gitOk(root, ['log', `${targetBranch}..${commit}`, '--format=%H%x09%cI%x09%s'], '读取范围提交');
        for (const line of out.split('\n')) {
          if (!line.trim()) continue;
          const [hash, date, ...rest] = line.split('\t');
          const h = String(hash || '').toLowerCase();
          if (selected.has(h) || seen.has(h)) continue;
          seen.add(h);
          intermediates.push({ hash: h, date: date || '', subject: rest.join('\t'), docOnly: isReleaseDocCommit(root, h, docNames) });
        }
      } catch { /* 单条读取失败不阻塞整体分析（执行前 precheckMerge 兜底） */ }
    }
    return { itemId: it.itemId, commit: commitsOf(it)[0] || String(it.commit || '').toLowerCase(), intermediates, count: intermediates.length };
  });
  // REQ-20260927-004：发布文档祖先单列（按 hash 去重、附归属所选条目），M 与源码祖先 X 分开计数
  const docMap = new Map();
  for (const it of perItem) {
    for (const i of it.intermediates) {
      if (!i.docOnly) continue;
      if (!docMap.has(i.hash)) docMap.set(i.hash, { hash: i.hash, subject: i.subject, itemIds: [] });
      const ids = docMap.get(i.hash).itemIds;
      if (!ids.includes(it.itemId)) ids.push(it.itemId);
    }
  }
  const docAncestors = [...docMap.values()];
  const notes = [];
  // REQ-20260926-002：共享提交不再阻断，notes 说明多对多关系下的执行语义（按 hash 去重、
  // 只执行一次、各关联条目结果一致），不静默。
  if (shared.length) {
    notes.push(`共享提交 ${shared.length} 处按提交 hash 去重，挑选合并只执行一次（${shared.map((s) => `${s.commit.slice(0, 12)} → ${s.itemIds.join('、')}`).join('；')}），各关联条目展示一致的合入结果`);
  }
  // REQ-20260927-004：notes 只统计源码祖先（X），发布文档提交（M）单独说明去向
  const totalInter = perItem.reduce((n, x) => n + x.intermediates.filter((i) => !i.docOnly).length, 0);
  if (totalInter) notes.push(`所选提交存在 ${totalInter} 个未选祖先提交：普通 merge 会一并带入 main，隔离合并不带入；若所选改动依赖这些内容，执行时将冲突阻止并说明原因`);
  if (docAncestors.length) notes.push(`另有 ${docAncestors.length} 个发布文档提交（仅触及根第一层发布文档）：不随挑选合并进入 main，随「文档合并」步处理`);
  return { targetBranch, perItem, shared, docAncestors, notes };
}

// REQ-20260927-004：根第一层发布文档文件名集合（发布文档提交分类依据）——
// README / CHANGELOG / FEATURES / AGENTS / DESIGN 五类 × 语言集展开（首语言 <KEY>.md、
// 其余 <KEY>_<lang>.md）+ v.customDocs 清单内自定义文档同构展开（归一复用 publish-flow）。
const ISO_PUBLISH_DOC_KEYS = ['README', 'CHANGELOG', 'FEATURES', 'AGENTS', 'DESIGN'];
function publishRootDocNames(langs, customDocs) {
  const ls = docLangsOf({ langs });
  const names = new Set();
  for (const key of [...ISO_PUBLISH_DOC_KEYS, ...customDocsOf({ customDocs })]) {
    ls.forEach((lang, i) => names.add(`${key}${i === 0 ? '' : `_${lang}`}.md`));
  }
  return names;
}

// REQ-20260927-004：发布文档提交静态判定（只读）——diff-tree -r 列出提交变更文件，全部为
// 根第一层发布文档时为真（文件名精确匹配 = 只认根第一层，子目录同名不算）；无文件输出
//（合并提交）或读取异常按不分类处理（不阻塞分析，按现状展示）。
function isReleaseDocCommit(root, hash, docNames) {
  const out = String(gitRaw(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', hash]).stdout || '');
  const files = out.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!files.length) return false;
  return files.every((f) => docNames.has(f));
}

// 受限写（隔离合并）：把版本所选条目的 commit 逐条 cherry-pick 重放入主分支（-x 保留原始
// 提交溯源）。与旧 merge --no-ff 的关键差异：cherry-pick 只重放所选提交自身的变更，不把其
// 未选祖先带入 main（共享 dev 上只选 B 不再夹带先前未选 A）。执行隔离：非主分支时在临时
// 工作树检出主分支执行，全程不切换、不触碰用户当前工作区；单条冲突即 cherry-pick --abort
// 并中止（已成功条目保持，重试只补未合并）；返回 replays（original → replayed）作为重放
// 证据，发布包含性检验据此认可（原始 commit 不再是 main 祖先）。
// BUG-20260921-015：一条目多提交逐提交展开重放，且按 Git 依赖顺序（祖先在前）执行；
// replays 为既有重放证据（original → replayed，重试续传时传入）：原始提交或其重放提交
// 已在主分支 → 幂等记成功（alreadyIncluded），不重复 cherry-pick（重复重放会因补丁已
// 应用变成空提交而失败）。
// REQ-20260926-002：条目与提交多对多——一个提交关联多个条目时按提交 hash 去重只执行一次
//（不因多对多关系报混合提交错误），每个关联条目各记一行一致结果；冲突报错附冲突文件清单
// 与该提交主题（可诊断：展示具体提交、文件和原因）。
export function mergeIsolatedIntoMain(root, { versionId, versionName, items = [], replays = [] } = {}) {
  const baseBranch = precheckMerge(root, items);
  const targetBranch = resolveMainBranch(root) || 'main';
  const knownReplays = new Map((Array.isArray(replays) ? replays : [])
    .filter((r) => r && r.original && r.replayed)
    .map((r) => [String(r.original).toLowerCase(), String(r.replayed).toLowerCase()]));
  const orderedPairs = replayPairsOrdered(root, items, targetBranch);
  // 共享提交按 hash 去重：同一提交只进一次执行循环（各关联条目共享同一执行结果）
  const uniqueCommits = [];
  {
    const seen = new Set();
    for (const p of orderedPairs) {
      if (!seen.has(p.commit)) { seen.add(p.commit); uniqueCommits.push(p.commit); }
    }
  }
  const outcome = new Map(); // commit → { ok, error?, alreadyIncluded? }（执行一次，多行复用）
  const replayRows = [];
  const warnings = [];
  const inPlace = baseBranch === targetBranch; // 理论上 dev 前置下不出现；保留与旧实现一致的兜底
  let wt = null;
  if (!inPlace) {
    wt = path.join(realTmpdir(), `atb-iso-${versionId || 'v'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const r = gitRaw(root, ['worktree', 'add', wt, targetBranch]);
    if (r.status !== 0) {
      const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
      throw new AtbError(`创建隔离合并工作树失败：${detail}`.slice(0, 300));
    }
  }
  const cwd = inPlace ? root : wt;
  try {
    for (const commit of uniqueCommits) {
      // 幂等续传：原始提交已是主分支祖先（旧 --no-ff 版本 / 已并入）→ 记成功不重放
      if (isAncestorOf(cwd, commit, targetBranch)) {
        outcome.set(commit, { ok: true, alreadyIncluded: true });
        continue;
      }
      // 幂等续传：该提交此前已重放（重放提交在主分支）→ 记成功不重放（补丁已在 main）
      const replayedKnown = knownReplays.get(commit);
      if (replayedKnown && isAncestorOf(cwd, replayedKnown, targetBranch)) {
        outcome.set(commit, { ok: true, alreadyIncluded: true });
        continue;
      }
      const r = gitRaw(cwd, ['cherry-pick', '-x', commit]);
      if (r.status === 0) {
        const replayed = String(gitRaw(cwd, ['rev-parse', 'HEAD']).stdout || '').trim().toLowerCase();
        outcome.set(commit, { ok: true });
        replayRows.push({ itemId: orderedPairs.find((p) => p.commit === commit)?.itemId || '', original: commit, replayed });
        continue;
      }
      // 冲突可诊断：现场采集冲突文件清单（abort 前）与提交主题，报错含具体提交、文件和原因
      const conflictFiles = String(gitRaw(cwd, ['diff', '--name-only', '--diff-filter=U']).stdout || '')
        .split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
      const subject = String(gitRaw(root, ['log', '-1', '--format=%s', commit]).stdout || '').trim();
      const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
      gitRaw(cwd, ['cherry-pick', '--abort']); // 冲突现场清理（best-effort，不吞并报错）
      outcome.set(commit, {
        ok: false,
        error: `隔离合并冲突（提交 ${commit.slice(0, 12)}${subject ? `「${subject.slice(0, 80)}」` : ''}${conflictFiles.length ? `；冲突文件：${conflictFiles.join('、')}` : ''}）：${(detail || '冲突').slice(0, 240)}`.slice(0, 400),
      });
      break; // 逐条推进：一条失败即中止，保留已成功条目供重试续传
    }
  } finally {
    if (wt) {
      const rm = gitRaw(root, ['worktree', 'remove', '--force', wt]);
      if (rm.status !== 0) {
        gitRaw(root, ['worktree', 'prune']);
        warnings.push(`临时隔离合并工作树清理失败（${String(rm.stderr || '').trim().slice(0, 120)}），可忽略或手动 git worktree prune`);
      }
    }
  }
  // 结果按（条目 × 提交）逐行展开：共享提交的执行结果复制到每个关联条目（各条目结果一致）
  const results = [];
  for (const { itemId, commit } of orderedPairs) {
    const o = outcome.get(commit);
    if (o) results.push({ itemId, commit, ...o });
  }
  return { results, replays: replayRows, baseBranch, warnings };
}

// 受限写（REQ-20260926-002 文档合并）：把审核通过的发布文档提交（dev 上的 docs: 提交）
// cherry-pick 重放入主分支（-x 保留溯源），返回重放提交与重放证据供 build-store.recordDocsMerge
// 落账。幂等：原始提交已是 main 祖先（旧流程文档随功能先合入）或既有重放证据显示已重放且
// 重放提交在 main → alreadyIncluded 不重复执行（重试不产生重复提交）。执行隔离与冲突中止
// 口径同 mergeIsolatedIntoMain；返回 { ok, commitHash, replayedHash, mainSha, replays,
// alreadyIncluded? }。
export function mergeDocsCommitIntoMain(root, { versionId, commitHash, replays = [], docFiles = [] } = {}) {
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库：请先初始化 git（可经 atb init），再合并文档');
  const targetBranch = resolveMainBranch(root) || 'main';
  const h = String(commitHash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new AtbError('文档合并缺少有效的文档提交号（40 位提交号）');
  gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${targetBranch}`], `${targetBranch} 分支不存在`);
  const probe = gitRaw(root, ['rev-parse', '--verify', '--quiet', `${h}^{commit}`]);
  if (probe.status !== 0) throw new AtbError(`文档提交不存在：${h.slice(0, 12)}`);
  const knownReplays = (Array.isArray(replays) ? replays : [])
    .filter((r) => r && r.original && r.replayed)
    .map((r) => ({ original: String(r.original).toLowerCase(), replayed: String(r.replayed).toLowerCase() }));
  const known = new Map(knownReplays.map((r) => [r.original, r.replayed]));
  const evidence = () => [{ itemId: 'docs', original: h, replayed: known.get(h) || h }];
  // 幂等：该文档提交此前已重放且重放提交在 main → 不重复 cherry-pick
  const replayedKnown = known.get(h);
  if (replayedKnown && isAncestorOf(root, replayedKnown, targetBranch)) {
    return { ok: true, alreadyIncluded: true, commitHash: h, replayedHash: replayedKnown, replays: evidence() };
  }
  // 幂等：原始文档提交已在 main（旧流程先文档后合并的存量计划）→ 不重放
  if (isAncestorOf(root, h, targetBranch)) {
    return { ok: true, alreadyIncluded: true, commitHash: h, replayedHash: h, replays: evidence() };
  }
  const wt = path.join(realTmpdir(), `atb-docmerge-${versionId || 'v'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const r = gitRaw(root, ['worktree', 'add', wt, targetBranch]);
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
    throw new AtbError(`创建文档合并工作树失败：${detail}`.slice(0, 300));
  }
  try {
    const pick = gitRaw(wt, ['cherry-pick', '-x', h]);
    if (pick.status === 0) {
      const replayedHash = String(gitRaw(wt, ['rev-parse', 'HEAD']).stdout || '').trim().toLowerCase();
      const mainSha = String(gitRaw(wt, ['rev-parse', targetBranch]).stdout || '').trim().toLowerCase();
      return {
        ok: true,
        commitHash: h,
        replayedHash,
        mainSha,
        replays: [{ itemId: 'docs', original: h, replayed: replayedHash }],
      };
    }
    // 冲突兜底（存量「先文档后合并」计划的增量文档提交，其差异基于上一文档提交而 main
    // 尚无基础文件，补丁形态无法直接重放）：abort 后按文档白名单从该提交**树中**检出全部
    // 文档内容（增量提交的树含此前文档提交的全部文件；白名单防止把 dev 上的业务文件带进
    // main）落到 main，并以「docs: 发布文档 <计划号>（重放 <short>）」建重放提交——文档
    // 合并的语义是文档内容进入 main（非逐行补丁），内容与文档提交时点一致，重放证据可溯。
    gitRaw(wt, ['cherry-pick', '--abort']);
    const whitelist = (Array.isArray(docFiles) ? docFiles : []).map((f) => path.basename(String(f || ''))).filter(Boolean);
    const treeFiles = new Set(String(gitRaw(root, ['ls-tree', '--name-only', '-r', h]).stdout || '')
      .split('\n').map((s) => s.trim()).filter(Boolean));
    const files = (whitelist.length ? whitelist : [...treeFiles]).filter((f) => treeFiles.has(f));
    if (!files.length) {
      const detail = String(pick.stderr || pick.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
      throw new AtbError(`文档合并冲突（提交 ${h.slice(0, 12)}）：${(detail || '冲突').slice(0, 300)}`.slice(0, 400));
    }
    gitOk(wt, ['checkout', h, '--', ...files], '检出文档内容');
    const diff = gitRaw(wt, ['diff', '--cached', '--quiet']);
    if (diff.status === 0) {
      // 内容已与 main 一致（等价已合入）：不制造空提交
      const mainSha = String(gitRaw(wt, ['rev-parse', targetBranch]).stdout || '').trim().toLowerCase();
      return { ok: true, alreadyIncluded: true, commitHash: h, replayedHash: mainSha, mainSha, replays: [{ itemId: 'docs', original: h, replayed: mainSha }] };
    }
    gitOk(wt, ['commit', '-m', `docs: 发布文档 ${versionId || ''}（重放 ${h.slice(0, 12)}）`.trim()], '提交文档重放');
    const replayedHash = String(gitRaw(wt, ['rev-parse', 'HEAD']).stdout || '').trim().toLowerCase();
    const mainSha = String(gitRaw(wt, ['rev-parse', targetBranch]).stdout || '').trim().toLowerCase();
    return {
      ok: true,
      commitHash: h,
      replayedHash,
      mainSha,
      replays: [{ itemId: 'docs', original: h, replayed: replayedHash }],
    };
  } finally {
    const rm = gitRaw(root, ['worktree', 'remove', '--force', wt]);
    if (rm.status !== 0) gitRaw(root, ['worktree', 'prune']);
  }
}

// 受限写（正式发布第一步）：把本地主分支（解析结果 main / master）推送到所选远端。
// 只推主分支本身（不推 dev、不强推、不 --force）；失败抛错由调用方保留重试入口。
export function pushMainBranch(root, { remote } = {}) {
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库：请先初始化 git（可经 atb init），再推送主分支');
  const rm = String(remote || '').trim();
  if (!REF_RE.test(rm)) throw new AtbError(`远端名不合法：${rm || '（空）'}`);
  if (!remoteNames(root).includes(rm)) throw new AtbError(`远端 ${rm} 未配置（git remote add ${rm} <url>）`);
  const targetBranch = resolveMainBranch(root) || 'main';
  gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${targetBranch}`], `${targetBranch} 分支不存在`);
  const sha = gitOk(root, ['rev-parse', `refs/heads/${targetBranch}`], '读取主分支头').trim();
  const r = gitRaw(root, ['push', rm, `refs/heads/${targetBranch}:refs/heads/${targetBranch}`]);
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 4).join('；');
    throw new AtbError(`推送主分支 ${targetBranch} 到 ${rm} 失败：${detail}`.slice(0, 400));
  }
  return { ok: true, remote: rm, branch: targetBranch, sha };
}

// 只读（官网检测事实源）：读取官网仓库本地主分支提交（新→旧），主分支解析沿用 main 优先、
// 仅无 main 时回退 master 的兼容规则；返回逐提交提交者时间（%cI，降低变基保留旧作者日期的
// 漏检）。不 fetch、不触碰远端。
export function siteMainLog(siteRoot, { limit = 200 } = {}) {
  if (!isGitRepo(siteRoot)) throw new AtbError('官网目录不是 git 仓库，无法读取本地主分支提交');
  const branch = resolveMainBranch(siteRoot);
  if (!branch) throw new AtbError('官网仓库缺少本地 main / master 分支，无法检测');
  gitOk(siteRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], '官网主分支不存在');
  const n = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 200)));
  const out = gitOk(siteRoot, ['log', branch, '-n', String(n), '--format=%H%x09%cI%x09%s'], '读取官网提交记录');
  const commits = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [hash, committerDate, ...rest] = line.split('\t');
    commits.push({ hash, committerDate, subject: rest.join('\t') });
  }
  return { branch, commits };
}

// 只读：证据有效性（官网历史改写 / 证据被移除后退回等待并解释原因）。
export function siteEvidenceReachable(siteRoot, hash, branch) {
  if (!isGitRepo(siteRoot) || !hash) return false;
  const b = branch || resolveMainBranch(siteRoot);
  if (!b) return false;
  return isAncestorOf(siteRoot, hash, b);
}

// 受限写（文档提交）：只提交给定清单（REQ-20260921-010 起由调用方按语言集展开，如
// cn,en,fr → 4 × 3 共 12 个 <KEY>[_<lang>].md）中已存在的文件——git add 与 git commit
// 均按 pathspec 限定，绝不夹带业务源码或其他工作区修改；无变化时不制造空提交（noop）。
// files 缺省保留旧八字节点号清单（兼容既有调用方）。
// 返回逐文件内容 sha256（供 recordDocsCommit 固化「提交时点磁盘内容」基准）。
export function commitPublishDocs(root, { message, files } = {}) {
  const DOC_FILES = Array.isArray(files) && files.length
    ? [...new Set(files.map((f) => path.basename(String(f || ''))))]
    : ['README.md', 'README.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md', 'FEATURES.md', 'FEATURES.en.md', 'AGENTS.md', 'AGENTS.en.md'];
  if (!isGitRepo(root)) throw new AtbError('项目不是 git 仓库：请先初始化 git（可经 atb init），再提交文档');
  const existing = DOC_FILES.filter((f) => fs.existsSync(path.join(root, f)));
  if (!existing.length) throw new AtbError('尚无已编写的发布文档（先保存至少一个文档再提交）');
  gitOk(root, ['add', '--', ...existing], '暂存发布文档');
  const diff = gitRaw(root, ['diff', '--cached', '--quiet', '--', ...existing]);
  if (diff.status === 0) return { ok: true, noop: true, files: existing, hashes: null };
  gitOk(root, ['commit', '-m', String(message || 'docs: 发布文档'), '--', ...existing], '提交发布文档');
  const commitHash = gitOk(root, ['rev-parse', 'HEAD'], '读取文档提交').trim();
  const hashes = {};
  for (const f of existing) {
    hashes[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
  }
  return { ok: true, noop: false, commitHash, files: existing, hashes };
}
