#!/usr/bin/env node
// BUG-20260913-001 版本创建候选范围收窄：仅已完成（done）条目可纳入版本计划。
// 引入来源：REQ-20260913-001（构建模块实现时，候选接口 /api/build/candidates 与前端
// 候选列表均未按状态过滤——非 done 条目只要有关联 commit 即可被勾选纳入版本）。
// 修复口径（README「期望行为 / 验收说明」）：
//   - 候选接口只返回 done 条目（含「添加条目」面板复用同一接口，口径一并收窄）；
//   - 后端创建版本 / 添加条目对非 done 条目拒绝并给出原因（数据口径兜底）；
//   - 前端双重过滤（防御旧缓存 / 混杂数据）+ 无候选空态提示；
//   - 全选仍只纳入有 commit 候选的条目（既有口径不变）。
// 用法：node scripts/tests/bug-build-candidates-done-only-20260913-001.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

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

// 按合法流转把条目推到 done：submitted → accepted → in-progress → done
function markDone(dataDir, id) {
  for (const s of ['accepted', 'in-progress', 'done']) {
    core.setStatus(dataDir, id, s, { by: 'test' });
  }
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 后端（接口口径） ---------- */

t('B1 候选接口只返回 done 条目；非 done（submitted/accepted/in-progress）即使有 commit 也不出现', async () => {
  const h = await setupServer();
  try {
    const r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    assert.equal(r.status, 200);
    const ids = r.json.items.map((x) => x.itemId);
    assert.ok(ids.includes(h.reqDone.id), 'done 需求应出现在候选');
    assert.ok(ids.includes(h.bugDone.id), 'done Bug 应出现在候选');
    assert.ok(!ids.includes(h.reqWip.id), 'submitted 需求不出现');
    assert.ok(!ids.includes(h.bugWip.id), 'in-progress Bug 不出现');
    const done = r.json.items.find((x) => x.itemId === h.reqDone.id);
    assert.ok(done.commits.includes(h.commitDone), 'done 条目保留其 commit 关联');
  } finally {
    await h.close();
  }
});

t('B2 创建版本提交非 done 条目 → 400 并给出原因；done 条目 → 201 成功', async () => {
  const h = await setupServer();
  try {
    const bad = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.reqWip.id, commit: h.commitWip }] });
    assert.equal(bad.status, 400, '非 done 条目创建应拒绝');
    assert.match(bad.json.error || '', new RegExp(h.reqWip.id), '报错应含条目号');
    assert.match(bad.json.error || '', /未完成|done/, '报错应说明未完成原因');
    const ok = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.reqDone.id, commit: h.commitDone }] });
    assert.equal(ok.status, 201, `done 条目创建应成功：${ok.text}`);
    assert.equal(ok.json.version.items[0].itemId, h.reqDone.id);
  } finally {
    await h.close();
  }
});

t('B3 添加条目（action:add）提交非 done 条目 → 400；done 条目 → 200（与新建版本同口径）', async () => {
  const h = await setupServer();
  try {
    const v = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.reqDone.id, commit: h.commitDone }] });
    const vid = v.json.version.id;
    const bad = await req(h.port, 'POST', `/api/build/version/items${h.P}`, { id: vid, action: 'add', items: [{ itemId: h.bugWip.id, commit: h.commitWip }] });
    assert.equal(bad.status, 400, '非 done 条目添加应拒绝');
    assert.match(bad.json.error || '', new RegExp(h.bugWip.id), '报错应含条目号');
    const ok = await req(h.port, 'POST', `/api/build/version/items${h.P}`, { id: vid, action: 'add', items: [{ itemId: h.bugDone.id, commit: h.commitDone2 }] });
    assert.equal(ok.status, 200, `done 条目添加应成功：${ok.text}`);
    assert.deepEqual(ok.json.version.items.map((x) => x.itemId), [h.reqDone.id, h.bugDone.id]);
  } finally {
    await h.close();
  }
});

t('B4 看板无 done 条目时候选为空数组（前端据此呈现空态）', async () => {
  const h = await setupServer({ noneDone: true });
  try {
    const r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items, [], '无 done 条目时候选为空');
  } finally {
    await h.close();
  }
});

/* ---------- 后端测试脚手架 ---------- */

async function setupServer({ noneDone = false } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug20260913-001-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, ['init', '-b', 'main']);
  git(proj, ['config', 'user.email', 't@e.co']);
  git(proj, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);

  const reqDone = core.createItem(dataDir, { type: 'requirement', title: '已完成需求', by: 'test' });
  const bugDone = core.createItem(dataDir, { type: 'bug', title: '已完成缺陷', by: 'test' });
  const reqWip = core.createItem(dataDir, { type: 'requirement', title: '开发中需求', by: 'test' });
  const bugWip = core.createItem(dataDir, { type: 'bug', title: '开发中缺陷', by: 'test' });
  // 每个条目都留有关联 commit（旧缺陷正是一切有 commit 的条目都可被纳入）
  fs.writeFileSync(path.join(proj, 'f1.txt'), `feat ${reqDone.id}\n`);
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', `feat: 已完成需求 ${reqDone.id}`]);
  const commitDone = git(proj, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(proj, 'f2.txt'), `fix ${bugDone.id}\n`);
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', `fix: 已完成缺陷 ${bugDone.id}`]);
  const commitDone2 = git(proj, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(proj, 'f3.txt'), `feat ${reqWip.id}\n`);
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', `feat: 开发中需求 ${reqWip.id}`]);
  const commitWip = git(proj, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(proj, 'f4.txt'), `fix ${bugWip.id}\n`);
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', `fix: 开发中缺陷 ${bugWip.id}`]);

  if (!noneDone) {
    markDone(dataDir, reqDone.id);
    markDone(dataDir, bugDone.id);
  }

  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const hh = await req(port, 'GET', '/api/health');
        if (hh.json && hh.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 33000 + Math.floor(Math.random() * 18000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（已尝试多个端口，最后 ${port}）`);
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); break; } catch {}
  }
  const P = `?project=${encodeURIComponent(proj)}`;
  return {
    port, P,
    reqDone, bugDone, reqWip, bugWip, commitDone, commitDone2, commitWip,
    close: async () => { server.kill('SIGTERM'); await sleep(200); },
  };
}

/* ---------- 前端（vm 行为：双重过滤 + 空态） ---------- */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
  };
}

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

// 混合状态载荷：模拟旧缓存 / 绕过接口的响应，验证前端防御过滤
function mixedCandidates() {
  return {
    items: [
      { itemId: 'REQ-20260913-010', title: '已完成需求', status: 'done', commits: [H1] },
      { itemId: 'REQ-20260913-011', title: '无提交已完成需求', status: 'done', commits: [] },
      { itemId: 'REQ-20260913-012', title: '开发中需求', status: 'in-progress', commits: [H2] },
      { itemId: 'BUG-20260913-013', title: '待接受缺陷', status: 'submitted', commits: [H2] },
    ],
  };
}

function setup({ candidates = mixedCandidates(), versions = [] } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url, opts) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') {
        return { ok: true, json: async () => JSON.parse(JSON.stringify({
          initialized: true, isRepo: true, currentBranch: 'dev', versions,
        })) };
      }
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => JSON.parse(JSON.stringify(candidates)) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

t('F1 新建版本面板：非 done 条目不渲染、不可勾选（前端双重过滤防御）', async () => {
  const h = setup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner, /REQ-20260913-010/, 'done 条目渲染');
  assert.doesNotMatch(inner, /开发中需求/, 'in-progress 条目不渲染');
  assert.doesNotMatch(inner, /待接受缺陷/, 'submitted 条目不渲染');
  assert.doesNotMatch(inner, /REQ-20260913-012|BUG-20260913-013/, '非 done 单号不出现');
  const picked = h.run(`window.ATBBuild.getCandidates().map((x) => x.itemId)`);
  assert.deepEqual(picked, ['REQ-20260913-010', 'REQ-20260913-011'], '候选只剩 done 条目');
});

t('F2 新建版本面板：无 done 候选时给出明确空态，不渲染候选行与全选', async () => {
  const h = setup({ candidates: { items: [
    { itemId: 'REQ-20260913-012', title: '开发中需求', status: 'in-progress', commits: [H2] },
  ] } });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.doesNotMatch(inner, /开发中需求/, '未完成条目不渲染');
  assert.match(inner, /暂无可纳入版本的条目/, '出现明确空态提示');
  assert.doesNotMatch(inner, /id="bldPickAll"/, '空态不渲染「全选」');
  assert.doesNotMatch(inner, /data-pick=/, '空态不渲染候选行');
});

t('F3 添加条目面板：同口径收窄——非 done 不出现，且已在本版本中的条目仍被排除', async () => {
  const versions = [{
    id: 'BLD-20260913-001', name: 'v1.0', description: '', status: 'draft', targetBranch: 'main',
    items: [{ itemId: 'REQ-20260913-010', commit: H1, title: '已完成需求', mergedAt: null, mergeError: null }],
    createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
  }];
  const h = setup({ versions });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('versions')`);
  await h.run(`window.ATBBuild.openAddPanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const panel = inner.match(/<aside class="rel-panel"[^>]*aria-label="添加条目">[\s\S]*?<\/aside>/);
  assert.ok(panel, '添加条目面板应渲染');
  assert.doesNotMatch(panel[0], /开发中需求|待接受缺陷/, '非 done 条目不出现');
  assert.doesNotMatch(panel[0], /REQ-20260913-010/, '已在本版本中的条目仍不出现');
  assert.match(panel[0], /无提交已完成需求/, 'done 且不在本版本的条目出现');
});

t('F4 全选口径回归：全选仍只纳入有 commit 候选的 done 条目，无提交条目跳过', async () => {
  const h = setup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const selectable = h.run(`window.ATBBuild.selectableCandidates(window.ATBBuild.getCandidates())`);
  assert.deepEqual(selectable.map((x) => x.itemId), ['REQ-20260913-010'], '全选口径=done 且有 commit');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
