#!/usr/bin/env node
// BUG-20260914-004 已纳入版本的条目不应再出现在其他版本的关联列表或新建版本的关联列表中。
// 引入来源：REQ-20260913-001（构建模块「版本计划」实现时，候选接口 /api/build/candidates 只按
// done 收窄（BUG-20260913-001），始终缺「已被任一版本占用」维度；数据层 normalizeItems 去重也只
// 针对同一版本内，跨版本重复一律放行——同一条目及其 commit 可同时挂在多个版本计划上）。
// 修复口径（README「期望行为 / 验收说明」）：
//   - 候选接口在数据源头收窄：已纳入任一版本（draft/merging/merged/failed 任一状态）的条目
//     不再进入候选；响应附带 totalDone（占用过滤前 done 条目总数）供前端区分空态；
//   - 前端新建 / 添加两面板再过滤一次（防御旧缓存 / 混杂数据），空态区分
//     「无 done 条目」与「done 条目均已被版本占用」两种文案；
//   - 服务端兜底：创建版本 / 添加条目对跨版本重复纳入明确拒绝，报错含占用版本编号；
//   - 占用释放：从 draft/failed 版本移出、或删除版本后，条目重新回到候选；
//   - 不回归：done-only 口径（BUG-20260913-001）、全选即时生效（BUG-20260914-002）、
//     无提交条目禁用跳过、加载 / 失败重试状态不受影响。
// 用法：node scripts/tests/bug-build-candidate-occupied-20260914-004.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';

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

t('B1 候选接口在源头排除已占用条目：纳入版本 A 后不再出现，未占用 done 条目照常；响应附带 totalDone', async () => {
  const h = await setupServer();
  try {
    const v = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.A.id, commit: h.cA }] });
    assert.equal(v.status, 201, `创建版本应成功：${v.text}`);
    const r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    assert.equal(r.status, 200);
    const ids = r.json.items.map((x) => x.itemId);
    assert.ok(!ids.includes(h.A.id), '已纳入版本的条目不应再出现在候选');
    assert.ok(ids.includes(h.E.id) && ids.includes(h.F.id), '未占用 done 条目照常出现');
    assert.equal(r.json.totalDone, 6, 'totalDone 为占用过滤前的 done 条目总数');
    const e = r.json.items.find((x) => x.itemId === h.E.id);
    assert.ok(e.commits.includes(h.cE), '未占用条目保留 commit 关联');
  } finally {
    await h.close();
  }
});

t('B2 占用判定覆盖四种版本状态：draft / merging / merged / failed 中的条目均不出现在候选', async () => {
  const h = await setupServer();
  try {
    const mk = async (item, commit) => {
      const r = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: item.id, commit }] });
      assert.equal(r.status, 201, `创建应成功：${r.text}`);
      return r.json.version.id;
    };
    const vDraft = await mk(h.A, h.cA); // 保持 draft
    const vMerging = await mk(h.B, h.cB);
    const vMerged = await mk(h.C, h.cC);
    const vFailed = await mk(h.D, h.cD);
    // 直接经数据层落盘状态（merging / merged / failed），不触发 /state（避免 recoverMerging 干扰）
    buildStore.beginMerge(h.dataDir, vMerging);
    buildStore.beginMerge(h.dataDir, vMerged);
    buildStore.finishMerge(h.dataDir, vMerged, { results: [{ itemId: h.C.id, ok: true }] });
    buildStore.beginMerge(h.dataDir, vFailed);
    buildStore.finishMerge(h.dataDir, vFailed, { results: [{ itemId: h.D.id, ok: false, error: '模拟失败' }] });
    assert.ok([vDraft, vMerging, vMerged, vFailed].every((x) => /^BLD-\d{8}-\d{3}$/.test(x)));
    const r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    const ids = r.json.items.map((x) => x.itemId);
    for (const it of [h.A, h.B, h.C, h.D]) {
      assert.ok(!ids.includes(it.id), `${it.id} 已被占用（任一状态）不应出现在候选`);
    }
    assert.ok(ids.includes(h.E.id) && ids.includes(h.F.id), '未占用条目照常出现');
    assert.equal(r.json.totalDone, 6);
  } finally {
    await h.close();
  }
});

t('B3 服务端兜底（创建）：绕过前端重复纳入已占用条目 → 400，报错含条目号与占用版本编号', async () => {
  const h = await setupServer();
  try {
    const v = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.A.id, commit: h.cA }] });
    const vid = v.json.version.id;
    const bad = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.A.id, commit: h.cA }, { itemId: h.E.id, commit: h.cE }] });
    assert.equal(bad.status, 400, '跨版本重复纳入应被拒绝');
    assert.match(bad.json.error || '', new RegExp(h.A.id), '报错应含条目号');
    assert.match(bad.json.error || '', new RegExp(vid), '报错应含占用版本编号');
    assert.match(bad.json.error || '', /已纳入版本/, '报错说明不可重复纳入');
    // 未占用条目单独创建仍成功
    const ok = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.E.id, commit: h.cE }] });
    assert.equal(ok.status, 201, `未占用条目创建应成功：${ok.text}`);
  } finally {
    await h.close();
  }
});

t('B4 服务端兜底（添加）：其他版本占用条目 → 400 含占用版本编号；本版本已有条目仍走「已在本版本中」口径；未占用条目成功', async () => {
  const h = await setupServer();
  try {
    const va = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.A.id, commit: h.cA }] });
    const vb = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.E.id, commit: h.cE }] });
    const idB = vb.json.version.id;
    const bad = await req(h.port, 'POST', `/api/build/version/items${h.P}`, { id: idB, action: 'add', items: [{ itemId: h.A.id, commit: h.cA }] });
    assert.equal(bad.status, 400, '添加其他版本占用条目应拒绝');
    assert.match(bad.json.error || '', new RegExp(h.A.id), '报错应含条目号');
    assert.match(bad.json.error || '', new RegExp(va.json.version.id), '报错应含占用版本编号');
    const self = await req(h.port, 'POST', `/api/build/version/items${h.P}`, { id: idB, action: 'add', items: [{ itemId: h.E.id, commit: h.cE }] });
    assert.equal(self.status, 400, '重复添加本版本条目仍拒绝');
    assert.match(self.json.error || '', /已在本版本中/, '保留既有「已在本版本中」报错口径');
    const ok = await req(h.port, 'POST', `/api/build/version/items${h.P}`, { id: idB, action: 'add', items: [{ itemId: h.F.id, commit: h.cF }] });
    assert.equal(ok.status, 200, `未占用条目添加应成功：${ok.text}`);
  } finally {
    await h.close();
  }
});

t('B5 占用释放：draft 版本移出后回到候选；删除版本后同理', async () => {
  const h = await setupServer();
  try {
    const va = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.A.id, commit: h.cA }] });
    const vb = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.E.id, commit: h.cE }] });
    let r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    assert.ok(!r.json.items.some((x) => x.itemId === h.A.id), '前置：A 已被占用');
    // draft 允许移出 → 释放
    const rm = await req(h.port, 'POST', `/api/build/version/items${h.P}`, { id: va.json.version.id, action: 'remove', itemIds: [h.A.id] });
    assert.equal(rm.status, 200, `移出应成功：${rm.text}`);
    r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    assert.ok(r.json.items.some((x) => x.itemId === h.A.id), '移出后 A 重新回到候选');
    assert.ok(!r.json.items.some((x) => x.itemId === h.E.id), '前置：E 仍被版本 B 占用');
    // 删除版本（draft）→ 释放
    const del = await req(h.port, 'POST', `/api/build/version/delete${h.P}`, { id: vb.json.version.id });
    assert.equal(del.status, 200, `删除应成功：${del.text}`);
    r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    assert.ok(r.json.items.some((x) => x.itemId === h.E.id), '删除版本后 E 重新回到候选');
  } finally {
    await h.close();
  }
});

t('B6 无 done 条目时：items 为空且 totalDone 为 0（前端据此呈现「无 done 条目」空态）', async () => {
  const h = await setupServer({ noneDone: true });
  try {
    const r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items, []);
    assert.equal(r.json.totalDone, 0);
  } finally {
    await h.close();
  }
});

/* ---------- 数据层直调（占用校验落在 build-store，供所有调用方同口径） ---------- */

t('D1 数据层：createVersion / addItems 跨版本重复纳入 → AtbError 含占用版本编号；移出 / 删除后释放可再纳入', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug20260914-004-d-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const X = 'REQ-20260913-001';
  const Y = 'BUG-20260913-002';
  const H1 = 'a'.repeat(40);
  const H2 = 'b'.repeat(40);
  const v1 = buildStore.createVersion(dataDir, { items: [{ itemId: X, commit: H1 }] });
  assert.throws(
    () => buildStore.createVersion(dataDir, { items: [{ itemId: X, commit: H1 }] }),
    (e) => e instanceof core.AtbError && e.message.includes(X) && e.message.includes(v1.id) && e.message.includes('已纳入版本'),
    '跨版本重复创建应拒绝并含占用版本编号',
  );
  const v2 = buildStore.createVersion(dataDir, { items: [{ itemId: Y, commit: H2 }] });
  assert.throws(
    () => buildStore.addItems(dataDir, v2.id, [{ itemId: X, commit: H1 }]),
    (e) => e instanceof core.AtbError && e.message.includes(v1.id),
    '跨版本重复添加应拒绝并含占用版本编号',
  );
  assert.throws(
    () => buildStore.addItems(dataDir, v2.id, [{ itemId: Y, commit: H2 }]),
    (e) => e instanceof core.AtbError && e.message.includes('已在本版本中'),
    '本版本内重复仍走既有口径',
  );
  // 释放：移出 v1 后可纳入 v2
  buildStore.removeItems(dataDir, v1.id, [X]);
  buildStore.addItems(dataDir, v2.id, [{ itemId: X, commit: H1 }]);
  // 释放：删除 v2 后可重新创建
  buildStore.deleteVersion(dataDir, v2.id);
  const v3 = buildStore.createVersion(dataDir, { items: [{ itemId: X, commit: H1 }] });
  assert.ok(v3.id, '删除版本后条目可重新纳入新版本');
  // occupiedItemMap：占用索引覆盖全部条目并指向所在版本
  const map = buildStore.occupiedItemMap(dataDir);
  assert.equal(map.get(X), v3.id);
  assert.equal(map.get(Y), undefined, 'Y 随 v2 删除后不再占用');
});

/* ---------- 后端测试脚手架 ---------- */

async function setupServer({ noneDone = false } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug20260914-004-')));
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

  const mkItem = (type, title) => core.createItem(dataDir, { type, title, by: 'test' });
  const A = mkItem('requirement', '需求A');
  const B = mkItem('bug', '缺陷B');
  const C = mkItem('requirement', '需求C');
  const D = mkItem('bug', '缺陷D');
  const E = mkItem('requirement', '需求E');
  const F = mkItem('bug', '缺陷F');
  // 每个条目各留一次关联提交（候选需要 commit 关联）
  const commitFor = (item, file) => {
    fs.writeFileSync(path.join(proj, file), `feat ${item.id}\n`);
    git(proj, ['add', '-A']);
    git(proj, ['commit', '-m', `feat: ${item.id}`]);
    return git(proj, ['rev-parse', 'HEAD']);
  };
  const cA = commitFor(A, 'f1.txt');
  const cB = commitFor(B, 'f2.txt');
  const cC = commitFor(C, 'f3.txt');
  const cD = commitFor(D, 'f4.txt');
  const cE = commitFor(E, 'f5.txt');
  const cF = commitFor(F, 'f6.txt');

  if (!noneDone) {
    for (const it of [A, B, C, D, E, F]) markDone(dataDir, it.id);
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
    port = 34000 + Math.floor(Math.random() * 16000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（已尝试多个端口，最后 ${port}）`);
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); break; } catch {}
  }
  const P = `?project=${encodeURIComponent(proj)}`;
  return {
    port, P, dataDir, A, B, C, D, E, F, cA, cB, cC, cD, cE, cF,
    close: async () => { server.kill('SIGTERM'); await sleep(200); },
  };
}

/* ---------- 前端（vm 行为：防御过滤 + 空态区分） ---------- */

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

const ver = (id, items) => ({
  id, name: id, description: '', status: 'draft', targetBranch: 'main', items,
  createdAt: '2026-09-14T01:00:00.000Z', updatedAt: '2026-09-14T02:00:00.000Z',
  merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
});
const verItem = (itemId, title) => ({ itemId, commit: H1, title, mergedAt: null, mergeError: null });

// 混合载荷：模拟旧缓存 / 绕过接口的响应（含已占用与非 done 条目），验证前端防御过滤
function mixedCandidates() {
  return {
    totalDone: 4,
    items: [
      { itemId: 'REQ-20260914-010', title: '已被版本占用需求', status: 'done', commits: [H1] },
      { itemId: 'BUG-20260914-011', title: '未占用需求', status: 'done', commits: [H2] },
      { itemId: 'REQ-20260914-012', title: '未占用无提交需求', status: 'done', commits: [] },
      { itemId: 'BUG-20260914-013', title: '开发中需求', status: 'in-progress', commits: [H2] },
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

t('F1 新建版本面板：已占用条目不渲染、不可勾选（前端防御过滤）；未占用 done 条目照常', async () => {
  const versions = [ver('BLD-20260914-001', [verItem('REQ-20260914-010', '已被版本占用需求')])];
  const h = setup({ versions });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  // 断言收窄到面板本身：已占用条目仍会出现在左侧版本详情（其所在版本），那不是候选列表
  const panel = inner.match(/<aside class="rel-panel"[^>]*aria-label="新建版本">[\s\S]*?<\/aside>/);
  assert.ok(panel, '新建版本面板应渲染');
  assert.match(panel[0], /未占用需求/, '未占用 done 条目渲染');
  assert.match(panel[0], /暂无关联提交/, '未占用无提交条目仍列出并标注');
  assert.doesNotMatch(panel[0], /已被版本占用需求/, '已占用条目不渲染');
  assert.doesNotMatch(panel[0], /REQ-20260914-010/, '已占用条目单号不出现');
  assert.doesNotMatch(panel[0], /开发中需求/, '非 done 条目不渲染（既有防御不回归）');
  const picked = h.run(`window.ATBBuild.getCandidates().map((x) => x.itemId)`);
  assert.deepEqual(picked, ['BUG-20260914-011', 'REQ-20260914-012'], '候选只剩未占用 done 条目');
});

t('F2 添加条目面板：其他版本占用条目不出现；本版本已有条目仍被排除；未占用条目出现', async () => {
  const versions = [
    ver('BLD-20260914-001', [verItem('REQ-20260914-010', '已被版本占用需求')]), // 选中版本（列表最新）
    ver('BLD-20260914-002', [verItem('BUG-20260914-014', '他版本占用条目')]),
  ];
  // 候选载荷再混入他版本条目 014（模拟旧缓存），验证防御过滤
  const candidates = {
    totalDone: 5,
    items: [
      ...mixedCandidates().items,
      { itemId: 'BUG-20260914-014', title: '他版本占用条目', status: 'done', commits: [H1] },
    ],
  };
  const h = setup({ candidates, versions });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('versions')`);
  await h.run(`window.ATBBuild.openAddPanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const panel = inner.match(/<aside class="rel-panel"[^>]*aria-label="添加条目">[\s\S]*?<\/aside>/);
  assert.ok(panel, '添加条目面板应渲染');
  assert.match(panel[0], /未占用需求/, '未占用 done 条目出现');
  assert.doesNotMatch(panel[0], /REQ-20260914-010/, '本版本已有条目仍不出现（既有排除不回归）');
  assert.doesNotMatch(panel[0], /BUG-20260914-014/, '其他版本占用条目不出现');
});

t('F3 空态区分：done 条目均已被占用与无 done 条目两种文案', async () => {
  const occupied = [ver('BLD-20260914-001', [verItem('REQ-20260914-010', 'x')])];
  const h1 = setup({ candidates: { items: [], totalDone: 2 }, versions: occupied });
  await h1.run(`window.ATBBuild.enter('/p/a')`);
  await h1.run(`window.ATBBuild.openCreatePanel()`);
  const inner1 = h1.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner1, /均已纳入版本计划/, 'totalDone>0 时给出「均已被占用」空态');
  assert.doesNotMatch(inner1, /暂无可纳入版本的条目/, '不与「无 done 条目」文案混用');

  const h2 = setup({ candidates: { items: [], totalDone: 0 }, versions: [] });
  await h2.run(`window.ATBBuild.enter('/p/a')`);
  await h2.run(`window.ATBBuild.openCreatePanel()`);
  const inner2 = h2.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner2, /暂无可纳入版本的条目/, 'totalDone=0 时保留「无 done 条目」空态');

  // 防御：旧响应缺 totalDone 字段时回落到「无 done 条目」文案
  const h3 = setup({ candidates: { items: [] }, versions: [] });
  await h3.run(`window.ATBBuild.enter('/p/a')`);
  await h3.run(`window.ATBBuild.openCreatePanel()`);
  const inner3 = h3.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner3, /暂无可纳入版本的条目/, '缺 totalDone 时回落既有文案');
});

t('F4 全选口径回归：候选内未占用 done 条目，全选仍只纳入有 commit 候选者', async () => {
  const versions = [ver('BLD-20260914-001', [verItem('REQ-20260914-010', '已被版本占用需求')])];
  const h = setup({ versions });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const selectable = h.run(`window.ATBBuild.selectableCandidates(window.ATBBuild.getCandidates())`);
  assert.deepEqual(selectable.map((x) => x.itemId), ['BUG-20260914-011'], '全选口径=未占用 done 且有 commit');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
