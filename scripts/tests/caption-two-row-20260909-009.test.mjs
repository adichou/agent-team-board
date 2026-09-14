#!/usr/bin/env node
// BUG-20260909-009 已接受列表的选择区域布局拥挤 —— 列表头结构契约测试（行为与静态契约）
// （沿用 selection-bar-merge.test.mjs 的 vm 模拟 DOM 模式）
// 历史：BUG-20260909-009 曾确立「固定两行列表头」（行1 信息 / 行2 选择区）；
// REQ-20260910-008 选择区域布局优化取消了固定的第二行——排序、全选/全不选、已选数量、
// 批量动作与档位快捷入口合并为单行工具栏（宽度不足按组整体换行），本文件契约随之改写，
// 行为断言（按档显隐、勾选零跳变、合并意图、防误触）全部保留。
// 覆盖用例 C1-C4：
//   C1 静态单行工具栏结构（两行结构根除、选择控件与排序同行、分隔线根除）
//   C2 CSS 契约（单行 wrap、快捷入口靠右、选择区连续无靠右脱离）
//   C3 选择控件按档显隐与勾选零跳变（显隐口径稳定基础）
//   C4 既有契约归位抽查（快捷入口在工具栏内、合并意图保留）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 001/002 已接受（002 完善中）；003/004 待接受；005 已计划未认领；006 开发中
const item = (id, status = 'accepted', extra = {}) => ({
  id, type: 'requirement', status, owner: null, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const sample = () => [
  item('REQ-20990101-001'),
  item('REQ-20990101-002', 'accepted', { refineState: 'refining' }),
  item('REQ-20990101-003', 'submitted'),
  item('REQ-20990101-004', 'submitted'),
  item('REQ-20990101-005', 'planned'),
  item('REQ-20990101-006', 'in-progress', { owner: 'dev-x' }),
];

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', disabled: false, checked: false, indeterminate: false,
    title: '', value: '', children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  const requests = [], confirmations = [], notices = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    fetch: async (url, opts) => { requests.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: sample() };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  sandbox.recordConfirm = (text) => confirmations.push(text);
  run('uiConfirm = (o) => { recordConfirm(`${o.title}\\n${o.message || ""}`); return true; };');
  run('toast = recordNotice; poll = async () => {}; refreshDrawer = async () => {}; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {};');
  return { sandbox, document, state, run, requests, confirmations, notices };
}

const hidden = (h, sel) => h.document.querySelector(sel).classList.contains('hidden');

// C1 静态单行工具栏结构（REQ-20260910-008 取代两行；REQ-20260910-016 排序迁至第三行定位组）：
// #reqCaption 单容器承载 全选/全不选/右组/快捷入口；两行结构（#selectRow、.caption-info/.caption-select）根除；
// #reqCount 转条件提示（初始 hidden）；分隔线根除
t('C1 静态结构：#reqCaption 单容器内 #reqCount（条件提示，初始 hidden）→ #selectOperable → #selectNone → #selGroup → #laneQuickEntry；#reqSort 已迁至 #pageHead 定位组（工具栏无排序入口与占位）；无 #selectRow / .caption-info / .caption-select / .caption-divider（HTML 与 CSS）', () => {
  const caption = htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="reqList"/);
  assert.ok(caption, '应存在列表头 #reqCaption');
  const head = caption[0];
  for (const id of ['reqCount', 'selectOperable', 'selectNone', 'selGroup', 'laneQuickEntry']) {
    assert.ok(head.includes(`id="${id}"`), `工具栏应包含 #${id}`);
  }
  // 位次：全选 → 全不选 → 右组 → 快捷入口（单行工具栏左起次序；REQ-20260910-016 排序迁出后不再参与）
  const order = ['selectOperable', 'selectNone', 'selGroup', 'laneQuickEntry'].map((id) => head.indexOf(`id="${id}"`));
  assert.ok(order.every((i) => i !== -1), '工具栏应包含全部四个控件');
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], '工具栏顺序：全选 → 全不选 → 右组 → 快捷入口');
  // REQ-20260910-016：排序菜单迁至搜索框左侧定位组，工具栏不再有排序入口（无占位空洞）
  assert.ok(!head.includes('id="reqSort"'), '工具栏不得再含 #reqSort（已迁至 #pageHead 定位组）');
  assert.doesNotMatch(head, /sort-placeholder|排序占位/, '不得遗留排序占位');
  // 两行结构根除（REQ-20260910-008 取消固定的第二行选择区）
  assert.doesNotMatch(htmlSrc, /id="selectRow"/, '不得再有 #selectRow 第二行容器');
  assert.doesNotMatch(htmlSrc, /caption-info|caption-select|caption-row/, '不得再有 .caption-info/.caption-select/.caption-row 行结构');
  assert.doesNotMatch(htmlSrc, /caption-divider/, '不得再有 .caption-divider 节点（悬挂分隔线根除）');
  assert.doesNotMatch(cssSrc, /\.caption-divider\s*\{/, 'style.css 应删除 .caption-divider 规则');
  assert.doesNotMatch(cssSrc, /\.caption-row\s*\{/, 'style.css 应删除 .caption-row 规则');
  // #reqCount 转条件提示：初始 hidden、无静态计数文案（普通「N 个条目」随 REQ-20260910-008 移除）
  const count = head.match(/<span id="reqCount"[^>]*>/);
  assert.ok(count, '#reqCount 节点保留（承载截断/搜索提示）');
  assert.match(count[0], /class="[^"]*\bhidden\b[^"]*"/, '#reqCount 初始应 hidden');
  assert.doesNotMatch(head, /个条目/, '工具栏不得残留静态「N 个条目」文案');
});

// C2 CSS 契约（REQ-20260910-008 单行工具栏）：行内 wrap 兜底；快捷入口空间足够时靠右；
// 右组不脱离选择区靠右（与全选/全不选连续）
t('C2 CSS 契约：.req-caption 单行 flex + flex-wrap:wrap（不再 column 两行）；#laneQuickEntry margin-left:auto（空间足够时靠右）；.sel-group 无 margin-left:auto（与全选/全不选连续，不靠右隔断）', () => {
  const capRule = cssSrc.match(/\.req-caption\s*\{[^}]*\}/);
  assert.ok(capRule, '应有 .req-caption 规则');
  assert.match(capRule[0], /display:\s*flex/, '列表头 flex 单行工具栏');
  assert.match(capRule[0], /flex-wrap:\s*wrap/, '宽度不足按组整体换行兜底');
  assert.doesNotMatch(capRule[0], /flex-direction:\s*column/, '不得再纵向固定两行（REQ-20260910-008 取消第二行）');
  const quickRule = cssSrc.match(/#laneQuickEntry\s*\{[^}]*\}/);
  assert.ok(quickRule, '应有 #laneQuickEntry 规则');
  assert.match(quickRule[0], /margin-left:\s*auto/, '快捷入口空间足够时靠右');
  const grpRule = cssSrc.match(/\.sel-group\s*\{[^}]*\}/);
  assert.ok(grpRule, '应有 .sel-group 规则');
  assert.match(grpRule[0], /flex-wrap:\s*wrap/, '右组内按钮必要时继续换行');
  assert.doesNotMatch(grpRule[0], /margin-left:\s*auto/, '右组不得 margin-left:auto 靠右（选择区需连续）');
});

// C3 选择控件按档显隐与勾选零跳变（REQ-20260910-008 单行工具栏口径）：选择档全选/全不选恒可见
// （勾选首项右组出现/消失不改变控件显隐，宽度足够时同行不增行）；非选择三档两按钮整体隐藏，无空占位；切档即时恢复
t('C3 控件显隐与稳定：三个选择档 #selectOperable/#selectNone 可见且不随勾选增删变化；开发中/待测试/已完成档两按钮隐藏（无 #selectRow 空占位行）；切回选择档恢复；#selGroup 仍按勾选显隐', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  // 待接受档：零勾选 → 勾选首项 → 清零：两按钮恒可见
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '待接受档全选可见');
  assert.equal(hidden(h, '#selectNone'), false, '待接受档全不选可见');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '勾选首项右组出现，全选仍可见（无结构跳变）');
  assert.equal(hidden(h, '#selGroup'), false, '右组按勾选出现');
  h.state.acceptance.selected.clear();
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '清零后右组消失，全选仍可见');
  assert.equal(hidden(h, '#selGroup'), true, '右组按勾选隐藏');
  // 已接受 / 已计划同理
  for (const lane of ['accepted', 'planned']) {
    h.state.reqFilter = lane;
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#selectOperable'), false, `${lane} 档全选可见`);
    assert.equal(hidden(h, '#selectNone'), false, `${lane} 档全不选可见`);
  }
  // 非选择三档：两按钮整体隐藏（单行工具栏下无空占位）
  for (const lane of ['developing', 'confirming', 'done']) {
    h.state.reqFilter = lane;
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#selectOperable'), true, `${lane} 档全选应隐藏`);
    assert.equal(hidden(h, '#selectNone'), true, `${lane} 档全不选应隐藏`);
    assert.equal(hidden(h, '#selGroup'), true, `${lane} 档右组应隐藏`);
  }
  // 切回选择档即时恢复
  h.state.reqFilter = 'accepted';
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '切回已接受档全选恢复显示');
  assert.equal(hidden(h, '#selectNone'), false, '切回已接受档全不选恢复显示');
});

// C4 既有契约归位抽查：快捷入口在工具栏内（全选之后、仍在列表头内、零勾选可见口径不变）；
// 合并意图保留（无独立操作条 / 无清空选择）；排序已迁出工具栏（REQ-20260910-016）
t('C4 契约归位：#laneQuickEntry 位于 #reqCaption 工具栏内、#selectOperable 之后（REQ-20260909-007 常驻口径迁移至单行工具栏；排序随 REQ-20260910-016 迁至 #pageHead 定位组）；无 #selectionBar / clearSelection（REQ-20260909-002 合并意图保留）；零勾选快捷入口可见、全选可见', () => {
  const caption = htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="reqList"/);
  assert.ok(caption, '应存在列表头 #reqCaption');
  const head = caption[0];
  assert.ok(head.indexOf('id="laneQuickEntry"') > head.indexOf('id="selectOperable"'), '快捷入口应位于工具栏全选之后');
  assert.ok(!head.includes('id="reqSort"'), '工具栏不得再含 #reqSort（REQ-20260910-016 迁至定位组）');
  assert.doesNotMatch(htmlSrc, /id="selectionBar"/, '不得回退出独立操作条');
  assert.doesNotMatch(htmlSrc, /clearSelection/, '不得回退出「清空选择」');
  assert.doesNotMatch(source, /clearSelection/, 'app.js 不得回退 clearSelection');
  // 动态：已接受档零勾选——快捷入口可见（常驻口径）、全选可见、右组隐藏
  const h = setup();
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '零勾选快捷入口仍常驻可见');
  assert.equal(hidden(h, '#selectOperable'), false, '零勾选全选可见');
  assert.equal(hidden(h, '#selGroup'), true, '零勾选右组隐藏');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
