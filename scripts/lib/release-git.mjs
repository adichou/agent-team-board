// REQ-20260910-029 Git 远端发布流水线（七阶段）—— server.mjs / 测试使用。
// 阶段：freeze 配置冻结 → local-precheck 本地预检 → fetch-remote 获取远端 →
//       quality-check 质量检查（隔离 worktree）→ plan 推送计划（dry-run 仅预检）→
//       push 执行推送（只推选定引用 / 默认仅快进 / 分支+标签 atomic）→ verify 结果核验。
// 语义边界：
//   - 未提交修改只引导回现有提交功能，绝不自动 add/commit/stash；
//   - 落后 / 分叉 / 受保护分支阻塞，流水线不自动改写历史；
//   - 只推明确选定的 refspec，禁 force / mirror / 隐式推全部分支标签；
//   - 标签须本地已存在且指向冻结提交；拒绝覆盖远端已有不同标签；
//   - 计划确认后源提交 / 远端 / 配置变化 → 计划失效阻塞（并发远端更新不覆盖历史）；
//   - 网络响应丢失（推送超时）不立即判失败，交由 verify 查询远端实际 ref 后判定；
//   - 重试只重跑未完成操作：push 重试先查询远端，已到达目标则不重复推送。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AtbError,
} from './core.mjs';
import {
  readRun, mutateRun, appendStageLog, sanitizeRemoteUrl, scrubSecrets, pushEvidence, GIT_STAGES,
} from './release-store.mjs';

/* ---------- 命令执行 ---------- */

export class ExecTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ETIMEDOUT';
  }
}

// 真实执行器：spawn + 超时控制；返回 { code, stdout, stderr }，命令级错误抛出
export function realExec({ timeoutMs = 120000 } = {}) {
  return (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    const limit = opts.timeoutMs || timeoutMs;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new ExecTimeoutError(`命令超时（${limit}ms）：${cmd} ${args.join(' ')}`));
    }, limit);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, stdout, stderr });
    });
  });
}

/* ---------- 阶段错误 ---------- */

export class GitStageError extends Error {
  constructor(message, kind = 'error', result = null) {
    super(message);
    this.kind = kind;
    this.stageResult = result;
  }
}

const head = (s, n = 8) => String(s || '').trim().split('\n').filter(Boolean).slice(0, n).join('\n');

/* ---------- 单阶段实现 ---------- */

async function gitCmd(ctx, args, label, { raw = false } = {}) {
  const { exec, projectRoot } = ctx;
  const r = await exec('git', args, { cwd: projectRoot });
  if (label) ctx.log(`${label}：git ${args[0]} → exit ${r.code}${r.stderr ? `\n${head(r.stderr, 4)}` : ''}`);
  if (r.code !== 0) {
    throw new GitStageError(`${label || 'git 命令'}失败：${head(scrubSecrets(r.stderr || r.stdout), 3)}`, 'git-error');
  }
  return raw ? r.stdout : r.stdout.trim();
}

async function tryGit(ctx, args) {
  try {
    return await gitCmd(ctx, args, null);
  } catch {
    return null;
  }
}

// 1. freeze：校验配置输入并冻结（无 remote / 非法 ref / 缺失校验配置明确阻塞）
async function stageFreeze(ctx) {
  const { run } = ctx;
  const { remote, sourceBranch, targetBranch, tagName, checkCommand } = run.config;
  let remoteUrl;
  try {
    remoteUrl = await gitCmd(ctx, ['remote', 'get-url', remote], `读取 remote「${remote}」`);
  } catch (e) {
    throw new GitStageError(`未找到已配置的 remote「${remote}」：请先在仓库配置远端后再发布（本地预检明确阻塞，不跳过）`, 'no-remote', { remote });
  }
  let sourceOid;
  try {
    sourceOid = await gitCmd(ctx, ['rev-parse', '--verify', `${sourceBranch}^{commit}`], `解析源分支 ${sourceBranch}`);
  } catch {
    throw new GitStageError(`源分支「${sourceBranch}」不存在或无法解析提交`, 'bad-ref');
  }
  const refspecs = [`refs/heads/${sourceBranch}:refs/heads/${targetBranch}`];
  if (tagName) {
    let tagOid;
    try {
      tagOid = await gitCmd(ctx, ['rev-parse', '--verify', `refs/tags/${tagName}^{commit}`], `解析标签 ${tagName}`);
    } catch {
      throw new GitStageError(`标签「${tagName}」在本地不存在：请先创建指向发布提交的标签（标签必须指向冻结提交，系统不自动改写仓库）`, 'bad-ref');
    }
    if (tagOid !== sourceOid) {
      throw new GitStageError(`标签「${tagName}」未指向源分支提交（${tagOid.slice(0, 8)} ≠ ${sourceOid.slice(0, 8)}）：请先修正标签指向`, 'bad-ref');
    }
    refspecs.push(`refs/tags/${tagName}`);
  }
  const sanitized = sanitizeRemoteUrl(remoteUrl);
  ctx.log(`冻结输入：源提交 ${sourceOid}；远端 ${sanitized}；refspec ${refspecs.join(' ')}`);
  run.frozen = { sourceOid, remoteUrl: sanitized, refspecs };
  return { sourceOid, remoteUrl: sanitized, refspecs, checkCommand };
}

// 2. local-precheck：仓库 / 非 detached / 冻结提交存在 / 无未完成 merge-rebase / 工作区干净
async function stageLocalPrecheck(ctx) {
  const { run, projectRoot } = ctx;
  const inside = await tryGit(ctx, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') throw new GitStageError('当前目录不是 Git 工作区', 'not-repo');
  const headRef = await tryGit(ctx, ['symbolic-ref', '-q', 'HEAD']);
  if (headRef == null) throw new GitStageError('HEAD 处于 detached 状态：请先检出分支后再发布', 'detached');
  const sourceOid = run.frozen.sourceOid;
  const still = await tryGit(ctx, ['rev-parse', '--verify', `${sourceOid}^{commit}`]);
  if (!still) throw new GitStageError(`冻结的源提交 ${sourceOid.slice(0, 8)} 已不存在（历史被改写？）`, 'source-gone');
  const gitDir = path.join(projectRoot, await gitCmd(ctx, ['rev-parse', '--git-dir'], '定位 .git'));
  const mergeHead = await tryGit(ctx, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  if (mergeHead || fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
    throw new GitStageError('存在未完成的 merge / rebase：请先完成或中止后再发布', 'in-progress');
  }
  // porcelain 的前两列是状态；保留首行空格，避免固定列路径解析错位。
  const status = await gitCmd(ctx, ['status', '--porcelain'], '检查工作区', { raw: true });
  // 看板数据目录（docs/agent-team-board/）是看板自身写入（运行记录 / 阶段日志），
  // 不属于发布内容、也不应自阻塞流水线；其余任何脏路径（含暂存区）均阻塞。
  const BOARD_DIR = 'docs/agent-team-board/';
  const dirty = status.split('\n').filter(Boolean).filter((line) => {
    let p = line.slice(3).trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (p.includes(' -> ')) p = p.split(' -> ').pop().trim(); // 重命名取目标路径
    // 看板目录整目录未跟踪时 git 折叠显示为上游目录（如 docs/）：按路径前缀判定归属看板
    return !(p.startsWith(BOARD_DIR) || BOARD_DIR.startsWith(`${p}/`) || p === 'docs' || p === 'docs/');
  });
  if (dirty.length) {
    const files = dirty.slice(0, 5).map((l) => l.slice(3).trim()).join('、');
    throw new GitStageError(
      `工作区有未提交修改（${files}${dirty.length > 5 ? ' 等' : ''}）：请先在看板提交功能完成提交后再发布（系统不自动 add/commit/stash）`,
      'dirty',
      { files: dirty.slice(0, 20).map((l) => l.slice(3).trim()) },
    );
  }
  ctx.log('本地预检通过：非 detached、无未完成 merge/rebase、工作区与暂存区干净');
  return { ok: true };
}

// 3. fetch-remote：读取远端 OID 并判定 相同/可快进/落后/分叉；受保护分支阻塞
async function stageFetchRemote(ctx) {
  const { run, cfg } = ctx;
  const { remote, targetBranch } = run.config;
  const remoteUrl = run.frozen.remoteUrl;
  const protectedBranches = cfg.protectedBranches || [];
  if (protectedBranches.includes(targetBranch)) {
    throw new GitStageError(
      `目标分支「${targetBranch}」为受保护分支：直接推送被阻塞。请按仓库流程通过 PR/MR 完成评审合并（远端：${remoteUrl}）`,
      'protected',
      { remoteUrl },
    );
  }
  const sourceOid = run.frozen.sourceOid;
  const out = await ctx.exec('git', ['ls-remote', remote, `refs/heads/${targetBranch}`], { cwd: ctx.projectRoot, timeoutMs: 20000 });
  if (out.code !== 0) {
    throw new GitStageError(`读取远端失败（git ls-remote）：${head(scrubSecrets(out.stderr || out.stdout), 3)}`, 'remote-unreachable');
  }
  const remoteOid = (out.stdout.trim().split('\t')[0]) || null;
  // 本地缺远端对象时 fetch 目标引用（只更新本地对象库，不动本地分支），
  // 使 merge-base 祖先判定可用（否则落后 / 分叉无法区分）
  if (remoteOid) {
    const known = await tryGit(ctx, ['cat-file', '-e', `${remoteOid}^{commit}`]);
    if (known == null) {
      await gitCmd(ctx, ['fetch', remote, targetBranch], `获取远端引用 ${targetBranch}`);
    }
  }
  let relation;
  if (remoteOid == null) {
    relation = 'new-branch';
  } else if (remoteOid === sourceOid) {
    relation = 'same';
  } else {
    const ff = await tryGit(ctx, ['merge-base', '--is-ancestor', remoteOid, sourceOid]);
    if (ff != null) {
      relation = 'fast-forward';
    } else {
      const behind = await tryGit(ctx, ['merge-base', '--is-ancestor', sourceOid, remoteOid]);
      if (behind != null) {
        throw new GitStageError(
          `目标分支在远端领先于源提交（本地落后）：请先同步远端变更再发布（流水线不自动改写历史）`,
          'behind',
          { remoteOid },
        );
      }
      throw new GitStageError(
        '源提交与远端目标分支已分叉：请先解决分叉（合并或变基）再发布（流水线不自动改写历史）',
        'diverged',
        { remoteOid },
      );
    }
  }
  ctx.log(`远端 ${targetBranch}：${remoteOid == null ? '（新分支）' : remoteOid.slice(0, 8)}；判定：${relation}`);
  return { remoteOid, relation };
}

// 4. quality-check：冻结提交的隔离 worktree 内执行项目校验命令
async function stageQualityCheck(ctx) {
  const { run, dataDir } = ctx;
  const sourceOid = run.frozen.sourceOid;
  const command = run.config.checkCommand;
  const workDir = path.join(os.tmpdir(), `atb-release-wt-${run.id}-${Date.now()}`);
  let added = false;
  try {
    const addOut = await ctx.exec('git', ['worktree', 'add', '--detach', workDir, sourceOid], { cwd: ctx.projectRoot, timeoutMs: 60000 });
    if (addOut.code !== 0) {
      throw new GitStageError(`创建隔离工作目录失败：${head(scrubSecrets(addOut.stderr || addOut.stdout), 3)}`, 'worktree');
    }
    added = true;
    ctx.log(`隔离工作目录：${workDir}（冻结提交 ${sourceOid.slice(0, 8)}）；执行校验：${command}`);
    const check = await ctx.exec('sh', ['-c', command], { cwd: workDir, timeoutMs: ctx.cfg.checkTimeoutMs || 600000 });
    const log = `${check.stdout || ''}${check.stderr ? `\n${check.stderr}` : ''}`.trim();
    if (log) ctx.log(`校验输出：\n${head(log, 30)}`);
    if (check.code !== 0) {
      throw new GitStageError(`质量检查未通过（exit ${check.code}）：失败不可继续推送`, 'check-failed', {
        command, exitCode: check.code, log: head(log, 50),
      });
    }
    return { command, exitCode: 0, log: head(log, 20), workDir };
  } finally {
    if (added) {
      const rm = await ctx.exec('git', ['worktree', 'remove', '--force', workDir], { cwd: ctx.projectRoot, timeoutMs: 60000 });
      if (rm.code !== 0) ctx.log(`清理隔离工作目录失败（不影响判定）：${head(rm.stderr, 2)}`);
    }
    void dataDir;
  }
}

// 5. plan：待发布提交 + 标签冲突检测 + atomic 探测（dry-run 仅为预检）
async function stagePlan(ctx) {
  const { run } = ctx;
  const { remote, sourceBranch, targetBranch, tagName } = run.config;
  const sourceOid = run.frozen.sourceOid;
  const fetch = run.stages.find((s) => s.key === 'fetch-remote')?.result || {};
  const remoteOid = fetch.remoteOid || null;

  let commits = [];
  if (remoteOid == null) {
    commits = (await tryGit(ctx, ['log', '--oneline', '-30', sourceOid]) || '').split('\n').filter(Boolean);
    ctx.log('目标分支在远端不存在：将首次推送（新建远端分支）');
  } else if (fetch.relation === 'same') {
    commits = [];
    ctx.log('远端已与源提交一致：无待推送提交');
  } else {
    commits = (await gitCmd(ctx, ['log', '--oneline', `${remoteOid}..${sourceOid}`], '统计待发布提交')).split('\n').filter(Boolean);
  }

  // 标签：远端已有不同指向 → 拒绝覆盖；同指向 → 跳过重复推送
  let tagAction = tagName ? 'push' : null;
  if (tagName) {
    const tagOut = await ctx.exec('git', ['ls-remote', remote, `refs/tags/${tagName}`], { cwd: ctx.projectRoot, timeoutMs: 20000 });
    if (tagOut.code !== 0) {
      throw new GitStageError(`读取远端标签失败：${head(scrubSecrets(tagOut.stderr), 2)}`, 'remote-unreachable');
    }
    const existing = tagOut.stdout.trim().split('\t')[0] || null;
    if (existing && existing !== sourceOid) {
      throw new GitStageError(
        `远端已存在标签「${tagName}」且指向不同提交（${existing.slice(0, 8)}）：拒绝覆盖已有不同标签`,
        'tag-conflict',
      );
    }
    if (existing === sourceOid) {
      tagAction = 'skip';
      ctx.log(`标签 ${tagName} 远端已指向目标提交：不重复推送`);
    }
  }

  const branchRefspec = `refs/heads/${sourceBranch}:refs/heads/${targetBranch}`;
  const tagRefspec = tagName && tagAction === 'push' ? `refs/tags/${tagName}` : null;
  const pushRefs = [branchRefspec, ...(tagRefspec ? [tagRefspec] : [])];
  const pushAnything = fetch.relation !== 'same' || !!tagRefspec;

  // atomic 探测（分支 + 标签同批）：远端不支持 → 阻塞说明，不静默降级成部分发布
  let atomic = false;
  if (pushAnything && tagRefspec) {
    const dry = await ctx.exec('git', ['push', '--dry-run', '--atomic', remote, ...pushRefs], { cwd: ctx.projectRoot, timeoutMs: 60000 });
    if (dry.code !== 0) {
      const errText = scrubSecrets(dry.stderr || dry.stdout);
      if (/atomic/i.test(errText)) {
        throw new GitStageError('远端不支持 atomic 推送：分支与标签无法原子同批发布。已阻塞（不静默降级为部分发布），请与远端管理员确认 receive.advertiseAtomic 或分两次发布', 'atomic-unsupported');
      }
      throw new GitStageError(`推送预演（dry-run）失败：${head(errText, 3)}`, 'dry-run-failed');
    }
    atomic = true;
    ctx.log('atomic dry-run 通过：分支与标签将原子同批推送');
  } else if (pushAnything) {
    const dry = await ctx.exec('git', ['push', '--dry-run', remote, ...pushRefs], { cwd: ctx.projectRoot, timeoutMs: 60000 });
    if (dry.code !== 0) {
      throw new GitStageError(`推送预演（dry-run）失败：${head(scrubSecrets(dry.stderr || dry.stdout), 3)}`, 'dry-run-failed');
    }
    ctx.log('dry-run 预检通过（仅为预检，未推送）');
  }

  const planHash = crypto.createHash('sha256').update(JSON.stringify({
    sourceOid, remoteOid, refspecs: pushRefs, atomic, config: run.config,
  })).digest('hex').slice(0, 16);
  run.frozen.planHash = planHash;
  ctx.log(`推送计划冻结（hash ${planHash}）：${pushRefs.join(' ')}${atomic ? '（atomic）' : ''}`);
  return { commits, remoteOid, atomic, tagAction, refspecs: pushRefs, planHash, pushAnything };
}

// 6. push：计划复核 → 只推选定引用（默认仅快进，无 force/mirror/--all）
async function stagePush(ctx) {
  const { run } = ctx;
  const { remote, sourceBranch, targetBranch } = run.config;
  const plan = run.stages.find((s) => s.key === 'plan')?.result || {};
  const sourceOid = run.frozen.sourceOid;

  // 计划有效性：源提交与远端均不得在计划确认后变化（并发远端更新不覆盖历史）
  const srcNow = await tryGit(ctx, ['rev-parse', `refs/heads/${sourceBranch}`]);
  if (srcNow !== sourceOid) {
    throw new GitStageError('发布计划已失效：源分支在计划确认后指向了新提交。请重新预检并启动新计划', 'plan-stale');
  }
  const nowOut = await ctx.exec('git', ['ls-remote', remote, `refs/heads/${targetBranch}`], { cwd: ctx.projectRoot, timeoutMs: 20000 });
  const remoteNow = (nowOut.stdout.trim().split('\t')[0]) || null;
  if (remoteNow !== (plan.remoteOid || null)) {
    throw new GitStageError(
      '发布计划已失效：远端目标分支在计划确认后发生变化（他人已推进）。不覆盖他人历史，请重新预检',
      'plan-stale',
      { remoteBefore: plan.remoteOid, remoteNow },
    );
  }

  // 重试 / 恢复语义：先查询远端，已到达目标则不重复推送
  if (remoteNow === sourceOid && !plan.refspecs.some((r) => r.startsWith('refs/tags/'))) {
    ctx.log('远端已到达目标提交（查询确认）：不重复推送');
    pushEvidence(run, 'push', `查询确认：远端 ${targetBranch} 已在 ${sourceOid.slice(0, 8)}，未重复推送`, { before: remoteNow, after: remoteNow });
    return { skipped: true, note: '远端已到达目标提交（查询确认，未重复推送）' };
  }
  if (!plan.pushAnything) {
    ctx.log('无待推送引用：跳过推送');
    return { skipped: true, note: '无待推送引用' };
  }

  const args = ['push', ...(plan.atomic ? ['--atomic'] : []), remote, ...plan.refspecs];
  pushEvidence(run, 'push', '推送前远端状态', { before: remoteNow });
  ctx.log(`执行推送：git ${args.join(' ')}`);
  let out;
  try {
    out = await ctx.exec('git', args, { cwd: ctx.projectRoot, timeoutMs: ctx.cfg.pushTimeoutMs || 300000 });
  } catch (e) {
    if (e && e.code === 'ETIMEDOUT') {
      // 网络响应丢失：不立即判失败，交由 verify 查询远端实际结果后再判定（不盲目重推）
      ctx.log('推送响应超时（网络响应丢失）：保持待核验，将先查询远端实际 ref');
      return { timeout: true, note: '推送响应超时：待结果核验按远端查询判定' };
    }
    throw e;
  }
  if (out.code !== 0) {
    throw new GitStageError(`推送被拒绝：${head(scrubSecrets(out.stderr || out.stdout), 4)}`, 'push-rejected');
  }
  ctx.log(head(out.stderr || '推送完成', 6));
  return { note: head(out.stderr || '推送完成', 10) };
}

// 7. verify：读取远端实际 ref 与冻结 OID 比对，一致才标成功
async function stageVerify(ctx) {
  const { run } = ctx;
  const { remote, targetBranch, tagName } = run.config;
  const sourceOid = run.frozen.sourceOid;
  const refs = [`refs/heads/${targetBranch}`, ...(tagName ? [`refs/tags/${tagName}`] : [])];
  const out = await ctx.exec('git', ['ls-remote', remote, ...refs], { cwd: ctx.projectRoot, timeoutMs: 20000 });
  if (out.code !== 0) {
    throw new GitStageError(`核验读取远端失败：${head(scrubSecrets(out.stderr), 3)}`, 'verify-unreachable');
  }
  const actual = {};
  for (const line of out.stdout.trim().split('\n').filter(Boolean)) {
    const [oid, ref] = line.split('\t');
    actual[ref] = oid;
  }
  const branchOid = actual[refs[0]] || null;
  const pushStage = run.stages.find((s) => s.key === 'push')?.result || {};
  if (branchOid !== sourceOid) {
    throw new GitStageError(
      `结果核验不一致：远端 ${targetBranch} 实际为 ${branchOid ? branchOid.slice(0, 8) : '（不存在）'}，冻结提交 ${sourceOid.slice(0, 8)}。不标记成功，可重试（重试先查询远端）`,
      'verify-mismatch',
      { remoteOid: branchOid, frozenOid: sourceOid },
    );
  }
  if (tagName) {
    const tagOid = actual[`refs/tags/${tagName}`];
    if (tagOid && tagOid !== sourceOid) {
      throw new GitStageError(`标签核验不一致：远端标签 ${tagName} 指向 ${tagOid.slice(0, 8)}`, 'verify-mismatch');
    }
  }
  const note = pushStage.timeout
    ? '网络响应丢失：按远端查询结果判定（远端实际 ref 与冻结 OID 一致，未盲目重推）'
    : '远端实际 ref 与冻结 OID 比对一致';
  ctx.log(`核验通过：${note}`);
  pushEvidence(run, 'verify', note, { after: branchOid, frozenOid: sourceOid });
  return { remoteOid: branchOid, frozenOid: sourceOid, note };
}

const STAGE_IMPLS = {
  freeze: stageFreeze,
  'local-precheck': stageLocalPrecheck,
  'fetch-remote': stageFetchRemote,
  'quality-check': stageQualityCheck,
  plan: stagePlan,
  push: stagePush,
  verify: stageVerify,
};

/* ---------- 流水线驱动 ---------- */

const STAGE_KEYS = GIT_STAGES.map((s) => s.key);

// 执行流水线：默认从头跑到 verify；through=plan 为预检（只读不推送）；
// from 指定起点（重试场景配合 store.resetForRetry，由首个 pending 阶段自然接续）。
export async function runGitPipeline({ dataDir, projectRoot, runId, exec, cfg = {}, through = 'verify', from = null }) {
  if (!exec) exec = realExec();
  const throughIdx = STAGE_KEYS.indexOf(through);
  if (throughIdx === -1) throw new AtbError(`未知 Git 阶段：${through}`);
  const readChecks = throughIdx < STAGE_KEYS.indexOf('push');
  const precheckOnly = through === 'plan';

  let run = mutateRun(dataDir, runId, (r) => {
    r.status = precheckOnly ? 'prechecking' : 'running';
  }, { by: 'board', action: precheckOnly ? 'precheck' : 'start' });

  const startIdx = from ? STAGE_KEYS.indexOf(from) : run.stages.findIndex((s) => s.status !== 'done' && s.status !== 'skipped');
  // 指定起点（refresh 场景）：重置该阶段为待执行（如重新核验 verify），只重跑未完成/指定操作
  if (from && startIdx !== -1) {
    run = mutateRun(dataDir, runId, (r) => {
      const s = r.stages.find((x) => x.key === from);
      if (s && s.status !== 'pending') {
        s.status = 'pending';
        s.error = null;
      }
    }, { by: 'board', action: `refresh:${from}` });
  }
  if (startIdx === -1 || startIdx > throughIdx) {
    // 无待执行阶段：状态收敛（预检完成回 draft 待启动；全量完成标成功）
    return mutateRun(dataDir, runId, (r) => {
      if (precheckOnly) {
        if (r.status === 'prechecking') r.status = 'draft';
      } else if (r.stages.every((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'canceled')) {
        r.status = r.stages.every((s) => s.status !== 'canceled') ? 'succeeded' : r.status;
      }
    }, { by: 'board', action: 'noop' });
  }

  for (let i = Math.max(startIdx, 0); i <= throughIdx; i++) {
    const key = STAGE_KEYS[i];
    const stageDef = run.stages.find((s) => s.key === key);
    if (!stageDef || stageDef.status === 'done' || stageDef.status === 'skipped') continue;
    // 取消后续阶段：每阶段执行前核对最新状态（外部取消请求即时生效）
    const disk = readRun(dataDir, runId);
    if (disk.status === 'canceled') return disk;
    run = mutateRun(dataDir, runId, (r) => {
      const s = r.stages.find((x) => x.key === key);
      s.status = 'running';
      s.startedAt = new Date().toISOString();
      r.updatedAt = new Date().toISOString();
    }, { by: 'board', action: `stage:${key}:start` });
    const ctx = {
      dataDir, projectRoot, run, exec, cfg,
      log: (line) => appendStageLog(dataDir, runId, key, line),
    };
    try {
      // 每阶段基于最新 run 快照执行（前序阶段结果在 run.stages 内）
      const current = readRun(dataDir, runId);
      ctx.run = current;
      const evidenceBefore = current.evidence.length;
      const result = await STAGE_IMPLS[key](ctx);
      const stageEvidence = current.evidence.slice(evidenceBefore);
      run = mutateRun(dataDir, runId, (r) => {
        const s = r.stages.find((x) => x.key === key);
        s.status = 'done';
        s.endedAt = new Date().toISOString();
        s.result = { ...(s.result || {}), ...result };
        if (key === 'freeze') r.frozen = current.frozen; // 冻结输入入主记录
        if (key === 'plan') r.frozen.planHash = result.planHash;
        for (const ev of stageEvidence) r.evidence.push(ev); // 阶段内记录的执行证据入账
        pushEvidence(r, key, `阶段完成：${key}`);
      }, { by: 'board', action: `stage:${key}:done` });
    } catch (e) {
      const result = e instanceof GitStageError ? e.stageResult : null;
      run = mutateRun(dataDir, runId, (r) => {
        const s = r.stages.find((x) => x.key === key);
        s.status = 'failed';
        s.endedAt = new Date().toISOString();
        s.error = { message: scrubSecrets(e.message || String(e)), kind: e instanceof GitStageError ? e.kind : 'error' };
        if (result) s.result = { ...(s.result || {}), ...result };
        r.status = 'failed';
      }, { by: 'board', action: `stage:${key}:failed` });
      appendStageLog(dataDir, runId, key, `阶段失败（${e instanceof GitStageError ? e.kind : 'error'}）：${e.message}`);
      return run;
    }
  }

  // 全部执行完：预检回 draft（待用户启动）；全量（through=verify）标成功
  return mutateRun(dataDir, runId, (r) => {
    if (precheckOnly) {
      if (r.status === 'prechecking') r.status = 'draft';
    } else if (r.stages.every((s) => s.status === 'done' || s.status === 'skipped')) {
      r.status = 'succeeded';
    }
  }, { by: 'board', action: readChecks ? 'precheck-done' : 'pipeline-done' });
}
