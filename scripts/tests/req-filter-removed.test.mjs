#!/usr/bin/env node
// BUG-20260907-016（归属 REQ-20260907-006）：用户澄清「去掉全部需求的过滤条件」实为
// 去掉筛选条里的「全部」这一档，而非整条移除。本文件由 REQ-20260907-006 的「移除」
// 契约改写为「恢复五档筛选、无『全部』档」契约 + 行为测试：
// 静态断言 index.html / app.js / style.css 筛选条恢复且无「全部」；vm 加载 app.js 验证
// 按档过滤（laneOf 派生）、chips 计数渲染、空态文案与讨论模块筛选不受影响。
// 用法：node scripts/tests/req-filter-removed.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const oncall = fs.readFileSync(path.join(webRoot, 'oncall.js'), 'utf8');

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
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  seed('#board', element());
  seed('#reqList', element());
  seed('#dataDir', element());
  seed('#reqCount', element());
  seed('#emptyState', element());
  seed('#filterBar', element());
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(js.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; syncAcceptance = () => {}; syncImpl = () => {};');
  return { sandbox, document, state, run, seed };
}

const item = (id, status, extra = {}) => ({ id, type: 'requirement', status, parent: null, title: id, ...extra });
const sample = () => [
  item('REQ-20990101-001', 'submitted'),
  item('REQ-20990101-002', 'accepted'),
  item('REQ-20990101-003', 'in-progress', { owner: 'w1' }),
  item('REQ-20990101-004', 'in-progress', { owner: 'w2', agentCompletedAt: '2026-09-06T08:00:00.000Z' }),
  item('REQ-20990101-005', 'done'),
];

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 静态契约：筛选条恢复（html/js/css 三处）且无「全部」档', () => {
  assert.match(html, /id="filterBar"/, 'index.html 应有 #filterBar 容器');
  for (const token of ['REQ_FILTERS', 'renderFilterBar', 'state.reqFilter', 'applyReqFilter']) {
    assert.ok(js.includes(token), `app.js 应含 ${token}`);
  }
  for (const sel of ['.filter-bar', '.filter-chip', '.filter-count']) {
    assert.ok(css.includes(sel), `style.css 应含 ${sel} 规则`);
  }
  // 档位来源：REQ_FILTERS 直接派生自 LANES 五档（待接受/已接受/开发中/待测试/已完成），不含 all/「全部」
  assert.match(js, /const REQ_FILTERS = LANES\.map\(\(lane\) => \(\{ key: lane, label: LANE_LABEL\[lane\] \}\)\);/, 'REQ_FILTERS 应由 LANES 五档派生且无其余档');
  const barSeg = js.slice(js.indexOf('function renderFilterBar'), js.indexOf('function reqRowEl'));
  assert.doesNotMatch(barSeg, /全部|'all'/, 'chips 渲染不得出现「全部」档');
  assert.match(js, /\$\('#filterBar'\)\?\.addEventListener\('click'/, '应绑定 #filterBar 点击事件委托');
});

t('T2 行为：默认档「待接受」，visibleItems 按档过滤（laneOf 派生）', () => {
  const h = setup();
  h.state.board = { initialized: true, items: sample() };
  assert.equal(h.state.reqFilter, 'submitted', '默认应选中第一档「待接受」');
  assert.equal(h.run('visibleItems().length'), 1, '默认档下仅待接受条目可见');
  assert.equal(h.run('visibleItems()[0].id'), 'REQ-20990101-001');
  h.run("state.reqFilter = 'confirming'");
  assert.equal(h.run('visibleItems().map((it) => it.id).join()'), 'REQ-20990101-004', '待测试档应按 laneOf 派生命中上报条目');
  h.run("state.reqFilter = 'done'");
  assert.equal(h.run('visibleItems().length'), 1, '已完成档仅 done 条目');
});

t('T3 行为：renderFilterBar 渲染五档 chips 带计数与选中态，无「全部」', () => {
  const h = setup();
  h.state.board = { initialized: true, items: sample() };
  h.run('renderFilterBar()');
  const bar = h.document.querySelector('#filterBar');
  assert.ok(bar.innerHTML, '应渲染 chips');
  assert.doesNotMatch(bar.innerHTML, /全部/, '不得渲染「全部」chip');
  assert.match(bar.innerHTML, /class="filter-chip active" data-filter="submitted"/, '默认档高亮待接受');
  for (const [key, label] of [['submitted', '待接受'], ['accepted', '已接受'], ['developing', '开发中'], ['confirming', '待测试'], ['done', '已完成']]) {
    assert.match(bar.innerHTML, new RegExp(`data-filter="${key}">${label} <span class="filter-count">1</span>`), `应含 ${label} 档带计数 1`);
  }
});

t('T4 行为：零结果空态文案恢复区分筛选与搜索', () => {
  const h = setup();
  h.state.board = { initialized: true, items: sample() };
  h.state.search.q = '不存在的关键词';
  h.state.search.res = { items: [] }; // 搜索零命中叠加默认档
  h.state.listSig = '';
  h.run('renderBoard()');
  const empty = h.document.querySelector('#reqList').children[0];
  assert.ok(empty, '应渲染空态节点');
  assert.match(empty.textContent, /当前筛选与搜索下没有条目/, '空态文案应为「当前筛选与搜索下没有条目」');
  // 完全无条目时仍是创建引导
  h.state.board = { initialized: true, items: [] };
  h.state.search.q = '';
  h.state.search.res = null;
  h.state.listSig = '';
  h.run('renderBoard()');
  const empty2 = h.document.querySelector('#reqList').children[0];
  assert.match(empty2.textContent, /暂无需求或 Bug/, '零条目应提示创建');
});

t('T5 行不再渲染档位状态 chip（BUG-20260909-004）；讨论模块筛选不受影响', () => {
  assert.match(js, /const LANE_LABEL = \{[\s\S]*?confirming: '待测试'[\s\S]*?\}/, '派生分类标签应保留（筛选条与悬停提示仍用）');
  const h = setup();
  h.state.board = { initialized: true, items: sample() };
  h.sandbox.testItem = item('R1', 'in-progress', { agentCompletedAt: '2026-09-06T08:00:00.000Z' });
  assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /class="state s-|>待测试</, '列表行不应渲染状态 chip 或档位文字');
  h.sandbox.testItem = item('R2', 'submitted');
  assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /class="state s-|>待接受</, '列表行不应渲染状态 chip 或档位文字');
  assert.match(oncall, /oncall-filters/, '讨论模块筛选容器保留');
  // REQ-20260907-008：讨论模块筛选 chip 弃用 oc-filter 样式，改用与需求栏一致的 filter-chip（机制保留）
  assert.match(oncall, /filter-chip/, '讨论模块筛选 chip 机制保留（filter-chip）');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
