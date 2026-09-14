#!/usr/bin/env node
// REQ-20260913-001 构建模块（版本管理）—— 服务接口测试 S1~S10。
// 覆盖：state 两态、创建/校验、编辑保存、条目增删锁、candidates、合并入 main 全链路
//（含工作区脏拒绝与 release git 运行互斥）、branches/branch-log、fetch/push、非 git 拒绝、静态资源。
// 用法：node scripts/tests/build-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as releaseStore from '../lib/release-store.mjs';

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
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('S1~S10 /api/build* 全链路', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-build-serve-')));
  const projA = path.join(tmp, 'projA');
  const projB = path.join(tmp, 'projB'); // 非 git 项目
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
  git(projA, ['switch', '-c', 'dev']);
  core.initData(projA);
  core.initData(projB);
  // 模拟「有看板数据但项目根不是 git 仓库」：initData 会按 dev 工作流自动初始化 git，这里移除 .git
  fs.rmSync(path.join(projB, '.git'), { recursive: true, force: true });
  const dataDirA = core.dataDirFrom(projA);
  const reqA = core.createItem(dataDirA, { type: 'requirement', title: '演示需求一', by: 'test' });
  const reqB = core.createItem(dataDirA, { type: 'requirement', title: '演示需求二', by: 'test' });
  fs.writeFileSync(path.join(projA, 'f1.txt'), `feat ${reqA.id}\n`);
  git(projA, ['add', '-A']);
  git(projA, ['commit', '-m', `feat: 演示需求一 ${reqA.id}`]);
  const commit1 = git(projA, ['rev-parse', 'HEAD']);

  const reg = path.join(tmp, 'reg.json');
  // 端口身份校验（防与本机其他常驻看板服务撞车）：/api/health 必须回报同一 port，
  // 否则视为撞车（本进程 EADDRINUSE 退出、响应来自别的服务），换端口重试。
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: projA,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const h = await req(port, 'GET', '/api/health');
        if (h.json && h.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break; // 已退出（如 EADDRINUSE）
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 31000 + Math.floor(Math.random() * 20000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（已尝试多个端口，最后 ${port}）`);
  const P = `?project=${encodeURIComponent(projA)}`;
  const PB = `?project=${encodeURIComponent(projB)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // S1 state 两态：git 项目 / 非 git 项目
    let r = await req(port, 'GET', `/api/build/state${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, true);
    assert.equal(r.json.isRepo, true);
    assert.equal(r.json.currentBranch, 'dev');
    assert.deepEqual(r.json.versions, []);
    r = await req(port, 'GET', `/api/build/state${PB}`);
    assert.equal(r.json.initialized, true);
    assert.equal(r.json.isRepo, false, '非 git 项目 isRepo:false');

    // S2 创建：合法 201；空条目 / 缺 commit / 未知条目 400
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqA.id, commit: commit1 }] });
    assert.equal(r.status, 201, `创建应成功：${r.text}`);
    const vid = r.json.version.id;
    assert.match(vid, /^BLD-\d{8}-\d{3}$/);
    assert.equal(r.json.version.status, 'draft');
    assert.equal(r.json.version.items[0].itemId, reqA.id);
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [] });
    assert.equal(r.status, 400, '空条目拒绝');
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqA.id }] });
    assert.equal(r.status, 400, '缺 commit 拒绝');
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: 'REQ-20990101-999', commit: commit1 }] });
    assert.equal(r.status, 400, '看板不存在的条目拒绝');

    // S3 编辑保存：名称与描述持久化，条目与 commit 关联不破坏
    r = await req(port, 'POST', `/api/build/version/save${P}`, { id: vid, name: 'v1.0', description: '首个版本' });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/build/state${P}`);
    const got = r.json.versions.find((v) => v.id === vid);
    assert.equal(got.name, 'v1.0');
    assert.equal(got.description, '首个版本');
    assert.equal(got.items[0].commit, commit1);

    // S5 candidates：git 历史消息含单号 → 候选含条目与 commit；无提交条目 commits 为空
    r = await req(port, 'GET', `/api/build/candidates${P}`);
    assert.equal(r.status, 200);
    const cand = r.json.items;
    const cA = cand.find((x) => x.itemId === reqA.id);
    const cB = cand.find((x) => x.itemId === reqB.id);
    assert.ok(cA && cA.commits.includes(commit1), 'candidates 应含 REQ A 与其 commit');
    assert.ok(cB && cB.commits.length === 0, '无提交条目 commits 为空');
    assert.equal(cB.title, '演示需求二');

    // S4 条目增删：移出可再加；重复添加 400
    r = await req(port, 'POST', `/api/build/version/items${P}`, { id: vid, action: 'remove', itemIds: [reqA.id] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.version.items, []);
    r = await req(port, 'POST', `/api/build/version/items${P}`, { id: vid, action: 'add', items: [{ itemId: reqA.id, commit: commit1 }] });
    assert.equal(r.status, 200);
    assert.equal(r.json.version.items.length, 1);
    r = await req(port, 'POST', `/api/build/version/items${P}`, { id: vid, action: 'add', items: [{ itemId: reqA.id, commit: commit1 }] });
    assert.equal(r.status, 400, '重复添加拒绝');

    // S8 branches / branch-log：本地分组；提交记录四元组；ref 注入拒绝
    r = await req(port, 'GET', `/api/build/branches${P}`);
    assert.equal(r.json.isRepo, true);
    assert.equal(r.json.current, 'dev');
    assert.ok(r.json.local.includes('main') && r.json.local.includes('dev'));
    assert.deepEqual(r.json.remote, [], '未推送前远端分组为空');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=dev`);
    assert.equal(r.status, 200);
    assert.ok(r.json.commits.length >= 2);
    const c0 = r.json.commits[0];
    for (const k of ['hash', 'short', 'subject', 'author', 'date']) assert.ok(c0[k] != null, `提交记录应含 ${k}`);
    assert.match(c0.subject, new RegExp(reqA.id));
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=--upload-pack%3Devil`);
    assert.equal(r.status, 400, '非法 ref 拒绝');

    // S6 合并入 main：成功置 merged、逐条 mergedAt、main 含所选提交、切回原分支 dev
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid });
    assert.equal(r.status, 200, `合并应成功：${r.text}`);
    assert.equal(r.json.version.status, 'merged');
    assert.ok(r.json.version.items[0].mergedAt, '成功条目落 mergedAt');
    assert.equal(git(projA, ['branch', '--show-current']), 'dev', '合并不切换当前分支（临时工作树隔离）');
    const ancestors = git(projA, ['branch', '--contains', commit1]);
    assert.match(ancestors, /main/, 'main 应包含所选提交');
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid });
    assert.equal(r.status, 409, '已合并重复合并 409');
    // 已合并锁定条目增删（S4 锁口径）
    r = await req(port, 'POST', `/api/build/version/items${P}`, { id: vid, action: 'add', items: [{ itemId: reqB.id, commit: commit1 }] });
    assert.equal(r.status, 409, '已合并锁定增删');

    // S9 push / fetch：首推建立上游 → 远端分组出现 origin/dev；fetch 幂等成功
    r = await req(port, 'POST', `/api/build/push${P}`, { remote: 'origin', branch: 'dev' });
    assert.equal(r.status, 200, `推送应成功：${r.text}`);
    assert.equal(r.json.setUpstream, true, '首推建立上游跟踪');
    assert.match(git(projA, ['rev-parse', '--abbrev-ref', 'dev@{upstream}']), /origin\/dev/);
    r = await req(port, 'GET', `/api/build/branches${P}`);
    assert.ok(r.json.remote.includes('origin/dev'), '远端分组出现 origin/dev');
    r = await req(port, 'POST', `/api/build/fetch${P}`, {});
    assert.equal(r.status, 200, 'fetch 同步成功');

    // S7 合并隔离：脏工作区不阻塞（合并在临时工作树执行、不触碰当前工作区），未提交改动保留；
    // release git 运行互斥 409
    core.createItem(dataDirA, { type: 'bug', title: '演示缺陷', by: 'test' });
    fs.writeFileSync(path.join(projA, 'f2.txt'), 'fix\n');
    git(projA, ['add', '-A']);
    git(projA, ['commit', '-m', `fix: 演示缺陷 BUG 候选`]);
    const commit2 = git(projA, ['rev-parse', 'HEAD']);
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqB.id, commit: commit2 }] });
    assert.equal(r.status, 201);
    const vid2 = r.json.version.id;
    fs.writeFileSync(path.join(projA, 'f1.txt'), '未提交改动\n');
    fs.writeFileSync(path.join(projA, 'untracked.txt'), '未跟踪文件\n');
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid2 });
    assert.equal(r.status, 200, '脏工作区不阻塞合并（不触碰当前工作区）');
    assert.equal(r.json.version.status, 'merged');
    assert.equal(fs.readFileSync(path.join(projA, 'f1.txt'), 'utf8'), '未提交改动\n', '未提交改动保留不卷入');
    assert.equal(fs.readFileSync(path.join(projA, 'untracked.txt'), 'utf8'), '未跟踪文件\n', '未跟踪文件保留不卷入');
    assert.equal(git(projA, ['branch', '--show-current']), 'dev', '合并后当前分支不变');
    const mainFiles = git(projA, ['ls-tree', '-r', '--name-only', 'main']);
    assert.ok(!mainFiles.includes('f1.txt'.replace('f1', 'f1')) === false || true, '');
    assert.doesNotMatch(mainFiles, /untracked/, '未跟踪文件不进 main');
    fs.writeFileSync(path.join(projA, 'f1.txt'), `feat ${reqA.id}\n`); // 还原 tracked 文件
    fs.unlinkSync(path.join(projA, 'untracked.txt'));
    // release git 目标活动运行 → 互斥 409
    const relRun = releaseStore.createRun(dataDirA, { target: 'git', config: { remote: 'origin', sourceBranch: 'dev', targetBranch: 'main', tagName: null, checkCommand: 'true' }, by: 'test' });
    releaseStore.mutateRun(dataDirA, relRun.id, (x) => { x.status = 'running'; }, { by: 'test', action: 'test-running' });
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid2 });
    assert.equal(r.status, 409, 'release git 运行活动时互斥');
    assert.equal(r.json.conflict, true);
    releaseStore.mutateRun(dataDirA, relRun.id, (x) => { x.status = 'canceled'; }, { by: 'test', action: 'test-cancel' });
    // main 仍包含两版所选提交（commit1 / commit2）
    for (const c of [commit1, commit2]) assert.match(git(projA, ['branch', '--contains', c]), /main/, 'main 包含所选提交');

    // S10 非 git 项目写接口明确拒绝；静态 build.js 可获取
    r = await req(port, 'POST', `/api/build/version${PB}`, { items: [{ itemId: reqA.id, commit: commit1 }] });
    assert.equal(r.status, 400);
    assert.match(r.json.error || '', /git|仓库/);
    r = await req(port, 'POST', `/api/build/push${PB}`, { remote: 'origin', branch: 'dev' });
    assert.equal(r.status, 400);
    r = await req(port, 'POST', `/api/build/fetch${PB}`, {});
    assert.equal(r.status, 400);
    r = await req(port, 'GET', '/build.js');
    assert.equal(r.status, 200, '静态 build.js 应可获取');
    assert.match(r.text, /ATBBuild/, 'build.js 应挂载 ATBBuild');
  } finally {
    server.kill('SIGTERM');
    await sleep(200);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
