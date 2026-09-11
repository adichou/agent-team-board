#!/usr/bin/env node
// REQ-20260908-002 列表排序与已完成档默认截断 —— 需求视图（app.js）与讨论视图（oncall.js）。
// 覆盖：排序比较器五键、默认最新更新降序、已完成档默认截断 100 与计数提示、搜索期间不截断、
// 排序控件契约与 localStorage 记忆（非法值回退默认）、签名重绘、讨论列表排序。
// 用法：node scripts/tests/list-sort.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appSource = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const oncallSource = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'oncall.js'), 'utf8');
const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// DOM 接缝：同 accept-ui 的极简元素桩，只记录属性、事件与 children。
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, value: '', innerHTML: '', textContent: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function makeStorage(seed = {}) {
  const store = { ...seed };
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
}

// 加载 app.js 首段（事件绑定区之前）到沙箱
function setupApp({ storage = makeStorage() } = {}) {
  const document = element();
  document.createElement = element;
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} },
    localStorage: storage,
    window: { addEventListener() {}, confirm: () => true },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(appSource.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  return { sandbox, document, state, run, storage };
}

// 时间基线 + 批量造条目工具：done 档按 updatedAt 交错，保证与 created 序不同
const T0 = '2026-01-01T00:00:00.000Z';
const at = (i) => new Date(Date.parse(T0) + i * 3600_000).toISOString();
const mkItem = (i, { status = 'done', updatedShift = 0 } = {}) => ({
  id: `REQ-20990101-${String(i + 1).padStart(3, '0')}`,
  type: 'requirement', status, parent: null,
  title: `条目 ${i + 1}`,
  createdAt: at(i), updatedAt: at(i + updatedShift),
});

// 加载 oncall.js（IIFE，含 init 静态绑定）到沙箱
function setupOncall({ storage = makeStorage(), board } = {}) {
  const document = element();
  document.createElement = element;
  document.addEventListener = () => {};
  const sandbox = { document, console, setTimeout: () => 0, clearTimeout() {},
    localStorage: storage,
    window: { addEventListener() {}, marked: { parse: (md) => md || '' } },
    fetch: async () => ({ ok: true, json: async () => board }),
  };
  vm.createContext(sandbox);
  vm.runInContext(oncallSource, sandbox, { filename: 'oncall.js' });
  return { sandbox, document, storage };
}

/* ---------- 需求视图 ---------- */

t('T1 排序比较器 sortReqItems：五键方向正确、同值回退单号、不改入参', () => {
  const h = setupApp();
  const src = [
    { id: 'REQ-20990101-002', createdAt: at(10), updatedAt: at(30) },
    { id: 'REQ-20990101-001', createdAt: at(0), updatedAt: at(20) },
    { id: 'REQ-20990101-003', createdAt: at(20), updatedAt: at(10) },
  ];
  h.sandbox.testItems = src;
  // vm 沙箱数组与宿主 realm 原型不同（assert/strict 的 deepEqual 会比较原型），统一展开回宿主数组
  const ids = (key) => [...h.run(`sortReqItems(testItems, ${JSON.stringify(key)}).map((x) => x.id)`)];
  assert.deepEqual(ids('updated-desc'), ['REQ-20990101-002', 'REQ-20990101-001', 'REQ-20990101-003'], '最新更新应在前');
  assert.deepEqual(ids('updated-asc'), ['REQ-20990101-003', 'REQ-20990101-001', 'REQ-20990101-002'], '最早更新应在前');
  assert.deepEqual(ids('created-desc'), ['REQ-20990101-003', 'REQ-20990101-002', 'REQ-20990101-001'], '最新创建应在前');
  assert.deepEqual(ids('created-asc'), ['REQ-20990101-001', 'REQ-20990101-002', 'REQ-20990101-003'], '最早创建应在前');
  assert.deepEqual(ids('id-asc'), ['REQ-20990101-001', 'REQ-20990101-002', 'REQ-20990101-003'], '单号升序');
  // 同值回退单号，保证稳定
  h.sandbox.testTied = [
    { id: 'REQ-20990101-002', createdAt: at(5), updatedAt: at(5) },
    { id: 'REQ-20990101-001', createdAt: at(5), updatedAt: at(5) },
  ];
  assert.deepEqual(
    [...h.run('sortReqItems(testTied, "updated-desc").map((x) => x.id)')],
    ['REQ-20990101-001', 'REQ-20990101-002'],
    '同值按单号稳定排序'
  );
  assert.deepEqual([...h.run('testItems.map((x) => x.id)')], src.map((x) => x.id), '入参数组顺序不可被改');
});

t('T2 需求列表默认排序：已完成档默认按更新时间降序（最新活跃在最上）', () => {
  const h = setupApp();
  // updatedAt 与 id 序刻意相反：id 越小更新越早（默认键下应倒序呈现）
  const items = [mkItem(0, { updatedShift: 0 }), mkItem(1, { updatedShift: 2 }), mkItem(2, { updatedShift: 4 })];
  h.state.board = { initialized: true, dataDir: '/x', items };
  h.state.reqFilter = 'done';
  const ids = [...h.run('visibleItems().map((x) => x.id)')];
  assert.deepEqual(ids, ['REQ-20990101-003', 'REQ-20990101-002', 'REQ-20990101-001'], '默认最新更新在前');
  h.state.reqSort = 'created-asc';
  assert.deepEqual([...h.run('visibleItems().map((x) => x.id)')], ['REQ-20990101-001', 'REQ-20990101-002', 'REQ-20990101-003'], '切键后按创建升序');
});

t('T3 已完成档默认截断 100：150 条渲染 100 行、计数 100 / 150 且带搜索引导；其他档不截断', () => {
  const h = setupApp();
  const done = Array.from({ length: 150 }, (_, i) => mkItem(i));
  const submitted = Array.from({ length: 130 }, (_, i) => mkItem(i, { status: 'submitted' }));
  h.state.board = { initialized: true, dataDir: '/x', items: [...done, ...submitted] };
  h.state.reqFilter = 'done';
  h.run('renderBoard()');
  const list = h.document.querySelector('#reqList');
  assert.equal(list.children.length, 100, '已完成档默认只渲染 100 行');
  assert.equal(list.children[0].dataset.id, 'REQ-20990101-150', '截断后首行为最新更新条目');
  assert.match(h.document.querySelector('#reqCount').textContent, /100 \/ 150/, '计数展示 100 / 150');
  assert.match(h.document.querySelector('#reqCount').textContent, /搜索/, '计数行提示可用搜索获取更早条目');
  // 其他档不截断（130 条待接受全量渲染，计数无截断提示）
  h.state.reqFilter = 'submitted';
  h.run('renderBoard()');
  assert.equal(h.document.querySelector('#reqList').children.length, 130, '非已完成档不截断');
  assert.doesNotMatch(h.document.querySelector('#reqCount').textContent, /\//, '非截断计数不带 x / y');
});

t('T4 搜索期间不截断：关键词非空（含结果未到）时已完成档全量参与，老条目可被命中', () => {
  const h = setupApp();
  const done = Array.from({ length: 150 }, (_, i) => mkItem(i));
  h.state.board = { initialized: true, dataDir: '/x', items: done };
  h.state.reqFilter = 'done';
  // 搜索词已输入、结果未到：不截断（150 全量在池）
  h.run('state.search.q = "REQ-20990101"; state.search.res = null;');
  assert.equal(h.run('visibleItems().length'), 150, '搜索词非空即不截断');
  // 结果到达：命中集合含第 101 位老条目（按默认更新降序排位 101），应可显示
  h.run('state.search.res = { items: [{ id: "REQ-20990101-001" }] };');
  const ids = [...h.run('visibleItems().map((x) => x.id)')];
  assert.deepEqual(ids, ['REQ-20990101-001'], '搜索命中作用于已完成档全量（老条目可获取）');
});

t('T5 排序控件契约：#reqSort 五选项默认最新更新；change 绑定与记忆；非法存储值回退默认', () => {
  // 静态契约：控件存在、五选项、默认值
  assert.match(html, /id="reqSort"/, 'index.html 应有排序下拉 #reqSort');
  for (const [key, label] of [
    ['updated-desc', '最新更新'], ['updated-asc', '最早更新'],
    ['created-desc', '最新创建'], ['created-asc', '最早创建'], ['id-asc', '单号'],
  ]) assert.ok(html.includes(`value="${key}"`) && html.includes(`>${label}<`), `应有选项 ${label}`);
  assert.match(appSource, /\$\('#reqSort'\)[\s\S]{0,300}?addEventListener\('change'/, '应绑定 change 重排');
  assert.match(appSource, /localStorage\.setItem\(REQ_SORT_STORAGE_KEY/, '切换排序应记忆 localStorage');
  assert.match(appSource, /atb\.req\.sort/, '排序存储键为 atb.req.sort');
  // 功能：非法存储值回退默认
  const bad = setupApp({ storage: makeStorage({ 'atb.req.sort': 'bogus' }) });
  assert.equal(bad.state.reqSort, 'updated-desc', '非法存储值回退默认档');
  // 功能：合法存储值生效（渲染首行为 id 最小的条目，即 id-asc 序）
  const h = setupApp({ storage: makeStorage({ 'atb.req.sort': 'id-asc' }) });
  assert.equal(h.state.reqSort, 'id-asc', '存储值合法时生效');
  const items = [mkItem(2, { updatedShift: 4 }), mkItem(0, { updatedShift: 0 }), mkItem(1, { updatedShift: 2 })];
  h.state.board = { initialized: true, dataDir: '/x', items };
  h.state.reqFilter = 'done';
  h.run('renderBoard()');
  assert.equal(h.document.querySelector('#reqList').children[0].dataset.id, 'REQ-20990101-001', '记忆的排序键参与默认渲染');
});

t('T6 签名重绘：排序键纳入列表内容签名，数据不变切键仍触发重渲染', () => {
  const h = setupApp();
  // id 越小更新越早：默认最新更新在前应为 002 → 001，切 id-asc 后为 001 → 002
  const items = [mkItem(0, { updatedShift: 0 }), mkItem(1, { updatedShift: 4 })];
  h.state.board = { initialized: true, dataDir: '/x', items };
  h.state.reqFilter = 'done';
  h.run('renderBoard()');
  const before = h.document.querySelector('#reqList').children.map((el) => el.dataset.id);
  h.state.reqSort = 'id-asc'; // 数据不变，仅切排序键
  h.run('renderBoard()');
  const after = h.document.querySelector('#reqList').children.map((el) => el.dataset.id);
  assert.deepEqual(before, ['REQ-20990101-002', 'REQ-20990101-001'], '默认最新更新在前');
  assert.notDeepEqual(after, before, '切排序键后必须重渲染');
});

/* ---------- 讨论视图（REQ-20260909-004：开放式讨论，列表固定按最近更新排序，排序控件已移除） ---------- */

const ocBoard = () => ({
  initialized: true,
  discussions: [
    { id: 'ASK-20990101-001', title: '最晚更新', status: 'discussing', phase: 'none', createdAt: at(0), updatedAt: at(30), draftCount: 0, createdCount: 0 },
    { id: 'ASK-20990101-002', title: '居中', status: 'discussing', phase: 'none', createdAt: at(10), updatedAt: at(20), draftCount: 0, createdCount: 0 },
    { id: 'ASK-20990101-003', title: '最早更新', status: 'discussing', phase: 'none', createdAt: at(20), updatedAt: at(10), draftCount: 0, createdCount: 0 },
  ],
});

t('T7 讨论列表排序：固定按最近更新在前（REQ-20260909-004 移除排序控件与多键切换）', async () => {
  const h = setupOncall({ board: ocBoard() });
  await h.sandbox.window.ATBOncall.poll('/project/a', true);
  // 卡片 HTML 中单号出现多次（cid），每卡只取首个 id
  const listIds = () => h.document.querySelector('#ocList').children.map((el) => (el.innerHTML.match(/ASK-20990101-\d{3}/) || ['?'])[0]);
  assert.deepEqual(listIds(), ['ASK-20990101-001', 'ASK-20990101-002', 'ASK-20990101-003'], '讨论中档默认最新更新在前');
});

t('T8 讨论排序控件契约：讨论列表不再提供排序下拉（需求列表五键排序不受影响）', () => {
  assert.doesNotMatch(oncallSource, /oc-sort/, '讨论筛选条不再有排序下拉');
  assert.doesNotMatch(oncallSource, /atb\.oncall\.sort/, '不再记忆讨论排序键');
  assert.match(css, /\.sort-select/, '需求列表排序下拉样式保留');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
