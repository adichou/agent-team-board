#!/usr/bin/env node
// REQ-20260921-015 「合并入 main」页：去掉隔离分析红色长文 + 一键加入所有依赖提交。
// 后端（B*）：POST /api/build/version/add-dependencies —— 服务端现算隔离分析、按
// itemCommitStatusIndex 反查归属、沿用 addItems 校验与 scopeStale 联动；跳过项有清单不静默。
// 前端（F*）：合并页简洁隔离分析（一行汇总 + 明细 details + 单行状态条）与一键加入交互。
// 静态（S*）：renderMergePane 不再输出红色长文（仅读取失败态保留）；mergeBlockReason 增补
// blocked 档；i18n 新词条中英同步。
// 用法：node scripts/tests/req-20260921-015.test.mjs

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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ================= 后端：POST /api/build/version/add-dependencies ================= */

// 场景仓库脚手架：main(init) → dev 分支；prepare(ctx) 在服务启动前自定条目 / 提交 / 数据层版本。
async function setupServer(prepare) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req20260921-015-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, ['init', '-b', 'main']);
  git(proj, ['config', 'user.email', 't@e.co']);
  git(proj, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base\n');
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', 'init']);
  core.initData(proj); // 内部 ensureDevWorkflow：按需创建 dev 并切到 dev
  const dataDir = core.dataDirFrom(proj);
  git(proj, ['switch', 'dev']);
  const ctx = {
    proj, dataDir,
    mkItem: (type, title) => core.createItem(dataDir, { type, title, by: 'test' }),
    markDone: (id) => { for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, id, s, { by: 'test' }); },
    commit: (file, subject) => {
      fs.writeFileSync(path.join(proj, file), `${subject}\n`);
      git(proj, ['add', '-A']);
      git(proj, ['commit', '-m', subject]);
      return git(proj, ['rev-parse', 'HEAD']);
    },
    createVersion: (items, name = '测试版本') => buildStore.createVersion(dataDir, { name, items }),
  };
  const ids = prepare ? (await prepare(ctx)) : {};
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
  assert.ok(server, `服务应启动（最后端口 ${port}）`);
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); break; } catch {}
  }
  return {
    port, dataDir, proj, ...ids,
    P: `?project=${encodeURIComponent(proj)}`,
    close: async () => { server.kill('SIGTERM'); await sleep(200); },
  };
}

t('B1 一键加入：依赖条目与最新提交进版本、隔离分析收敛为无未选祖先、scopeStale 联动', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '依赖需求A');
    const B = c.mkItem('requirement', '所选需求B');
    c.markDone(A.id);
    c.markDone(B.id);
    const cA = c.commit('a.txt', `feat: A ${A.id}`);
    const cB = c.commit('b.txt', `feat: B ${B.id}`);
    return { A, B, cA, cB };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.B.id, commit: h.cB }] });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const vid = created.json.version.id;
    // 前置：隔离分析发现未选祖先（A 的提交）
    let plan = await req(h.port, 'GET', `/api/build/publish-plan${h.P}&id=${encodeURIComponent(vid)}`);
    assert.ok((plan.json.mergeAnalysis.perItem || []).some((x) => (x.intermediates || []).length >= 1), '前置：应存在未选祖先');
    // 预置文档提交记录（验证 markDocsScopeStale 联动）
    buildStore.recordDocsCommit(h.dataDir, vid, { commitHash: 'e'.repeat(40), files: { 'README.md': 'f'.repeat(64) }, scopeFp: 'x' });
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 200, `一键加入应成功：${r.text}`);
    assert.deepEqual((r.json.added || []).map((x) => ({ itemId: x.itemId, commit: x.commit })), [{ itemId: h.A.id, commit: h.cA }], '依赖条目按其最新（唯一）提交纳入');
    assert.deepEqual(r.json.skipped, [], '本场景无跳过项');
    assert.ok(r.json.version.items.some((x) => x.itemId === h.A.id && x.commit === h.cA), '返回版本含新入条目');
    assert.equal(r.json.version.docs.scopeStale, true, '加入后发布范围变化（scopeStale 联动）');
    assert.match(r.json.version.docs.staleReason || '', /新增关联条目/, 'scopeStale 原因含新增条目来源');
    // 隔离分析收敛：重求值后无未选祖先
    plan = await req(h.port, 'GET', `/api/build/publish-plan${h.P}&id=${encodeURIComponent(vid)}`);
    const per = plan.json.mergeAnalysis.perItem || [];
    assert.ok(per.every((x) => (x.intermediates || []).length === 0), `加入后应无未选祖先，实际：${JSON.stringify(per)}`);
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === vid);
    assert.equal(version.items.length, 2, '版本关联 2 条（B + 新入 A）');
  } finally {
    await h.close();
  }
});

t('B2 归因与校验：无归属 / 未 done / 被占用 / 已在本版本跳过并给原因；可归属取最新提交', async () => {
  const h = await setupServer((c) => {
    const B = c.mkItem('requirement', '所选需求B');
    const C = c.mkItem('requirement', '未完成依赖C');
    const D = c.mkItem('requirement', '被占用依赖D');
    const E = c.mkItem('bug', '双提交依赖E');
    const F = c.mkItem('bug', '早提交依赖F');
    for (const it of [B, D, E, F]) c.markDone(it.id); // C 保持未完成
    const cU = c.commit('u.txt', 'chore: 无单号提交');
    const cC = c.commit('c.txt', `feat: C ${C.id}`);
    const cD = c.commit('d.txt', `feat: D ${D.id}`);
    const cE1 = c.commit('e1.txt', `feat: E1 ${E.id}`);
    const cE2 = c.commit('e2.txt', `feat: E2 ${E.id}`);
    const cF0 = c.commit('f0.txt', `feat: F0 ${F.id}`);
    const cF1 = c.commit('f1.txt', `feat: F1 ${F.id}`);
    const cB = c.commit('b.txt', `feat: B ${B.id}`);
    const occ = c.createVersion([{ itemId: D.id, commit: cD }], '占用版本');
    return { B, C, D, E, F, cU, cC, cD, cE1, cE2, cF0, cF1, cB, occId: occ.id };
  });
  try {
    // 主版本：B@所选 + F@cF1（cF0 为其未选祖先 → 归属条目已在本版本）
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, {
      items: [{ itemId: h.B.id, commit: h.cB }, { itemId: h.F.id, commit: h.cF1 }],
    });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const vid = created.json.version.id;
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 200, `一键加入应成功：${r.text}`);
    assert.deepEqual((r.json.added || []).map((x) => ({ itemId: x.itemId, commit: x.commit })), [{ itemId: h.E.id, commit: h.cE2 }], '可归属依赖取该条目最新提交纳入');
    const skipped = r.json.skipped || [];
    const byReason = (re) => skipped.filter((s) => re.test(s.reason || ''));
    assert.equal(byReason(/无法归属/).length, 1, '无单号提交以「无法归属」跳过');
    assert.equal(byReason(/无法归属/)[0].commit, h.cU, '跳过清单含 commit');
    assert.equal(byReason(/尚未完成/).length, 1, '未 done 条目以「尚未完成」跳过');
    assert.ok(byReason(/尚未完成/)[0].reason.includes(h.C.id), '跳过原因含条目号');
    assert.equal(byReason(/已纳入版本/).length, 1, '被占用条目以「已纳入版本」跳过');
    assert.ok(byReason(/已纳入版本/)[0].reason.includes(h.occId), '跳过原因含占用版本号');
    assert.equal(byReason(/已在本版本/).length, 1, '归属条目已在本版本以「已在本版本」跳过');
    assert.equal(byReason(/已在本版本/)[0].commit, h.cF0, '早提交依赖不覆盖本版本既有 commit 关联');
    // 版本数据：E 已纳入，其余不动
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === vid);
    assert.ok(version.items.some((x) => x.itemId === h.E.id && x.commit === h.cE2), '依赖条目已入版本');
    assert.equal(version.items.length, 3, '版本关联 3 条（B、F、新入 E）');
  } finally {
    await h.close();
  }
});

t('B3 全部依赖不可纳入：added 空、版本范围不变、skipped 全量反馈（不静默）', async () => {
  const h = await setupServer((c) => {
    const B = c.mkItem('requirement', '所选需求B');
    c.markDone(B.id); // 依赖提交无单号 → 全部无法归属
    const cU1 = c.commit('u1.txt', 'chore: 杂项一');
    const cU2 = c.commit('u2.txt', 'chore: 杂项二');
    const cB = c.commit('b.txt', `feat: B ${B.id}`);
    return { B, cU1, cU2, cB };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.B.id, commit: h.cB }] });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const vid = created.json.version.id;
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 200, `应 200（不可纳入不是错误，清单反馈）：${r.text}`);
    assert.deepEqual(r.json.added, [], '无任何可纳入依赖');
    assert.equal((r.json.skipped || []).length, 2, '跳过清单不静默丢失');
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === vid);
    assert.equal(version.items.length, 1, '版本范围不变');
  } finally {
    await h.close();
  }
});

t('B4 锁定态与幂等：merging / 已推送 409；无依赖 200 added 空；版本不存在 400', async () => {
  const h = await setupServer((c) => {
    const items = [];
    const commits = [];
    for (let i = 0; i < 3; i++) { // 三个互不占用条目各一提交（一条目至多纳入一个版本）
      const it = c.mkItem('requirement', `需求${i}`);
      c.markDone(it.id);
      commits.push(c.commit(`f${i}.txt`, `feat: ${i} ${it.id}`));
      items.push(it);
    }
    return { items, commits };
  });
  try {
    // 无依赖：所选提交无未选祖先（单提交历史下 main..cX 仅含所选 cX 自身 → 无依赖）
    const v0 = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.items[0].id, commit: h.commits[0] }] });
    assert.equal(v0.status, 201);
    const r0 = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: v0.json.version.id });
    assert.equal(r0.status, 200, `无依赖时一键加入应 200 幂等：${r0.text}`);
    assert.deepEqual(r0.json.added, []);
    assert.deepEqual(r0.json.skipped, []);
    // merging：数据层直接置状态 → 409
    const v1 = await req(h.port, 'POST', `/api/build/version${h.P}`, { name: '合并中版本', items: [{ itemId: h.items[1].id, commit: h.commits[1] }] });
    buildStore.beginMerge(h.dataDir, v1.json.version.id);
    const r1 = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: v1.json.version.id });
    assert.equal(r1.status, 409, '合并中一键加入应 409');
    assert.match(r1.json.error || '', /合并中/);
    // 已推送：recordPushSuccess → 409
    const v2 = await req(h.port, 'POST', `/api/build/version${h.P}`, { name: '推送版本', items: [{ itemId: h.items[2].id, commit: h.commits[2] }] });
    buildStore.recordPushSuccess(h.dataDir, v2.json.version.id, { remote: 'origin', sha: 'a'.repeat(40) });
    const r2 = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: v2.json.version.id });
    assert.equal(r2.status, 409, '已正式发布一键加入应 409');
    assert.match(r2.json.error || '', /已正式发布/);
    // 版本不存在 → 400
    const r3 = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: 'BLD-19990101-001' });
    assert.equal(r3.status, 400, '版本不存在应 400');
  } finally {
    await h.close();
  }
});

/* ================= 前端：合并页简洁隔离分析 + 一键加入 ================= */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false, open: false,
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

function ver(id, name, status = 'draft', extra = {}) {
  const merged = status === 'merged';
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', pushed: false,
    items: [{ itemId: 'REQ-20260921-013', commit: H1, title: '演示需求', mergedAt: merged ? '2026-09-21T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-21T01:00:00.000Z', updatedAt: '2026-09-21T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: status === 'failed' ? '模拟合并失败' : null, baseBranch: 'dev', ...(merged ? { mainSha: H2, replays: [] } : {}) },
    ...extra,
  };
}

function plan({ currentBranch = 'dev', docsHash = null, mergeLocked = false, reason = '', perItem = null, blocked = null, notes = null } = {}) {
  return {
    currentBranch, mainBranch: 'main',
    steps: [
      { key: 'plan', label: '版本计划', locked: false, reason: '' },
      { key: 'link', label: '关联条目与提交', locked: false, reason: '' },
      { key: 'docs', label: '文档编写', locked: false, reason: '' },
      { key: 'merge', label: '合并入 main', locked: mergeLocked, reason },
      { key: 'release', label: '正式发布', locked: false, reason: '' },
    ],
    docs: { files: [], overall: docsHash ? 'committed' : 'none', commitHash: docsHash, reasons: [] },
    mergeAnalysis: {
      perItem: perItem || [],
      blocked: blocked || [],
      notes: notes || (perItem && perItem.some((x) => (x.intermediates || []).length)
        ? ['所选提交存在 3 个未选祖先提交：普通 merge 会一并带入 main，隔离合并不带入；若所选改动依赖这些内容，执行时将冲突阻止并说明原因']
        : []),
    },
  };
}

const DEP_PER_ITEM = [
  { itemId: 'REQ-20260921-013', commit: H1, count: 2, intermediates: [
    { hash: '9ab3cdef'.padEnd(40, '0'), subject: 'feat: 优化 REQ-20260920-018', date: '2026-09-20T10:00:00+08:00' },
    { hash: 'c45d9911'.padEnd(40, '0'), subject: 'dev: 修复 BUG-20260920-017', date: '2026-09-20T11:00:00+08:00' },
  ] },
  { itemId: 'BUG-20260921-002', commit: H2, count: 1, intermediates: [
    { hash: '77d0e2ff'.padEnd(40, '0'), subject: 'docs: 发布文档 REQ-20260920-016', date: '2026-09-20T12:00:00+08:00' },
  ] },
];

function setup({ versions, plans = {}, addDeps = null } = {}) {
  const state = { initialized: true, isRepo: true, currentBranch: 'dev', versions };
  const calls = { addDeps: [], state: 0, plan: 0 };
  const toasts = [];
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const planOf = (id) => (typeof plans === 'function' ? plans(id, calls.plan) : plans[id] || plan());
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    toast: () => {},
    fetch: async (url, opts) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') { calls.state++; return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) }; }
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/publish-plan') { calls.plan++; return { ok: true, json: async () => JSON.parse(JSON.stringify(planOf(up.searchParams.get('id')))) }; }
      if (up.pathname === '/api/build/version/add-dependencies') {
        calls.addDeps.push(JSON.parse(String(opts?.body || '{}')));
        const r = typeof addDeps === 'function' ? addDeps(calls.addDeps.length) : addDeps;
        return { ok: !(r && r.__error), status: r && r.__error ? 409 : 200, json: async () => (r && r.__error ? { error: r.error } : JSON.parse(JSON.stringify(r || { version: null, added: [], skipped: [] }))) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  sandbox.toast = (m, isErr) => toasts.push([m, !!isErr]);
  const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, state, calls, toasts,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox); },
    tick,
    detailAt: async (id, step = 'merge') => {
      vm.runInContext(`window.ATBBuild.selectVersion(${JSON.stringify(id)})`, sandbox);
      vm.runInContext(`window.ATBBuild.setStep(${JSON.stringify(step)})`, sandbox);
      await tick();
    },
  };
}

function mergePaneHtml(inner) {
  const i = inner.indexOf('bld-merge-pane');
  assert.ok(i >= 0, '应渲染合并步面板');
  return inner.slice(i, i + 12000);
}

t('F1 有依赖：一行汇总 + 一键加入按钮 + 明细 details；红色长文与逐条目重复长句不再渲染', async () => {
  const h = setup({ versions: [ver('BLD-DEP', '有依赖')], plans: { 'BLD-DEP': plan({ docsHash: H2, perItem: DEP_PER_ITEM }) } });
  await h.enter();
  await h.detailAt('BLD-DEP', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /发现 3 个未选祖先（依赖）提交 · 影响 2 个所选条目/, '一行汇总（提交数 + 所选条目数）');
  assert.match(pane, /一键加入所有依赖提交/, '一键加入按钮渲染');
  assert.ok(pane.includes('data-iso-add-deps'), '按钮带 data-iso-add-deps 行为标记');
  assert.match(pane, /查看依赖明细/, '明细折叠入口');
  assert.ok(pane.includes('9ab3cdef'), '明细含依赖提交短 hash');
  assert.match(pane, /为 REQ-20260921-013 的依赖/, '明细标注归属所选条目');
  // 红色长文移除：无 rel-form-err、无旧长句
  assert.ok(!pane.includes('rel-form-err'), '合并页不再输出红色 rel-form-err 长段');
  assert.ok(!pane.includes('普通 merge 会一并带入 main'), '逐条目重复长句不再渲染');
  assert.ok(!pane.includes('所选提交存在 3 个未选祖先提交'), 'notes 灰色长句不再渲染（汇总行替代）');
  // 主按钮与顺序保留
  assert.ok(pane.includes('data-ver-merge="BLD-DEP"'), '合并主按钮仍在');
  assert.ok(pane.indexOf('隔离分析') < pane.indexOf('当前分支 dev · 目标主分支 main'), '隔离分析先于分支提示');
});

t('F2 混合提交：单行阻止反馈 + title 全文；点击主按钮仍有原因（不回退点击必反馈）', async () => {
  const blockedText = '同一提交 abc123 关联多个条目（REQ-20260921-011、REQ-20260921-010）：混合提交无法安全拆分，请调整关联或先合并为一个条目';
  const h = setup({ versions: [ver('BLD-MIX', '混合提交')], plans: { 'BLD-MIX': plan({ docsHash: H2, blocked: [blockedText] }) } });
  await h.enter();
  await h.detailAt('BLD-MIX', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /1 处混合提交无法安全拆分，合并将被阻止/, '混合提交单行反馈');
  assert.ok(pane.includes('混合提交无法安全拆分，请调整关联'), 'title 含完整阻止原因');
  assert.ok(!pane.includes('rel-form-err'), '不再输出红色长段');
  assert.ok(!pane.includes('所选提交无未选祖先'), '有阻止信息时不渲染无依赖空态');
  // 点击必反馈：openMergeConfirm toast 真实原因（mergeBlockReason 增补 blocked 档）
  h.run(`window.ATBBuild.openMergeConfirm('BLD-MIX')`);
  assert.ok(h.toasts.some(([m]) => m.includes('暂不可合并') && m.includes('混合提交')), `点击主按钮应 toast 阻止原因，实际：${JSON.stringify(h.toasts)}`);
});

t('F3 无依赖：保持简洁空态，无一键加入入口', async () => {
  const h = setup({ versions: [ver('BLD-CLEAN', '无依赖')], plans: { 'BLD-CLEAN': plan({ docsHash: H2 }) } });
  await h.enter();
  await h.detailAt('BLD-CLEAN', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /所选提交无未选祖先：变更可独立进入主分支。/, '简洁空态保留');
  assert.ok(!pane.includes('data-iso-add-deps'), '无依赖不渲染一键加入按钮');
  assert.ok(!pane.includes('查看依赖明细'), '无依赖不渲染明细入口');
});

t('F4 阻止性信息单行化：门禁锁定 / 不在 dev / 合并失败均非红色长文且文本保留（BUG-20260921-014 契约不破）', async () => {
  const h = setup({
    versions: [ver('BLD-GATE', '门禁'), ver('BLD-BR', '不在dev', 'draft'), ver('BLD-FAIL', '失败', 'failed'), ver('BLD-OK', '已合并', 'merged')],
    plans: {
      'BLD-GATE': plan({ mergeLocked: true, reason: '暂无关联条目：请先在「关联条目与提交」步骤关联' }),
      'BLD-BR': plan({ currentBranch: 'feature-x' }),
      'BLD-FAIL': plan(),
      'BLD-OK': plan({ docsHash: H2 }),
    },
  });
  await h.enter();
  await h.detailAt('BLD-GATE', 'merge');
  let pane = mergePaneHtml(h.inner());
  assert.match(pane, /⚠ 暂不可合并：暂无关联条目：请先在「关联条目与提交」步骤关联/, '门禁原因文本保留');
  assert.ok(!pane.includes('rel-form-err'), '门禁行不再是红色 rel-form-err');
  await h.detailAt('BLD-BR', 'merge');
  pane = mergePaneHtml(h.inner());
  assert.match(pane, /当前分支是 feature-x，不在 dev：请自行切换回 dev 后重试/, '不在 dev 文本保留');
  assert.ok(!pane.includes('rel-form-err'), '不在 dev 行不再是红色 rel-form-err');
  await h.detailAt('BLD-FAIL', 'merge');
  pane = mergePaneHtml(h.inner());
  assert.match(pane, /⚠ 合并失败：模拟合并失败（可重试，只补未合并条目）/, '合并失败文本保留');
  assert.match(pane, /重试合并入 main/, '重试主按钮保留');
  assert.ok(!pane.includes('rel-form-err'), '失败行不再是红色 rel-form-err');
  await h.detailAt('BLD-OK', 'merge');
  pane = mergePaneHtml(h.inner());
  assert.match(pane, /合并完成：主分支头/, '合并完成结果保留');
});

t('F5 一键加入交互：成功后发布范围与隔离分析联动刷新、跳过清单展示；失败可重试', async () => {
  const added = [{ itemId: 'REQ-20260920-018', commit: '9ab3cdef'.padEnd(40, '0'), title: '依赖需求' }];
  const skipped = [{ commit: '77d0e2ff'.padEnd(40, '0'), subject: 'docs: 发布文档 REQ-20260920-016', reason: '无法归属到看板条目（提交主题不含条目编号）' }];
  let phase = 'ok';
  const h = setup({
    versions: [ver('BLD-ACT', '交互')],
    plans: (id, n) => (n >= 2 ? plan({ docsHash: H2, perItem: [] }) : plan({ docsHash: H2, perItem: DEP_PER_ITEM })),
    addDeps: () => (phase === 'ok'
      ? { version: null, added, skipped }
      : { __error: true, error: '条目 REQ-20260920-018 已纳入版本 BLD-20260921-099，不可重复纳入' }),
  });
  await h.enter();
  await h.detailAt('BLD-ACT', 'merge');
  assert.equal(h.calls.addDeps.length, 0, '前置：未发起一键加入');
  await h.run('window.ATBBuild.addDependencies()');
  await h.tick(5);
  assert.equal(h.calls.addDeps.length, 1, '发起一次 add-dependencies 请求');
  assert.equal(h.calls.addDeps[0].id, 'BLD-ACT', '请求体携带版本 id');
  assert.ok(h.calls.state >= 2, '成功后刷新构建状态（发布范围列表更新）');
  assert.ok(h.calls.plan >= 2, '成功后重求值隔离分析');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /所选提交无未选祖先：变更可独立进入主分支。/, '加入后隔离分析收敛为无未选祖先');
  assert.ok(!pane.includes('data-iso-add-deps'), '按钮随无依赖消失');
  assert.match(pane, /以下 1 个依赖未能纳入/, '跳过清单展示');
  assert.match(pane, /无法归属到看板条目/, '跳过原因可见');
  assert.match(pane, /77d0e2ff/, '跳过清单含短 hash');
  assert.ok(h.toasts.some(([m]) => m.includes('已加入 1 个依赖条目') && m.includes('跳过 1 个')), `部分成功 toast，实际：${JSON.stringify(h.toasts)}`);
  // 失败：toast 错误、可重试
  phase = 'err';
  await h.run('window.ATBBuild.addDependencies()');
  await h.tick(5);
  assert.equal(h.calls.addDeps.length, 2, '失败后可再次发起（可重试）');
  assert.ok(h.toasts.some(([m, e]) => e && m.includes('✕ 一键加入失败：') && m.includes('不可重复纳入')), `失败 toast 原因，实际：${JSON.stringify(h.toasts)}`);
});

t('F6 锁定态按钮：merging / 已正式发布 aria-disabled + title 真实原因；守卫点击 toast 不发请求', async () => {
  const h = setup({
    versions: [
      ver('BLD-MRG', '合并中', 'merging'),
      ver('BLD-PUSH', '已推送', 'merged', { pushed: true, release: { pushedAt: '2026-09-21T09:00:00.000Z', pushRemote: 'origin', pushedSha: H2, site: { status: 'waiting' } } }),
    ],
    plans: { 'BLD-MRG': plan({ perItem: DEP_PER_ITEM }), 'BLD-PUSH': plan({ perItem: DEP_PER_ITEM }) },
  });
  await h.enter();
  await h.detailAt('BLD-MRG', 'merge');
  let pane = mergePaneHtml(h.inner());
  assert.ok(/data-iso-add-deps[^>]*aria-disabled="true"/.test(pane), 'merging 态一键加入 aria-disabled');
  assert.match(pane, /合并中，条目不可增删/, 'merging 态 title 原因');
  await h.run('window.ATBBuild.addDependencies()');
  assert.equal(h.calls.addDeps.length, 0, '守卫拦截：不发请求');
  assert.ok(h.toasts.some(([m]) => m.includes('合并中，条目不可增删')), `守卫 toast，实际：${JSON.stringify(h.toasts)}`);
  await h.detailAt('BLD-PUSH', 'merge');
  pane = mergePaneHtml(h.inner());
  assert.ok(/data-iso-add-deps[^>]*aria-disabled="true"/.test(pane), '已正式发布态一键加入 aria-disabled');
  assert.match(pane, /已正式发布，条目已锁定/, '已正式发布态 title 原因');
});

t('S1 静态契约：renderMergePane 仅读取失败态保留 rel-form-err；mergeBlockReason 增补 blocked 档；i18n 中英同步', async () => {
  const mergePane = buildJs.match(/function renderMergePane\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(mergePane, '缺少 renderMergePane');
  assert.equal((mergePane[0].match(/rel-form-err/g) || []).length, 1, 'rel-form-err 仅保留读取失败态一处');
  assert.ok(!mergePane[0].includes('普通 merge 会一并带入 main'), '源码不再含逐条目重复长句');
  const reasonFn = buildJs.match(/function mergeBlockReason\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(reasonFn, '缺少 mergeBlockReason');
  assert.match(reasonFn[0], /mergeAnalysis/, 'mergeBlockReason 增补 blocked 档（title/toast 同源）');
  // i18n：新增词条中英同步（BUG-20260912-001 口径）
  await import('../web/i18n.js');
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  for (const k of ['一键加入所有依赖提交', '加入中…', '查看依赖明细', '所选提交无未选祖先：变更可独立进入主分支。', '⚠ 未能加入任何依赖提交（原因见隔离分析清单）']) {
    assert.ok(k in EN, `EN 词典缺词条：${k}`);
  }
  for (const k of [
    '发现 ◇ 个未选祖先（依赖）提交 · 影响 ◇ 个所选条目',
    '⚠ ◇ 处混合提交无法安全拆分，合并将被阻止',
    '⚠ 暂不可合并：◇',
    '⚠ 合并失败：◇（可重试，只补未合并条目）',
    '⚠ 以下 ◇ 个依赖未能纳入：',
    '为 ◇ 的依赖',
    '✓ 已加入 ◇ 个依赖条目：发布范围已变化，文档需重新核对 / 提交',
    '✓ 已加入 ◇ 个依赖条目，跳过 ◇ 个（原因见隔离分析清单）',
    '✕ 一键加入失败：◇',
  ]) {
    assert.ok(k in EN_DYNAMIC, `EN_DYNAMIC 词典缺词条：${k}`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
