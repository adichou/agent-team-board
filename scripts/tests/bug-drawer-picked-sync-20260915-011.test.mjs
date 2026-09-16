#!/usr/bin/env node
// BUG-20260915-011：需求列表左侧选中态（.picked）不随右侧抽屉切换即时同步。
// 根因：openDrawer 更新 state.drawer 后仅清 listSig、只调 refreshDrawer（右侧），
// 不重算左侧行选中态；数据稳态下（/api/board 载荷不变）2 秒轮询不触发 renderBoard，
// 高亮长期停留在旧条目，直到下一次数据变化才被轮询重绘顺带纠正。
// 修复契约（README 期望行为）：
//   1. 一切打开/切换详情入口（点行、抽屉上一条/下一条按钮、键盘 ←/→、跨模块跳转
//      gotoItem 类入口）在切换瞬间同步移动左侧行 picked 高亮，不依赖轮询与数据变化；
//   2. 列表同步在抽屉详情请求（refreshDrawer）返回之前同步完成，不等待网络；
//   3. 不回退：列表内容签名剪枝仍生效（无变化不重绘、不打断行内点击/勾选）；
//      closeDrawer 高亮清除、openDrawer/closeDrawer 的 listSig 重置与
//      state.board?.initialized 守卫（对齐关闭路径）均保持。
// 用法：node scripts/tests/bug-drawer-picked-sync-20260915-011.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// DOM 接缝：控件级 stub（picked-row-hint-20260910-010.test.mjs 同法）
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); v.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
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
  const seed = (selector) => document.nodes.set(selector, element());
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  for (const s of ['#board', '#reqList', '#dataDir', '#reqCount', '#emptyState', '#filterBar', '#drawer', '#mask']) seed(s);
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
  state.view = 'status';
  // 抽屉详情请求与无关 UI 副作用打桩：本测试只关心左侧列表 DOM 的选中态
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; saveViewSnapshot = () => {}; setView = () => {};'
    + ' syncAcceptance = () => {}; syncImpl = () => {}; syncPlan = () => {}; syncEmptyCards = () => {};'
    + ' syncReqSortVisibility = () => {}; renderHolds = () => {};');
  return { sandbox, document, state, run };
}

const item = (id) => ({ id, type: 'requirement', status: 'submitted', parent: null, title: id, createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z' });
const A = 'REQ-20990101-001';
const B = 'REQ-20990101-002';

function rowOf(h, id) {
  const row = h.document.nodes.get('#reqList').children.find((el) => el.dataset.id === id);
  assert.ok(row, `列表中应存在 ${id} 行`);
  return row;
}
const isPicked = (el) => /(^|\s)picked(\s|$)/.test(el.className);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 核心复现：数据稳态下点行 A → B，左侧 picked 高亮即时跟随，不等待轮询', async () => {
  const h = setup();
  h.state.board = { initialized: true, items: [item(A), item(B)] };
  h.run('renderBoard()');
  assert.ok(!isPicked(rowOf(h, A)) && !isPicked(rowOf(h, B)), '初始无抽屉打开，任何行不得有选中态');
  await h.run(`openDrawer("${A}")`);
  assert.ok(isPicked(rowOf(h, A)), '打开 A 后左侧 A 行应立即带 picked');
  assert.ok(!isPicked(rowOf(h, B)), '打开 A 后 B 行不得有 picked');
  // 点行 B：不触发 poll、不改看板数据（稳态），右侧切换的同时左侧必须同步
  await h.run(`openDrawer("${B}")`);
  assert.ok(isPicked(rowOf(h, B)), '切换到 B 后左侧 B 行应立即带 picked（不等待轮询）');
  assert.ok(!isPicked(rowOf(h, A)), '切换到 B 后 A 行高亮应立即消失');
  assert.match(rowOf(h, B).title, /详情打开中/, 'B 行悬停应提示详情打开中');
  assert.doesNotMatch(rowOf(h, A).title, /详情打开中/, 'A 行悬停不得再提示详情打开中');
});

t('T2 抽屉上一条/下一条与键盘 ←/→ 路径：navDrawer 切换后高亮同步移动', async () => {
  const h = setup();
  h.state.board = { initialized: true, items: [item(A), item(B)] };
  h.run('renderBoard()');
  await h.run(`openDrawer("${A}")`);
  // navDrawer 不 await openDrawer：列表同步须在首个 await 前同步完成
  h.run('navDrawer("next")');
  assert.ok(isPicked(rowOf(h, B)), '下一条切到 B 后左侧 B 行应立即带 picked');
  assert.ok(!isPicked(rowOf(h, A)), '切走后 A 行高亮应立即消失');
  h.run('navDrawer("prev")');
  assert.ok(isPicked(rowOf(h, A)), '上一条切回 A 后左侧 A 行应立即带 picked');
  assert.ok(!isPicked(rowOf(h, B)), '切走后 B 行高亮应立即消失');
});

t('T3 跨模块定位（gotoItem 类入口）：从其他模块打开详情，列表高亮同样同步', async () => {
  const h = setup();
  h.state.board = { initialized: true, items: [item(A), item(B)] };
  h.run('renderBoard()');
  h.state.view = 'runs'; // 模拟从任务模块定位条目（setView 已打桩）
  await h.run(`openDrawer("${B}")`);
  assert.ok(isPicked(rowOf(h, B)), '跨模块定位打开 B 后左侧 B 行应立即带 picked');
  assert.ok(!isPicked(rowOf(h, A)), 'A 行不得残留 picked');
});

t('T4 不回退：关闭抽屉后高亮清除行为保持不变', async () => {
  const h = setup();
  h.state.board = { initialized: true, items: [item(A), item(B)] };
  h.run('renderBoard()');
  await h.run(`openDrawer("${B}")`);
  assert.ok(isPicked(rowOf(h, B)), '前置：B 行带 picked');
  h.run('closeDrawer()');
  assert.ok(!isPicked(rowOf(h, A)) && !isPicked(rowOf(h, B)), '关闭抽屉后所有行高亮应清除');
  assert.equal(h.state.drawer.id, null, '关闭后抽屉条目应为空');
});

t('T5 不回退：列表内容签名剪枝仍生效（无变化不重绘，选中态变化才重绘）', async () => {
  const h = setup();
  h.state.board = { initialized: true, items: [item(A), item(B)] };
  h.run('renderBoard()');
  const list = h.document.nodes.get('#reqList');
  let renders = 0;
  const orig = list.replaceChildren.bind(list);
  list.replaceChildren = (...children) => { renders++; return orig(...children); };
  h.run('renderBoard()');
  assert.equal(renders, 0, '看板数据与选中态均无变化时不得重绘列表（不打断行内点击/勾选）');
  await h.run(`openDrawer("${A}")`);
  assert.equal(renders, 1, '打开抽屉（选中态变化）应重绘一次列表');
  h.run('renderBoard()');
  assert.equal(renders, 1, '选中态与数据不变时轮询渲染不得再重绘列表');
  await h.run(`openDrawer("${B}")`);
  assert.equal(renders, 2, '切换抽屉条目（选中态变化）应重绘列表');
});

t('T6 静态契约：openDrawer 重置 listSig 后同步重算列表，且先于抽屉详情请求、带初始化守卫（对齐 closeDrawer）', () => {
  const open = js.match(/async function openDrawer[\s\S]*?\n\}/)[0];
  const sigIdx = open.indexOf("state.listSig = ''");
  const renderIdx = open.indexOf('renderBoard()');
  const refreshIdx = open.indexOf('await refreshDrawer()');
  assert.ok(sigIdx > -1, 'openDrawer 应保留 listSig 重置（重算行选中态语义）');
  assert.ok(renderIdx > -1, 'openDrawer 应显式调用 renderBoard 重算左侧行选中态');
  assert.ok(refreshIdx > -1, 'openDrawer 应仍请求并渲染右侧抽屉详情');
  assert.ok(sigIdx < renderIdx && renderIdx < refreshIdx, '列表同步应在重置签名后、抽屉详情请求前同步完成');
  assert.match(open, /state\.board\?\.initialized\)\s*renderBoard\(\)/, '与 closeDrawer 相同的初始化守卫');
  // 签名仍含 drawer.id：选中态变化驱动重绘的既有机制不回退
  const sigSeg = js.slice(js.indexOf('const sig = JSON.stringify'), js.indexOf('const sig = JSON.stringify') + 300);
  assert.match(sigSeg, /state\.drawer\.id/, '列表重渲染签名应包含 state.drawer.id');
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
