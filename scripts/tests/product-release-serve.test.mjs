#!/usr/bin/env node
// REQ-20260915-002 产品发布服务接口（/api/product-release/*）测试 G1~G6、I2
// 用法：node scripts/tests/product-release-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const VERSION = '1.2.0';

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return String(r.stdout).trim();
};

function req(port, method, pathname, body, project) {
  const p = project ? `${pathname.includes('?') ? '&' : '?'}project=${encodeURIComponent(project)}` : '';
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: `${pathname}${p}`, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 15000,
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

const waitRun = async (port, id, until, timeoutMs = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const r = await req(port, 'GET', `/api/product-release/run/${id}`);
    if (r.status !== 200) throw new Error(`读取 ${id} 失败：${r.status}`);
    if (until(r.json.run)) return r.json.run;
    if (Date.now() - t0 > timeoutMs) {
      const stages = (r.json.run.stages || []).map((s) => `${s.key}:${s.status}${s.error ? `(${s.error.message.slice(0, 50)})` : ''}`).join(' | ');
      throw new Error(`等待 ${id} 超时：${r.json.run.status}；${stages}`);
    }
    await sleep(200);
  }
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function commitFile(dir, file, content, msg) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

function mkFixture(name) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-prel-serve-${name}-`)));
  const proj = path.join(tmp, 'proj');
  const projB = path.join(tmp, 'projB');
  const projC = path.join(tmp, 'projC'); // 未初始化看板（两态）
  const remote = path.join(tmp, 'remote.git');
  const homepage = path.join(tmp, 'homepage');
  fs.mkdirSync(proj);
  fs.mkdirSync(projB);
  fs.mkdirSync(projC);
  fs.mkdirSync(homepage);
  git(tmp, 'init', '--bare', '-b', 'main', remote);
  git(proj, 'init', '-b', 'main');
  git(proj, 'config', 'user.email', 't@e.co');
  git(proj, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, 'add', '-A');
  git(proj, 'commit', '-m', 'init');
  fs.writeFileSync(path.join(proj, 'index.html'), `<!doctype html><meta name="app-version" content="${VERSION}">app`);
  git(proj, 'add', '-A');
  git(proj, 'commit', '-m', 'feat: REQ-20260915-010 webapp');
  const itemCommit = git(proj, 'rev-parse', 'HEAD');
  git(proj, 'checkout', '-b', 'dev');
  commitFile(proj, 'dev.txt', 'd\n', 'dev work');
  git(proj, 'checkout', 'main');
  git(proj, 'remote', 'add', 'origin', remote);
  // 官网
  git(homepage, 'init', '-b', 'main');
  git(homepage, 'config', 'user.email', 't@e.co');
  git(homepage, 'config', 'user.name', 'T');
  for (const lang of ['zh', 'en']) {
    fs.mkdirSync(path.join(homepage, 'proj', lang), { recursive: true });
    for (const page of ['index', 'usage', 'guide', 'changelog']) {
      fs.writeFileSync(path.join(homepage, 'proj', lang, `${page}.html`),
        `<!doctype html><html lang="${lang}"><meta name="site-version" content="${VERSION}"><a href="#" data-webapp-entry>App</a><a href="#" data-lang-switch>切换</a>${page}-${lang}`);
    }
  }
  git(homepage, 'add', '-A');
  git(homepage, 'commit', '-m', 'site');
  core.initData(proj);
  core.initData(projB);
  const dataDir = path.join(proj, 'docs', 'agent-team-board');
  const v = buildStore.createVersion(dataDir, {
    name: '版本 V1', items: [{ itemId: 'REQ-20260915-010', commit: itemCommit, title: 'webapp' }],
  });
  return { tmp, proj, projB, projC, remote, homepage, dataDir, version: v };
}

t('G1~G6 /api/product-release/* 全链路', async () => {
  const s = mkFixture('main');
  const port = 34000 + Math.floor(Math.random() * 20000);
  const reg = path.join(s.tmp, 'reg.json');
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: s.proj,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    await sleep(700);
    // G1（projC 未初始化看板的产品发布态 → initialized:false）
    const st0 = await req(port, 'GET', '/api/product-release/state', null, s.projC);
    assert.equal(st0.status, 200);
    assert.equal(st0.json.initialized, false);
    // G2 配置：无效路径 400；非 git 仓库 400；合法保存
    const bad1 = await req(port, 'POST', '/api/product-release/config', { homepageRepoRoot: '/definitely/not/exist' });
    assert.equal(bad1.status, 400);
    const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-notrepo-'));
    const bad2 = await req(port, 'POST', '/api/product-release/config', { homepageRepoRoot: notRepo });
    assert.equal(bad2.status, 400);
    const cfg = await req(port, 'POST', '/api/product-release/config', { homepageRepoRoot: s.homepage });
    assert.equal(cfg.status, 200);
    const st1 = await req(port, 'GET', '/api/product-release/state');
    assert.equal(st1.json.initialized, true);
    assert.equal(st1.json.config.homepageRepoRoot, s.homepage);
    assert.equal(st1.json.env.homepageConfigured, true);
    // G3 未合并 BLD → 400
    const early = await req(port, 'POST', '/api/product-release/from-build', { bldId: s.version.id, version: VERSION });
    assert.equal(early.status, 400);
    assert.ok(/合并/.test(early.json.error));
    // 合并 BLD（经 HTTP，同时覆盖 I2：merge.mainSha 落真实值）
    const merge = await req(port, 'POST', '/api/build/version/merge', { id: s.version.id });
    assert.equal(merge.status, 200, JSON.stringify(merge.json));
    const merged = buildStore.readVersion(s.dataDir, s.version.id);
    assert.equal(merged.status, 'merged');
    // 合并完成时刻的 main 头（其后 REQ-20260914-007 管理记录提交可能再推进 main：允许为祖先）
    assert.match(merged.merge.mainSha, /^[0-9a-f]{40}$/);
    const anc = spawnSync('git', ['merge-base', '--is-ancestor', merged.merge.mainSha, 'main'], { cwd: s.proj, encoding: 'utf8', env: GIT_ENV });
    assert.equal(anc.status, 0, 'merge.mainSha 是当前 main 的祖先（真实 rev-parse 值）');
    // 创建 PREL
    const created = await req(port, 'POST', '/api/product-release/from-build', { bldId: s.version.id, version: VERSION });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const runId = created.json.run.id;
    assert.ok(/^PREL-\d{8}-\d{3}$/.test(runId));
    assert.equal(created.json.run.frozen.remote, 'origin');
    assert.ok(created.json.run.frozen.mainSha);
    assert.ok(created.json.run.frozen.items.length === 1);
    // G4 未预检启动 → 400
    const start0 = await req(port, 'POST', `/api/product-release/run/${runId}/start`);
    assert.equal(start0.status, 400);
    assert.ok(/预检/.test(start0.json.error));
    // 预检 → 通过
    const pre = await req(port, 'POST', `/api/product-release/run/${runId}/precheck`);
    assert.equal(pre.status, 200, JSON.stringify(pre.json));
    assert.equal(pre.json.run.precheck.ok, true, JSON.stringify(pre.json.run.precheck));
    // main 前进 → 启动 stale 400（initData 后工作区在 dev，前进 main 需显式切到 main 提交）
    git(s.proj, 'checkout', 'main');
    commitFile(s.proj, 'advance.txt', 'x\n', 'chore: main advanced after precheck');
    const startStale = await req(port, 'POST', `/api/product-release/run/${runId}/start`);
    assert.equal(startStale.status, 400);
    assert.ok(/main 分支头/.test(startStale.json.error));
    // 重新冻结 + 重新预检 → 启动成功
    const rf = await req(port, 'POST', `/api/product-release/run/${runId}/refreeze`);
    assert.equal(rf.status, 200);
    assert.equal(rf.json.run.frozen.mainSha, git(s.proj, 'rev-parse', 'main'));
    const pre2 = await req(port, 'POST', `/api/product-release/run/${runId}/precheck`);
    assert.equal(pre2.json.run.precheck.ok, true);
    const plan = await req(port, 'GET', `/api/product-release/run/${runId}/plan`);
    assert.equal(plan.status, 200);
    assert.ok(plan.json.plan.frozen.mainSha);
    assert.ok(Array.isArray(plan.json.plan.steps) && plan.json.plan.steps.length >= 1);
    const start = await req(port, 'POST', `/api/product-release/run/${runId}/start`);
    assert.equal(start.status, 200, JSON.stringify(start.json));
    const done = await waitRun(port, runId, (r) => ['succeeded', 'failed', 'canceled'].includes(r.status));
    assert.equal(done.status, 'succeeded', JSON.stringify(done.stages.map((x) => [x.key, x.status, x.error])));
    assert.equal(done.targets.webapp.status, 'done');
    assert.equal(done.targets.site.status, 'done');
    // 远端双分支 = 冻结值
    const ls = git(s.tmp, 'ls-remote', s.remote);
    assert.ok(ls.includes(done.frozen.mainSha));
    assert.ok(ls.includes(done.frozen.devSha));
    // G5 retry 非失败运行 → 400；cancel 幂等
    const retry = await req(port, 'POST', `/api/product-release/run/${runId}/retry`);
    assert.equal(retry.status, 400);
    const c1 = await req(port, 'POST', `/api/product-release/run/${runId}/cancel`);
    assert.equal(c1.status, 200);
    assert.equal(c1.json.run.status, 'succeeded', '已成功运行取消为幂等空操作');
    // 同版本幂等：再创建同版本 → 409 指向既有运行
    const dup = await req(port, 'POST', '/api/product-release/from-build', { bldId: s.version.id, version: VERSION });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.activeRunId, runId);
    // G6 跨项目隔离：projB 看不到 proj 的 PREL
    const stB = await req(port, 'GET', '/api/product-release/state', null, s.projB);
    assert.equal(stB.json.initialized, true);
    assert.equal(stB.json.runs.length, 0);
    const detailB = await req(port, 'GET', `/api/product-release/run/${runId}`, null, s.projB);
    assert.equal(detailB.status, 404);
  } finally {
    server.kill('SIGKILL');
  }
});

t('G2b 官网根目录变更使旧预检失效', async () => {
  const s = mkFixture('cfg');
  const homepage2 = path.join(s.tmp, 'homepage2');
  fs.mkdirSync(homepage2);
  git(homepage2, 'init', '-b', 'main');
  git(homepage2, 'config', 'user.email', 't@e.co');
  git(homepage2, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(homepage2, 'readme.txt'), 'x');
  git(homepage2, 'add', '-A');
  git(homepage2, 'commit', '-m', 'init');
  const port = 36000 + Math.floor(Math.random() * 20000);
  const reg = path.join(s.tmp, 'reg2.json');
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: s.proj,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    await sleep(700);
    await req(port, 'POST', '/api/product-release/config', { homepageRepoRoot: s.homepage });
    const merge = await req(port, 'POST', '/api/build/version/merge', { id: s.version.id });
    assert.equal(merge.status, 200);
    const created = await req(port, 'POST', '/api/product-release/from-build', { bldId: s.version.id, version: VERSION });
    const runId = created.json.run.id;
    const pre = await req(port, 'POST', `/api/product-release/run/${runId}/precheck`);
    assert.equal(pre.json.run.precheck.ok, true);
    // 变更官网根目录 → 启动被 stale 阻塞（官网配置变化）
    await req(port, 'POST', '/api/product-release/config', { homepageRepoRoot: homepage2 });
    const start = await req(port, 'POST', `/api/product-release/run/${runId}/start`);
    assert.equal(start.status, 400);
    assert.ok(/官网/.test(start.json.error));
  } finally {
    server.kill('SIGKILL');
  }
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
console.log(`product-release-serve：${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
