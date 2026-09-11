#!/usr/bin/env node
// BUG-20260908-020 契约测试 —— 已接受条目删除「批次进入状态」显示，恢复通用「已接受」chip
// （REQ-20260907-012 引入该显示、REQ-20260908-010 切换批次候选口径使其失效）。
// BUG-20260909-004：通用「已接受」chip 亦随六档去重移除，L1–L3 断言随之更新（批次文案禁令不变）。
// 覆盖 test-cases.md L1–L6（前端 vm 沙箱，card-flag-dedup.test.mjs 同法）与
// S1–S2（lib 单测 + 真实起 server 集成，multi-project.test.mjs 同法）。
// 用法：node scripts/tests/accepted-batch-entry.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const __http = http;

// ============================================================
// 第一部分：前端（L1–L6）
// ============================================================

const webRoot = path.join(PLUGIN_ROOT, 'scripts', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// DOM 接缝：控件级 stub（confirm-lane.test.mjs 同法）
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  seed('#board', element());
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {};');
  return { sandbox, document, state, run, seed };
}

const item = (id, status, extra = {}) => ({ id, type: 'requirement', status, parent: null, title: id, ...extra });
const ENTRY = { batchId: 'batch-20990907-010', status: 'running' };

function drawerSetup(h) {
  const drawer = element();
  h.seed('#drawer', drawer);
  h.seed('#drawerClose', element()); // renderDrawer 尾部直接绑定 closeDrawer，需真实节点
  h.run('syncAcceptance=()=>{}; batchSettingsHtml=()=>""; bindBatchSettings=()=>{};');
  return drawer;
}
function setItem(h, it) {
  h.state.board = { initialized: true, items: [it] };
  h.state.drawer.id = it.id;
  h.state.drawer.item = it;
  h.state.drawer.navIds = null;
  h.sandbox.testItem = it;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('L1 已接受条目：卡片不出现任何批次进入状态（含响应仍带 batchEntry 的容错场景）；「已接受」chip 亦已随 BUG-20260909-004 六档去重移除', () => {
  const h = setup();
  setItem(h, item('REQ-20990907-001', 'accepted', { batchEntry: ENTRY })); // 历史响应残留字段 → 前端也不得渲染
  const row = h.run('reqRowEl(testItem)');
  const html = row.innerHTML;
  assert.doesNotMatch(html, /class="state s-|>已接受</, '已接受卡片不应渲染档位状态 chip（BUG-20260909-004，BUG-20260908-020 的批次 chip 亦不再回归）');
  assert.doesNotMatch(html, /入批次/, '已接受卡片不得出现「已入批次/未入批次」');
  // BUG-20260910-010：setItem 置 drawer.id 使行处 picked 态，title 在 LANE_HINT.accepted
  // 之后追加「详情打开中」说明——本条断言仍守原契约：档位说明在前、无任何批次文案
  assert.ok(row.title.startsWith('已接受，可在详情页「移入计划」排入开发计划'), '悬停说明应以 LANE_HINT.accepted 开头，不含批次文案');
  assert.doesNotMatch(row.title, /批次/, '悬停说明不得出现批次文案（BUG-20260908-020 契约不变）');
});

t('L2 已接受条目（batchEntry=null / 字段缺失）：卡片同样不渲染任何状态 chip', () => {
  const h = setup();
  setItem(h, item('REQ-20990907-002', 'accepted', { batchEntry: null }));
  const html = h.run('reqRowEl(testItem)').innerHTML;
  assert.doesNotMatch(html, /class="state s-|>已接受</, '未入批卡片不应渲染「已接受」chip（BUG-20260909-004）');
  assert.doesNotMatch(html, /入批次/, '未入批卡片不得出现「已入批次/未入批次」');

  setItem(h, item('REQ-20990907-003', 'accepted')); // 字段缺失（服务端已不对 accepted 下发）
  const html2 = h.run('reqRowEl(testItem)').innerHTML;
  assert.doesNotMatch(html2, /class="state s-|>已接受</, 'batchEntry 缺失时同样不渲染状态 chip');
});

t('L3 非已接受条目：六档去重同口径（待接受/待测试/已完成行均无状态 chip），且不出现批次文案', () => {
  const h = setup();
  const REPORTED = '2026-09-07T08:00:00.000Z';
  setItem(h, item('REQ-20990907-004', 'submitted'));
  assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /class="state s-|>待接受</, '待接受行不再渲染状态 chip（BUG-20260909-004）');
  setItem(h, item('REQ-20990907-005', 'in-progress', { agentCompletedAt: REPORTED }));
  assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /class="state s-|>待测试</, '待测试行不再渲染状态 chip（BUG-20260909-004）');
  setItem(h, item('REQ-20990907-006', 'done', { agentCompletedAt: REPORTED }));
  const doneHtml = h.run('reqRowEl(testItem)').innerHTML;
  assert.doesNotMatch(doneHtml, /class="state s-|>已完成</, '已完成行不再渲染状态 chip（BUG-20260909-004）');
  assert.doesNotMatch(doneHtml, /入批次/, '非已接受行不得出现批次进入状态');
});

t('L4 详情抽屉「状态」字段：已接受显示「已接受」与完善徽标，不再显示批次 chip', () => {
  const h = setup();
  const drawer = drawerSetup(h);
  setItem(h, item('REQ-20990907-007', 'accepted', { batchEntry: ENTRY, refineState: 'unrefined' }));
  h.run('renderDrawer()');
  assert.match(drawer.innerHTML, /<label>状态<\/label><span class="state s-accepted">已接受</, '详情状态字段应显示「已接受」');
  assert.match(drawer.innerHTML, /refine-badge/, '已接受详情应保留完善三态徽标');
  assert.doesNotMatch(drawer.innerHTML, /入批次/, '已接受详情不得出现批次进入状态');

  setItem(h, item('REQ-20990907-008', 'accepted', { batchEntry: null }));
  h.run('renderDrawer()');
  assert.match(drawer.innerHTML, /<label>状态<\/label><span class="state s-accepted">已接受</, 'batchEntry 为 null 时同样显示「已接受」');
  assert.doesNotMatch(drawer.innerHTML, /入批次/, '未入批详情不得残留批次文案');
});

t('L5 详情操作说明 notice：accepted 恒为「未入计划」指引，不含批次文案（含响应仍带 batchEntry 的容错场景）', () => {
  const h = setup();
  const drawer = drawerSetup(h);
  setItem(h, item('REQ-20990907-009', 'accepted', { batchEntry: { batchId: ENTRY.batchId, status: 'prepared' } }));
  h.run('renderDrawer()');
  assert.ok(!drawer.innerHTML.includes('已入批次'), 'notice 不得出现「已入批次」');
  assert.ok(!drawer.innerHTML.includes('等待派发实施') && !drawer.innerHTML.includes('等待按批次派发实施'), 'notice 不得出现批次派发文案');
  assert.match(drawer.innerHTML, /未入计划[\s\S]*\/dev REQ-20990907-009/, 'notice 应保留「移入计划 / /dev 认领」指引');

  setItem(h, item('REQ-20990907-010', 'accepted', { batchEntry: null }));
  h.run('renderDrawer()');
  assert.ok(!drawer.innerHTML.includes('已入批次'), '未入批 notice 不得出现批次文案');
  assert.match(drawer.innerHTML, /未入计划[\s\S]*\/dev REQ-20990907-010/, 'notice 应提示 /dev 认领');
});

t('L6 前端不再依赖 batchEntry 渲染已接受条目（源码级断言）', () => {
  assert.ok(!/function (acceptedEntryChip|acceptedEntryTitle)/.test(source), 'accepted 特例渲染函数应已删除');
  assert.doesNotMatch(source, /未入批次/, 'app.js 不得再出现「未入批次」文案（planned 仅有「已入批次」notice，属范围外）');
  assert.doesNotMatch(source, /it\.batchEntry \? /, 'renderBoard 的 per-item 签名不得包含 it.batchEntry（列表已不渲染批次内容）');
});

// ============================================================
// 第二部分：数据层 S1（batch.batchEntryIndex 单测）
// ============================================================

function tempData() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-entry-'));
  core.initData(root);
  return { root, dataDir: core.dataDirFrom(root) };
}
const mkPlanned = (dataDir, title) => {
  const st = core.createItem(dataDir, { type: 'requirement', title, by: 'test' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'human' });
  // REQ-20260908-010：入批口径为 planned（已计划）
  core.setStatus(dataDir, st.id, 'planned', { by: 'human' });
  return st.id;
};

t('S1 batchEntryIndex：入未结束批次→{batchId,status}；未入批→无；finished→剔除；多批次取最早', () => {
  const { root, dataDir } = tempData();
  const a = mkPlanned(dataDir, 'A');
  const b = mkPlanned(dataDir, 'B');
  const { batch: b1 } = batch.createBatch(dataDir, { ids: [a], projectRoot: root, mode: 'zcode' });
  let idx = batch.batchEntryIndex(dataDir);
  assert.deepEqual(idx.get(a), { batchId: b1.batchId, status: 'prepared' }, '入批条目应映射到批次与状态');
  assert.equal(idx.get(b), undefined, '未入批条目不应出现在索引');

  // 手工构造更晚创建、同样包含 a 的第二批次（createBatch 会冻结前序候选，这里直接落盘账本）
  const dir1 = path.join(dataDir, 'dispatch', 'batches', b1.batchId);
  const raw = JSON.parse(fs.readFileSync(path.join(dir1, 'batch.json'), 'utf8'));
  const b2Id = 'batch-20990909-999';
  const dir2 = path.join(dataDir, 'dispatch', 'batches', b2Id);
  fs.mkdirSync(dir2, { recursive: true });
  fs.writeFileSync(path.join(dir2, 'batch.json'), JSON.stringify({
    ...raw, batchId: b2Id, createdAt: '2099-01-02T00:00:00.000Z', status: 'running', candidates: [a],
  }));
  idx = batch.batchEntryIndex(dataDir);
  assert.equal(idx.get(a).batchId, b1.batchId, '多批次含同一条目时应取最早创建的批次');

  // 最早批次结束后退到次早批次；两个都结束则剔除
  raw.status = 'finished';
  fs.writeFileSync(path.join(dir1, 'batch.json'), JSON.stringify(raw));
  idx = batch.batchEntryIndex(dataDir);
  assert.equal(idx.get(a).batchId, b2Id, '最早批次 finished 后应退到仍在队列中的批次');
  fs.writeFileSync(path.join(dir2, 'batch.json'), JSON.stringify({ ...raw, batchId: b2Id, status: 'finished' }));
  idx = batch.batchEntryIndex(dataDir);
  assert.equal(idx.get(a), undefined, '全部批次结束后条目不再算已入批次');
  fs.rmSync(root, { recursive: true, force: true });
});

// ============================================================
// 第三部分：服务端 S2（batchEntry 仅对 planned 附加，accepted 不再下发）
// ============================================================

async function serverPart() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-entry-api-'));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  const a = mkPlanned(dataDir, 'A 入批');
  const b = mkPlanned(dataDir, 'B 未入批');
  const c = mkPlanned(dataDir, 'C 已认领');
  core.claim(dataDir, c, 'worker-x');
  // BUG-20260908-020：accepted 条目不再下发 batchEntry（原「入批后退回已接受」过渡态）
  const d = core.createItem(dataDir, { type: 'requirement', title: 'D 已接受', by: 'test' }).id;
  core.setStatus(dataDir, d, 'accepted', { by: 'human' });
  const { batch: b1 } = batch.createBatch(dataDir, { ids: [a], projectRoot: root, mode: 'zcode' });

  const port = 21000 + Math.floor(Math.random() * 20000);
  const registry = path.join(os.tmpdir(), `atb-registry-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const proc = spawn(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: registry },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const request = (p) => new Promise((resolve, reject) => {
    const r = __http.request(`http://127.0.0.1:${port}${p}`, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }));
    });
    r.on('error', reject);
    r.end();
  });
  const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
  let up = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { up = (await request('/api/health')).status === 200; } catch {}
    if (up) break;
  }
  if (!up) { proc.kill(); throw new Error('server 启动超时'); }

  try {
    // S2a /api/board：batchEntry 仅 planned 附加；accepted / 非计划条目不下发该字段
    const board = await request('/api/board');
    assert.equal(board.status, 200, '/api/board 应 200');
    const ia = board.json.items.find((x) => x.id === a);
    const ib = board.json.items.find((x) => x.id === b);
    const ic = board.json.items.find((x) => x.id === c);
    const id = board.json.items.find((x) => x.id === d);
    assert.deepEqual(ia.batchEntry, { batchId: b1.batchId, status: 'prepared' }, '入批 planned 条目应附 batchEntry（详情 notice 仍消费）');
    assert.equal(ib.batchEntry, null, '未入批 planned 条目 batchEntry 应为 null');
    assert.equal('batchEntry' in ic, false, '非 planned 条目不应附加 batchEntry');
    assert.equal('batchEntry' in id, false, 'BUG-20260908-020：accepted 条目不再下发 batchEntry');

    // S2b /api/item/:id 同口径
    const da = await request(`/api/item/${encodeURIComponent(a)}`);
    const db = await request(`/api/item/${encodeURIComponent(b)}`);
    const dc = await request(`/api/item/${encodeURIComponent(c)}`);
    const dd = await request(`/api/item/${encodeURIComponent(d)}`);
    assert.equal(da.json.batchEntry.batchId, b1.batchId, '入批条目详情应附 batchEntry');
    assert.equal(db.json.batchEntry, null, '未入批条目详情 batchEntry 应为 null');
    assert.equal('batchEntry' in dc.json, false, '非 planned 条目详情不附加 batchEntry');
    assert.equal('batchEntry' in dd.json, false, 'BUG-20260908-020：accepted 条目详情不再下发 batchEntry');

    // S2c 批次 finished 后 planned 的 batchEntry 回到 null
    const bfile = path.join(dataDir, 'dispatch', 'batches', b1.batchId, 'batch.json');
    const raw = JSON.parse(fs.readFileSync(bfile, 'utf8'));
    raw.status = 'finished';
    fs.writeFileSync(bfile, JSON.stringify(raw));
    const board2 = await request('/api/board');
    const ia2 = board2.json.items.find((x) => x.id === a);
    assert.equal(ia2.batchEntry, null, '批次结束后 planned 条目 batchEntry 应回到 null');
    console.log('✓ S2 /api/board 与 /api/item/:id：batchEntry 仅 planned 附加（accepted 不再下发；finished 剔除）');
  } finally {
    proc.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

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
try {
  await serverPart();
} catch (e) {
  failed++;
  console.error(`✗ S2 /api/board 与 /api/item/:id\n    ${String(e.message).split('\n')[0]}`);
}

console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
