// REQ-20260915-002 产品发布 Git 执行层（product-release-git）—— server.mjs / 流水线使用。
// 全部本机 git，exec 注入（真实执行器来自 release-git realExec；测试注入同步 wrapper）。
// 口径（README §2~§3）：
//   - 源码远端自动解析：origin 优先 → 唯一远端；多远端无 origin 视为歧义明确阻塞；
//   - 发布源码 SHA 必须与冻结的 main 分支头一致并验证包含计划条目（不冒充、不悄悄换 SHA）；
//   - 额外提交如实归集（main 上不在计划条目祖先内的提交，剔除本 BLD 的 build 合并提交），
//     不隐去合并带入的额外变更；
//   - 切 main 前工作区必须干净（看板数据目录除外，与 REL 口径一致）；不自动暂存/丢弃/强切；
//   - main/dev 双分支一次 --atomic 推送；核验远端两分支 SHA 与冻结值一致；不 force、
//     不回退为可能仅成功一个分支的两次推送；推送超时先查询远端再判定。

import { AtbError } from './core.mjs';
import { sanitizeRemoteUrl } from './release-store.mjs';

// 阶段级错误（kind 供流水线与前端分流：dirty / occupied / plan-stale / no-remote /
// ambiguous-remote / push-rejected / verify-mismatch / git-error）
export class ProductGitError extends AtbError {
  constructor(message, kind = 'git-error', extra = null) {
    super(message);
    this.kind = kind;
    this.extra = extra;
  }
}

const head = (s, n = 4) => String(s || '').trim().split('\n').filter(Boolean).slice(0, n).join('；');
const out = (r) => String(r.stdout || '').trim();

async function ok(exec, projectRoot, args, label) {
  const r = await exec('git', args, { cwd: projectRoot });
  if (r.code !== 0) {
    throw new ProductGitError(`${label || `git ${args[0]}`}失败：${head(r.stderr || r.stdout)}`, 'git-error');
  }
  return out(r);
}

async function maybe(exec, projectRoot, args) {
  try {
    return await ok(exec, projectRoot, args, null);
  } catch {
    return null;
  }
}

/* ---------- 只读事实收集 ---------- */

// 源码远端解析：origin 优先 → 唯一远端；无远端 / 多远端无 origin → 明确阻塞（不猜）
export async function resolveSourceRemote(projectRoot, exec) {
  const raw = await maybe(exec, projectRoot, ['remote']);
  const remotes = out({ stdout: raw }).split('\n').map((s) => s.trim()).filter(Boolean);
  if (!remotes.length) {
    throw new ProductGitError('产品源码仓库未配置远端（git remote add origin <url>）：发布需将 main/dev 推送到源码远端', 'no-remote');
  }
  let remote = null;
  if (remotes.includes('origin')) remote = 'origin';
  else if (remotes.length === 1) remote = remotes[0];
  if (!remote) {
    throw new ProductGitError(
      `源码远端存在歧义：配置了多个远端（${remotes.join('、')}）且无 origin。请在仓库保留唯一远端或配置 origin 后再发布`,
      'ambiguous-remote',
      { candidates: remotes },
    );
  }
  const urlRaw = await maybe(exec, projectRoot, ['remote', 'get-url', remote]);
  if (urlRaw == null) {
    throw new ProductGitError(`读取远端 ${remote} 地址失败`, 'no-remote');
  }
  return { remote, url: urlRaw, sanitizedUrl: sanitizeRemoteUrl(urlRaw) };
}

// 本地分支头（缺失 → null）
export async function branchHead(projectRoot, exec, branch) {
  const sha = await maybe(exec, projectRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]);
  return sha ? sha.toLowerCase() : null;
}

// 条目包含性：每个计划条目 commit 必须是 main 的祖先（发布范围确实包含计划条目）
export async function verifyItemsOnMain(projectRoot, exec, items, mainSha) {
  const missing = [];
  for (const it of items) {
    const r = await exec('git', ['merge-base', '--is-ancestor', String(it.commit), String(mainSha)], { cwd: projectRoot });
    if (r.code !== 0) missing.push(it.itemId);
  }
  return { ok: missing.length === 0, missing };
}

// 额外提交：main 上不在任何计划条目 commit 祖先内的提交（基线与计划外直接提交均计入，如实展示），
// 剔除本 BLD 的 build 合并提交（build: … 合并 …（BLD-…）——build-git 生成口径）。
export async function collectExtraCommits(projectRoot, exec, { mainSha, itemCommits, bldId, limit = 50 }) {
  const args = ['log', mainSha, '--not', ...itemCommits.map(String), '--format=%H%x09%h%x09%an%x09%aI%x09%s'];
  let raw = '';
  try {
    raw = await ok(exec, projectRoot, args, '归集额外提交');
  } catch {
    return [];
  }
  const mergePattern = new RegExp(`^build: .+合并 .+（${String(bldId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}）$`);
  const extras = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [hash, short, author, date, ...rest] = line.split('\t');
    const subject = rest.join('\t');
    if (mergePattern.test(subject)) continue; // 本 BLD 合并提交不计入
    extras.push({ hash, short, author, date, subject });
    if (extras.length >= limit) break;
  }
  return extras;
}

// 冻结源码文件读取（预检识别用，只读不建工作树）：返回内容或 null
export async function readFrozenFile(projectRoot, exec, sha, relPath) {
  const r = await exec('git', ['show', `${sha}:${relPath}`], { cwd: projectRoot });
  return r.code === 0 ? String(r.stdout || '') : null;
}

// 工作区脏文件（看板数据目录除外，与 REL local-precheck 同口径）。
// 注意：porcelain 首行形如「 M path」（XY 两字符 + 空格），不能对整段 stdout 做 trim
// （会吃掉首行前导空格导致路径错位）——只按行解析。
export async function worktreeDirtyFiles(projectRoot, exec) {
  const r = await exec('git', ['status', '--porcelain'], { cwd: projectRoot });
  if (r.code !== 0) {
    throw new ProductGitError(`检查工作区失败：${head(r.stderr || r.stdout)}`, 'git-error');
  }
  const BOARD_DIR = 'docs/agent-team-board/';
  return String(r.stdout || '').split('\n').filter(Boolean).filter((line) => {
    let p = line.slice(3).trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
    return !(p.startsWith(BOARD_DIR) || BOARD_DIR.startsWith(`${p}/`) || p === 'docs' || p === 'docs/');
  }).map((line) => line.slice(3).trim());
}

/* ---------- 写操作（受限） ---------- */

// 切 main 并核对 HEAD：工作区不干净 / 分支被其他 worktree 占用 / main 已前进 → 明确阻塞；
// 成功后工作目录保持在 main（README：发布执行后源码工作目录保持在 main）。
export async function switchMainVerifyHead(projectRoot, exec, { expectedMainSha }) {
  const dirty = await worktreeDirtyFiles(projectRoot, exec);
  if (dirty.length) {
    throw new ProductGitError(
      `工作区有未提交修改（${dirty.slice(0, 5).join('、')}${dirty.length > 5 ? ' 等' : ''}）：请先完成提交后再发布（系统不自动 add/commit/stash/丢弃改动）`,
      'dirty',
      { files: dirty.slice(0, 20) },
    );
  }
  const current = await maybe(exec, projectRoot, ['branch', '--show-current']);
  if (current !== 'main') {
    const r = await exec('git', ['checkout', 'main'], { cwd: projectRoot });
    if (r.code !== 0) {
      const text = `${r.stderr || ''}${r.stdout || ''}`;
      const kind = /already (checked out|used)/i.test(text) ? 'occupied' : 'checkout-failed';
      throw new ProductGitError(
        kind === 'occupied'
          ? 'main 分支正被其他工作树（worktree）占用：请先移除占用的工作树或在其内完成操作（不强切）'
          : `切换 main 失败：${head(text)}`,
        kind,
      );
    }
  }
  const headNow = (await ok(exec, projectRoot, ['rev-parse', 'HEAD'], '读取 main HEAD')).toLowerCase();
  if (headNow !== String(expectedMainSha).toLowerCase()) {
    throw new ProductGitError(
      `main 分支头已前进（当前 ${headNow.slice(0, 8)} ≠ 冻结 ${String(expectedMainSha).slice(0, 8)}）：不能把旧计划 SHA 冒充当前 main 发布，请重新冻结后再启动`,
      'plan-stale',
      { current: headNow, frozen: String(expectedMainSha).toLowerCase() },
    );
  }
  return { ok: true, previousBranch: current };
}

// main/dev 双分支一次原子推送（--atomic；任一被拒整体失败，不回退为两次推送）
export async function atomicPushBranches(projectRoot, exec, { remote }) {
  const r = await exec('git', ['push', '--atomic', remote, 'main', 'dev'], { cwd: projectRoot, timeoutMs: 300000 });
  if (r.code !== 0) {
    const text = `${r.stderr || ''}${r.stdout || ''}`;
    if (/atomic/i.test(text) && /disable|unsupported|advertise/i.test(text)) {
      throw new ProductGitError('远端不支持 atomic 推送：main/dev 无法原子同批发布，已阻塞（不回退为可能仅成功一个分支的两次推送）', 'atomic-unsupported');
    }
    throw new ProductGitError(`推送被拒（main/dev 原子推送失败，不 force）：${head(text)}`, 'push-rejected');
  }
  return { ok: true, note: head(r.stderr || r.stdout || '推送完成', 6) };
}

// 远端核验：main/dev 两分支 SHA 必须都等于冻结值（单分支一致不算完成）
export async function verifyRemoteBranches(projectRoot, exec, { remote, mainSha, devSha }) {
  const r = await exec('git', ['ls-remote', remote, 'refs/heads/main', 'refs/heads/dev'], { cwd: projectRoot, timeoutMs: 30000 });
  if (r.code !== 0) {
    throw new ProductGitError(`核验读取远端失败：${head(r.stderr || r.stdout)}`, 'verify-unreachable');
  }
  const actual = {};
  for (const line of String(r.stdout || '').trim().split('\n').filter(Boolean)) {
    const [oid, ref] = line.split('\t');
    actual[ref] = oid ? oid.toLowerCase() : null;
  }
  const mainOk = actual['refs/heads/main'] === String(mainSha).toLowerCase();
  const devOk = actual['refs/heads/dev'] === String(devSha).toLowerCase();
  if (!mainOk || !devOk) {
    const bad = [!mainOk && 'main', !devOk && 'dev'].filter(Boolean);
    throw new ProductGitError(
      `远端核验不一致（${bad.join('、')}）：main 实际 ${actual['refs/heads/main'] ? actual['refs/heads/main'].slice(0, 8) : '（不存在）'} / dev 实际 ${actual['refs/heads/dev'] ? actual['refs/heads/dev'].slice(0, 8) : '（不存在）'}。双分支一致才算完成，可重试（重试先查询远端）`,
      'verify-mismatch',
      { actual },
    );
  }
  return { ok: true, actual };
}

// 只读推送预演（预检用：dry-run 不产生远端更新）
export async function precheckAtomicPushDryRun(projectRoot, exec, { remote }) {
  const r = await exec('git', ['push', '--dry-run', '--atomic', remote, 'main', 'dev'], { cwd: projectRoot, timeoutMs: 60000 });
  if (r.code !== 0) {
    const text = `${r.stderr || ''}${r.stdout || ''}`;
    if (/atomic/i.test(text) && /disable|unsupported|advertise/i.test(text)) {
      throw new ProductGitError('远端不支持 atomic 推送（dry-run 探测）：main/dev 无法原子同批发布，预检阻塞', 'atomic-unsupported');
    }
    throw new ProductGitError(`推送预演失败（不推送）：${head(text)}`, 'dry-run-failed');
  }
  return { ok: true };
}
