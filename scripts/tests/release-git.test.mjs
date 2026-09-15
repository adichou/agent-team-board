#!/usr/bin/env node
// REQ-20260910-029 发布模块 —— Git 流水线真实集成测试 G1~G10
// 真实临时 bare 远端 + 真实 git 命令；网络响应丢失场景在 exec 层注入（真实推送已到达远端后报超时）。
// 用法：node scripts/tests/release-git.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as store from '../lib/release-store.mjs';
import { worktreeDirtyFiles } from '../lib/product-release-git.mjs';
import { runGitPipeline, realExec } from '../lib/release-git.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000, ...opts });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function mkEnv({ advertiseAtomic = true } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-git-')));
  const remote = path.join(tmp, 'remote.git');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  git(tmp, ['init', '--bare', '-b', 'main', remote]);
  if (!advertiseAtomic) git(remote, ['config', 'receive.advertiseAtomic', 'false']);
  git(work, ['init', '-b', 'main']);
  git(work, ['config', 'user.email', 't@e.co']);
  git(work, ['config', 'user.name', 'T']);
  git(work, ['remote', 'add', 'origin', remote]);
  const commit = (msg, file = 'f.txt') => {
    fs.writeFileSync(path.join(work, file), `${msg}\n${Math.random()}`, { flag: 'a' });
    git(work, ['add', '-A']);
    git(work, ['commit', '-m', msg]);
  };
  commit('init');
  core.initData(work); // REQ-20260911-009 起 initData 会切到 dev：发布场景设定回到 main
  git(work, ['switch', '-q', 'main']);
  return { tmp, remote, work, dataDir: core.dataDirFrom(work), commit, oid: (ref = 'HEAD') => git(work, ['rev-parse', ref]) };
}

const cfgFor = (env, over = {}) => ({
  remote: 'origin', sourceBranch: 'main', targetBranch: 'main',
  tagName: null, checkCommand: 'true', ...over,
});
const newRun = (env, over, cfgOver = {}) =>
  store.createRun(env.dataDir, { target: 'git', config: cfgFor(env, { ...cfgOver, ...over }), by: 'test' });

const full = (env, runId, opts = {}) =>
  runGitPipeline({ dataDir: env.dataDir, projectRoot: env.work, runId, exec: realExec({ timeoutMs: 30000 }), ...opts });
const remoteOid = (env, ref = 'refs/heads/main') => {
  const r = spawnSync('git', ['ls-remote', env.remote, ref], { encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
  return (r.stdout.trim().split('\t')[0]) || null;
};

t('G1 干净仓库真实推送成功：verify 比对远端实际 OID 与冻结 OID 一致', async () => {
  const env = mkEnv();
  env.commit('second');
  const run = newRun(env, {});
  const out = await full(env, run.id);
  assert.equal(out.status, 'succeeded');
  const frozen = out.stages[0].result.sourceOid;
  assert.equal(frozen, env.oid('main'), '冻结源提交 OID');
  assert.equal(remoteOid(env), frozen, '远端实际 ref 与冻结 OID 一致才标成功');
  assert.ok(out.stages.every((s) => s.status === 'done' || s.status === 'skipped'), '全部阶段完成');
  assert.ok(out.evidence.some((e) => e.kind === 'verify'), '核验证据（外部操作前后 OID）');
  assert.ok(fs.existsSync(path.join(store.runDir(env.dataDir, run.id), 'logs', 'push.log')), '阶段日志落盘');
});

t('G2 未提交修改 → 本地预检阻塞并引导回提交功能；远端未被推送', async () => {
  const env = mkEnv();
  env.commit('second');
  fs.writeFileSync(path.join(env.work, 'dirty.txt'), 'x');
  const run = newRun(env, {});
  const before = remoteOid(env);
  const out = await full(env, run.id);
  assert.equal(out.status, 'failed');
  const pre = out.stages.find((s) => s.key === 'local-precheck');
  assert.equal(pre.status, 'failed');
  assert.match(pre.error.message, /未提交|不干净|干净/);
  assert.match(pre.error.message, /提交/, '引导回现有提交功能（不自动 add/commit/stash）');
  assert.equal(remoteOid(env), before, '预检失败不推送');
});

// BUG-20260915-013：用真实状态输出验证首行空格、目录豁免与失败路径。
for (const scenario of [
  { name: '空状态输出', board: [], outside: null },
  { name: '单条看板修改', board: ['repro.md'], outside: null },
  { name: '多条看板修改', board: ['a.md', 'b.md'], outside: null },
  { name: '首行普通修改', board: [], outside: 'modified' },
  { name: '混合修改', board: ['repro.md'], outside: 'modified' },
  { name: '暂存修改', board: [], outside: 'staged' },
  { name: '未跟踪文件', board: [], outside: 'untracked' },
]) {
  t(`G2 回归 ${scenario.name}`, async () => {
    const env = mkEnv();
    try {
      fs.mkdirSync(path.join(env.work, 'src'));
      fs.writeFileSync(path.join(env.work, 'src/.keep'), '');
      const tracked = [...scenario.board.map((p) => `docs/agent-team-board/${p}`)];
      if (scenario.outside && scenario.outside !== 'untracked') tracked.push('src/repro.txt');
      for (const file of tracked) fs.writeFileSync(path.join(env.work, file), 'before\n');
      git(env.work, ['add', '-A']);
      git(env.work, ['commit', '-m', 'prepare tracked files']);
      const beforeHead = env.oid();
      for (const file of tracked) fs.appendFileSync(path.join(env.work, file), 'after\n');
      if (scenario.outside === 'untracked') fs.writeFileSync(path.join(env.work, 'src/repro.txt'), 'new\n');
      if (scenario.outside === 'staged') git(env.work, ['add', 'src/repro.txt']);
      const raw = spawnSync('git', ['status', '--porcelain'], { cwd: env.work, encoding: 'utf8', env: GIT_ENV }).stdout;
      if (scenario.board.length || scenario.outside === 'modified') assert.ok(raw.startsWith(' M '), JSON.stringify(raw));
      if (scenario.board.length || scenario.outside) assert.ok(raw.endsWith('\n'), '真实 porcelain 保留末尾换行');
      else assert.equal(raw, '', '干净仓库输出为空');
      const index = git(env.work, ['diff', '--cached']);
      const run = newRun(env, {});
      const base = realExec({ timeoutMs: 30000 });
      const mutations = [];
      const exec = async (cmd, args, opts) => {
        if (['push', 'add', 'commit', 'stash', 'reset', 'checkout'].includes(args[0])) mutations.push(args);
        return base(cmd, args, opts);
      };
      const beforeRemote = remoteOid(env);
      const out = await full(env, run.id, { through: 'local-precheck', exec });
      const pre = out.stages.find((s) => s.key === 'local-precheck');
      if (scenario.outside) {
        assert.equal(pre.status, 'failed');
        assert.equal(pre.error.kind, 'dirty');
        assert.match(pre.error.message, /src\/repro\.txt/, '错误提示保留完整路径');
        assert.deepEqual(pre.result.files, ['src/repro.txt'], '结果仅包含完整的看板外路径');
        assert.ok(!pre.error.message.includes('ocs/agent-team-board'), '不包含被截断的看板路径');
      } else {
        assert.equal(pre.status, 'done', JSON.stringify(pre.error));
        assert.deepEqual(await worktreeDirtyFiles(env.work, base), [], '产品发布与 REL 一致豁免看板修改');
      }
      assert.deepEqual(mutations, [], '预检不调用推送或自动处理工作区');
      assert.equal(remoteOid(env), beforeRemote, '远端引用不变');
      assert.equal(env.oid(), beforeHead, '没有自动提交');
      assert.equal(git(env.work, ['diff', '--cached']), index, '暂存区不变');
      for (const file of tracked) assert.equal(fs.readFileSync(path.join(env.work, file), 'utf8'), 'before\nafter\n', file);
    } finally {
      fs.rmSync(env.tmp, { recursive: true, force: true });
    }
  });
}

t('G3 无 remote → 冻结阶段明确阻塞；detached HEAD → 预检阻塞', async () => {
  const env = mkEnv();
  env.commit('second');
  git(env.work, ['remote', 'remove', 'origin']);
  let run = newRun(env, {});
  let out = await full(env, run.id);
  assert.equal(out.status, 'failed');
  assert.equal(out.stages[0].status, 'failed');
  assert.match(out.stages[0].error.message, /remote/);

  const env2 = mkEnv();
  env2.commit('second');
  git(env2.work, ['checkout', '--detach']);
  run = newRun(env2, {});
  out = await full(env2, run.id);
  assert.equal(out.status, 'failed');
  const pre = out.stages.find((s) => s.key === 'local-precheck');
  assert.equal(pre.status, 'failed');
  assert.match(pre.error.message, /detached|游离/);
});

for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply']) {
  t(`G3 未完成 ${marker} 继续阻塞`, async () => {
    const env = mkEnv();
    try {
      if (marker === 'MERGE_HEAD') fs.writeFileSync(path.join(env.work, '.git', marker), `${env.oid()}\n`);
      else fs.mkdirSync(path.join(env.work, '.git', marker));
      const run = newRun(env, {});
      const out = await full(env, run.id);
      const pre = out.stages.find((s) => s.key === 'local-precheck');
      assert.equal(pre.status, 'failed');
      assert.equal(pre.error.kind, 'in-progress');
      assert.equal(remoteOid(env), null, '未完成合并或变基时远端不变');
    } finally {
      fs.rmSync(env.tmp, { recursive: true, force: true });
    }
  });
}

t('G4 落后 / 分叉分别阻塞且文案区分（不自动改写历史）', async () => {
  // 落后：远端领先，本地未动
  const behind = mkEnv();
  git(behind.work, ['push', 'origin', 'main']);
  const tmp2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-git-clone-')));
  git(tmp2, ['clone', behind.remote, tmp2]);
  git(tmp2, ['config', 'user.email', 't@e.co']);
  git(tmp2, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(tmp2, 'r.txt'), 'remote ahead\n');
  git(tmp2, ['add', '-A']);
  git(tmp2, ['commit', '-m', 'remote ahead']);
  git(tmp2, ['push', 'origin', 'main']);
  let run = newRun(behind, {});
  let out = await full(behind, run.id);
  assert.equal(out.status, 'failed');
  let fetch = out.stages.find((s) => s.key === 'fetch-remote');
  assert.equal(fetch.status, 'failed');
  assert.match(fetch.error.message, /落后/);

  // 分叉：远端与本地各有新提交
  const div = mkEnv();
  git(div.work, ['push', 'origin', 'main']);
  const c2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-git-clone2-')));
  git(c2, ['clone', div.remote, c2]);
  git(c2, ['config', 'user.email', 't@e.co']);
  git(c2, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(c2, 'r.txt'), 'r\n');
  git(c2, ['add', '-A']);
  git(c2, ['commit', '-m', 'remote ahead']);
  git(c2, ['push', 'origin', 'main']);
  div.commit('local ahead');
  run = newRun(div, {});
  out = await full(div, run.id);
  fetch = out.stages.find((s) => s.key === 'fetch-remote');
  assert.equal(fetch.status, 'failed');
  assert.match(fetch.error.message, /分叉/);
});

t('G5 受保护分支 → 阻塞并展示 PR/MR 入口（protectedBranches 配置）', async () => {
  const env = mkEnv();
  env.commit('second');
  const run = newRun(env, {});
  const out = await full(env, run.id, { cfg: { protectedBranches: ['main'] } });
  assert.equal(out.status, 'failed');
  const fetch = out.stages.find((s) => s.key === 'fetch-remote');
  assert.equal(fetch.status, 'failed');
  assert.equal(fetch.error.kind, 'protected');
  assert.match(fetch.error.message, /保护/);
  assert.match(fetch.error.message, /PR|MR|评审/, '展示 PR/MR 流程入口说明');
  assert.ok(fetch.error.message.includes(env.remote), '展示远端地址（脱敏后）');
  assert.equal(remoteOid(env), null, '未推送');
});

t('G6 质量检查失败 → 阻塞不推送，命令与退出码入证据', async () => {
  const env = mkEnv();
  env.commit('second');
  const run = newRun(env, {}, { checkCommand: 'sh -c "echo boom >&2; exit 3"' });
  const out = await full(env, run.id);
  assert.equal(out.status, 'failed');
  const q = out.stages.find((s) => s.key === 'quality-check');
  assert.equal(q.status, 'failed');
  assert.equal(q.result.exitCode, 3, '退出码入证据');
  assert.ok((q.result.command || '').includes('boom') || (q.result.log || '').includes('boom'), '命令日志保留');
  assert.equal(remoteOid(env), null, '检查失败远端不变');
});

t('G7 标签冲突拒绝覆盖；同 OID 标签不重复推送', async () => {
  const env = mkEnv();
  const first = env.oid('HEAD');
  git(env.work, ['push', 'origin', 'main']);
  // 远端已有 v1 指向 first
  const c2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-git-tag-')));
  git(c2, ['clone', env.remote, c2]);
  git(c2, ['config', 'user.email', 't@e.co']);
  git(c2, ['config', 'user.name', 'T']);
  git(c2, ['tag', 'v1', first]);
  git(c2, ['push', 'origin', 'v1']);
  env.commit('second');
  const second = env.oid('HEAD');

  // 冲突：本地 v1 指向 second，远端 v1 指向 first → 拒绝
  git(env.work, ['tag', 'v1', second]);
  let run = newRun(env, {}, { tagName: 'v1' });
  let out = await full(env, run.id);
  assert.equal(out.status, 'failed');
  const plan = out.stages.find((s) => s.key === 'plan');
  assert.equal(plan.status, 'failed');
  assert.match(plan.error.message, /标签/);
  const tagRemote = spawnSync('git', ['ls-remote', env.remote, 'refs/tags/v1'], { encoding: 'utf8', env: GIT_ENV }).stdout.trim().split('\t')[0];
  assert.equal(tagRemote, first, '远端标签未被覆盖');

  // 同 OID：远端 v2 已指向 second → 分支无新提交、标签不重复推送，直接核验成功
  git(env.work, ['tag', 'v2', second]);
  git(env.work, ['push', 'origin', 'main']); // 远端 main → second
  git(c2, ['fetch', 'origin']);
  git(c2, ['tag', 'v2', second]);
  git(c2, ['push', 'origin', 'v2']);
  run = newRun(env, { tagName: 'v2' }, { targetBranch: 'main' });
  out = await full(env, run.id);
  assert.equal(out.status, 'succeeded');
  assert.equal(remoteOid(env), second, '分支推送成功');
});

t('G8 分支+标签同批 atomic：远端不支持时阻塞说明，支持后成功', async () => {
  const env = mkEnv({ advertiseAtomic: false });
  env.commit('second');
  git(env.work, ['tag', 'v1']);
  const run = newRun(env, {}, { tagName: 'v1' });
  let out = await full(env, run.id);
  assert.equal(out.status, 'failed');
  const plan = out.stages.find((s) => s.key === 'plan');
  assert.equal(plan.status, 'failed');
  assert.match(plan.error.message, /atomic/, '说明远端不支持 atomic（不静默降级）');
  assert.equal(remoteOid(env), null, '未部分发布');

  // 恢复远端 atomic 支持后重试成功
  git(env.remote, ['config', 'receive.advertiseAtomic', 'true']);
  store.mutateRun(env.dataDir, run.id, (r) => store.resetForRetry(r), { by: 'test', action: 'retry' });
  out = await full(env, run.id);
  assert.equal(out.status, 'succeeded');
  assert.equal(remoteOid(env), env.oid('main'));
  const tagOid = spawnSync('git', ['ls-remote', env.remote, 'refs/tags/v1'], { encoding: 'utf8', env: GIT_ENV }).stdout.trim().split('\t')[0];
  assert.ok(tagOid, '标签同批推送');
});

t('G9 只推选定引用；并发远端更新触发计划失效（不覆盖历史）', async () => {
  const env = mkEnv();
  env.commit('base2');
  git(env.work, ['branch', 'feature']);
  git(env.work, ['push', 'origin', 'main']);

  // 只推 main：feature 不被隐式推送
  env.commit('third');
  let run = newRun(env, {});
  let out = await full(env, run.id);
  assert.equal(out.status, 'succeeded');
  const feat = spawnSync('git', ['ls-remote', env.remote, 'refs/heads/feature'], { encoding: 'utf8', env: GIT_ENV }).stdout.trim();
  assert.equal(feat, '', '只推选定引用（feature 未被推送）');

  // 计划失效：本地先领先（快进成立）→ 预检冻结计划 → 他人推进远端 → 启动时检测并阻塞，不覆盖
  const env2 = mkEnv();
  git(env2.work, ['push', 'origin', 'main']);
  env2.commit('local new');
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-git-other-')));
  git(other, ['clone', env2.remote, other]);
  git(other, ['config', 'user.email', 't@e.co']);
  git(other, ['config', 'user.name', 'T']);
  run = newRun(env2, {});
  out = await full(env2, run.id, { through: 'plan' });
  assert.equal(out.stages.find((s) => s.key === 'plan').status, 'done', '预检阶段计划成立');
  // 预检后他人推进远端（本地计划基于旧远端 OID）
  fs.writeFileSync(path.join(other, 'o.txt'), 'o\n');
  git(other, ['add', '-A']);
  git(other, ['commit', '-m', 'other push']);
  git(other, ['push', 'origin', 'main']);
  git(env2.work, ['fetch', 'origin']); // 本地能感知远端（不合并，保持本地领先状态）
  const otherOid = remoteOid(env2);
  out = await full(env2, run.id, { through: 'verify' });
  assert.equal(out.status, 'failed', '计划失效阻塞');
  const push = out.stages.find((s) => s.key === 'push');
  assert.equal(push.status, 'failed');
  assert.match(push.error.message, /失效|变化/);
  assert.equal(remoteOid(env2), otherOid, '远端未被覆盖（不盲目重推旧计划）');
});

t('G10 网络响应丢失：真实推送已到远端但客户端报超时 → verify 查询后判成功，不盲目重推', async () => {
  const env = mkEnv();
  env.commit('second');
  const run = newRun(env, {});
  const base = realExec({ timeoutMs: 30000 });
  let pushCalls = 0;
  const flaky = async (cmd, args, opts) => {
    // 只拦截真实推送（plan 阶段的 --dry-run 预演放行）
    if (args[0] === 'push' && !args.includes('--dry-run')) {
      pushCalls++;
      await base(cmd, args, opts); // 真实推送已到达远端
      const err = new Error('模拟网络超时：响应丢失');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    return base(cmd, args, opts);
  };
  const out = await runGitPipeline({ dataDir: env.dataDir, projectRoot: env.work, runId: run.id, exec: flaky });
  assert.equal(pushCalls, 1, '推送只执行一次');
  assert.equal(out.status, 'succeeded', 'verify 先查询远端实际 ref → 判成功');
  assert.equal(remoteOid(env), env.oid('main'), '远端确已到达目标');
  const verify = out.stages.find((s) => s.key === 'verify');
  assert.equal(verify.status, 'done');
  assert.match(verify.result.note || '', /查询|超时/, '核验说明按查询结果判定');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
