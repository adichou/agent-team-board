#!/usr/bin/env node
// REQ-20260910-029 发布模块 —— 服务接口测试 H1~H3
// 覆盖：state 两态、草稿创建/保存/详情/列表、precheck 只读不推送、start 互斥、跨项目隔离、
// retry/cancel/refresh/sku/targets、脱敏、静态 release.js、服务重启恢复（不重复执行）。
// 用法：node scripts/tests/release-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
}

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

const waitRun = async (port, P, id, until, timeoutMs = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const r = await req(port, 'GET', `/api/release/run/${id}${P}`);
    if (r.status !== 200) throw new Error(`读取运行 ${id} 失败：${r.status}`);
    if (until(r.json.run)) return r.json.run;
    if (Date.now() - t0 > timeoutMs) {
      const stages = (r.json.run.stages || []).map((s) => `${s.key}:${s.status}${s.error ? `(${s.error.message.slice(0, 60)})` : ''}`).join(' | ');
      throw new Error(`等待运行 ${id} 超时：${JSON.stringify(r.json.run.status)}；阶段：${stages}`);
    }
    await sleep(150);
  }
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const gitCfg = (remote = 'origin', over = {}) => ({
  remote, sourceBranch: 'main', targetBranch: 'main', tagName: null, checkCommand: 'true', ...over,
});

t('H1~H3 /api/release* 全链路', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-serve-')));
  const projA = path.join(tmp, 'projA');
  const projB = path.join(tmp, 'projB');
  const remoteA = path.join(tmp, 'remoteA.git');
  fs.mkdirSync(projA);
  fs.mkdirSync(projB);
  git(tmp, ['init', '--bare', '-b', 'main', remoteA]);
  git(projA, ['init', '-b', 'main']);
  git(projA, ['config', 'user.email', 't@e.co']);
  git(projA, ['config', 'user.name', 'T']);
  git(projA, ['remote', 'add', 'origin', remoteA]);
  fs.writeFileSync(path.join(projA, 'a.txt'), 'a\n');
  git(projA, ['add', '-A']);
  git(projA, ['commit', '-m', 'init']);
  git(projA, ['push', 'origin', 'main']);
  fs.writeFileSync(path.join(projA, 'a.txt'), 'a2\n');
  git(projA, ['add', '-A']);
  git(projA, ['commit', '-m', 'second']);
  core.initData(projA);
  core.initData(projB);

  const port = 31000 + Math.floor(Math.random() * 20000);
  const reg = path.join(tmp, 'reg.json');
  const spawnServer = () => spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: projA,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let server = spawnServer();
  const P = `?project=${encodeURIComponent(projA)}`;
  const PB = `?project=${encodeURIComponent(projB)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // H1：未初始化看板的项目 → initialized:false（项目可正常打开）
    const bare = path.join(tmp, 'bare');
    fs.mkdirSync(bare);
    let r = await req(port, 'GET', `/api/release/state?project=${encodeURIComponent(bare)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, false);

    // H1：初始化项目 → 空运行列表 + 环境摘要（git remote 可用性 / ASC 凭据情况）
    r = await req(port, 'GET', `/api/release/state${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, true);
    assert.deepEqual(r.json.runs, []);
    assert.ok(r.json.env && r.json.env.git && r.json.env.git.repo === true, 'git 环境摘要');
    assert.ok('ascConfigured' in r.json.env.apple, 'ASC 凭据配置情况');

    // H1：创建草稿 → 保存配置 → 详情 → 未知 404
    r = await req(port, 'POST', `/api/release/run${P}`, { target: 'git', config: gitCfg() });
    assert.equal(r.status, 201);
    const id1 = r.json.run.id;
    assert.equal(r.json.run.status, 'draft');
    r = await req(port, 'POST', `/api/release/run/save${P}`, { id: id1, config: gitCfg('origin', { checkCommand: 'echo saved-ok' }) });
    assert.equal(r.status, 200);
    assert.equal(r.json.run.config.checkCommand, 'echo saved-ok');
    r = await req(port, 'GET', `/api/release/run/${id1}${P}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.logs, '详情含阶段日志');
    r = await req(port, 'GET', `/api/release/run/REL-20990101-999${P}`);
    assert.equal(r.status, 404);
    // 非可执行类型拒绝
    r = await req(port, 'POST', `/api/release/run${P}`, { target: 'web', config: {} });
    assert.equal(r.status, 400);

    // H3：targets 发现（git remotes / 分支）
    r = await req(port, 'GET', `/api/release/targets${P}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.git.remotes, ['origin']);
    assert.ok(r.json.git.branches.includes('main'));

    // H2：precheck 只读不推送（freeze→plan，远端 ref 不变）
    const beforeOid = git(projA, ['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0];
    r = await req(port, 'POST', `/api/release/run/precheck${P}`, { id: id1 });
    assert.equal(r.status, 200);
    const pre = await waitRun(port, P, id1, (run) => ['failed', 'succeeded', 'canceled'].includes(run.status) || (run.status === 'draft' && run.stages.find((s) => s.key === 'plan')?.status === 'done'));
    assert.equal(pre.stages.find((s) => s.key === 'plan').status, 'done', '预检推进到计划');
    assert.equal(pre.stages.find((s) => s.key === 'push').status, 'pending', '预检不推送');
    const afterPre = git(projA, ['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0];
    assert.equal(afterPre, beforeOid, '预检（含 dry-run）不触发 push');

    // H2：start 互斥 —— 慢检查保持运行中，同目标第二个 start 409
    const id2 = (await req(port, 'POST', `/api/release/run${P}`, { target: 'git', config: gitCfg('origin', { checkCommand: 'sleep 2', targetBranch: 'release' }) })).json.run.id;
    r = await req(port, 'POST', `/api/release/run/start${P}`, { id: id2 });
    assert.equal(r.status, 200);
    r = await req(port, 'POST', `/api/release/run/start${P}`, { id: id1 });
    assert.equal(r.status, 409, '同目标并发互斥');
    assert.ok(r.json.conflict);
    const run2 = await waitRun(port, P, id2, (run) => run.status === 'succeeded' || run.status === 'failed');
    assert.equal(run2.status, 'succeeded', '慢检查运行最终成功');

    // H2：跨项目隔离 —— B 项目看不到 A 的运行
    r = await req(port, 'GET', `/api/release/state${PB}`);
    assert.deepEqual(r.json.runs, [], '项目隔离');
    r = await req(port, 'GET', `/api/release/run/${id1}${PB}`);
    assert.equal(r.status, 404, '跨项目按不存在处理');

    // H3：脱敏 —— remote URL 带凭据时响应内已剥离
    git(projA, ['remote', 'set-url', 'origin', 'https://user:pass@127.0.0.1:1/r.git']);
    const id3 = (await req(port, 'POST', `/api/release/run${P}`, { target: 'git', config: gitCfg() })).json.run.id;
    await req(port, 'POST', `/api/release/run/precheck${P}`, { id: id3 });
    const run3 = await waitRun(port, P, id3, (run) => run.status === 'failed');
    const raw = JSON.stringify(run3);
    assert.ok(!raw.includes('user:pass'), '响应内远端地址已脱敏');
    assert.ok(run3.stages[0].result.remoteUrl && !run3.stages[0].result.remoteUrl.includes('pass'), '冻结记录存脱敏地址');
    git(projA, ['remote', 'set-url', 'origin', remoteA]);

    // H3：retry —— remote 已修复为可达地址后重试：只重跑未完成操作并最终成功（失败可恢复）
    r = await req(port, 'POST', `/api/release/run/retry${P}`, { id: id3 });
    assert.equal(r.status, 200, '失败运行可重试');
    const retried = await waitRun(port, P, id3, (run) => run.status === 'succeeded' || run.status === 'failed');
    assert.equal(retried.status, 'succeeded', '配置修复后重试成功（不重复已完成的冻结/预检阶段）');
    assert.equal(retried.stages.find((s) => s.key === 'freeze').endedAt, run3.stages.find((s) => s.key === 'freeze').endedAt, '已完成阶段未被重跑');
    const id4 = (await req(port, 'POST', `/api/release/run${P}`, { target: 'git', config: gitCfg('origin', { checkCommand: 'sleep 3' }) })).json.run.id;
    r = await req(port, 'POST', `/api/release/run/start${P}`, { id: id4 });
    assert.equal(r.status, 200);
    r = await req(port, 'POST', `/api/release/run/cancel${P}`, { id: id4 });
    assert.equal(r.status, 200);
    const canceled = await waitRun(port, P, id4, (run) => run.status === 'canceled');
    assert.equal(canceled.status, 'canceled', '取消后续阶段');
    r = await req(port, 'POST', `/api/release/run/refresh${P}`, { id: id4 });
    assert.equal(r.status, 200, '刷新外部真实状态（只读）');
    r = await req(port, 'POST', `/api/release/sku${P}`, { bundleId: 'com.example.App', sku: 'SKU-1' });
    assert.equal(r.status, 200);
    assert.equal(r.json.mapping.sku, 'SKU-1');

    // H3：静态 release.js 可访问
    r = await req(port, 'GET', '/release.js');
    assert.equal(r.status, 200);

    // H2 补充：服务重启恢复 —— 已完成阶段持久化，不重复执行（阶段完成时间不变）
    const doneAt = pre.stages.find((s) => s.key === 'plan').endedAt;
    server.kill('SIGKILL');
    await sleep(300);
    server = spawnServer();
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); break; } catch {}
    }
    r = await req(port, 'GET', `/api/release/run/${id1}${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.run.stages.find((s) => s.key === 'plan').endedAt, doneAt, '重启后已完成阶段不被重跑');
  } finally {
    server.kill('SIGKILL');
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split("\n")[0]}\n    ${String(e.stack).split("\n").slice(1, 4).join("\n    ")}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
