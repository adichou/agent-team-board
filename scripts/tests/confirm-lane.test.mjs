#!/usr/bin/env node
// REQ-20260906-013 契约测试 —— 在开发中和已完成之间增加待确认分类。
// REQ-20260907-005：分类文案「待确认」更名「待测试」，已完成（done）视图去掉角标与上报提示。
// BUG-20260907-010：T8 原「上报未确认行保留角标」断言随卡片去重调整——lane 状态 chip 已表达待测试，
// 卡片不再叠加 flag 角标（详情页角标语义保留，由 card-flag-dedup.test.mjs 覆盖）。
// BUG-20260909-004：列表行 lane 状态 chip 一并移除（六档去重），档位语义由筛选条与悬停提示承载。
// 用法：node scripts/tests/confirm-lane.test.mjs
// 覆盖 REQ-20260906-013 的 T1–T7 与 REQ-20260907-005 的 T8–T10；T11 由 npm test 全套聚合回归；M1 为浏览器人工核验。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// 压平 CSS（去注释/空白），同 layout.test.mjs
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

// DOM 接缝：控件级 stub（accept-ui.test.mjs 同法）；document 级选择器默认 null，
// 由测试显式 seed（#board / .board-tabs），保证 ensureBoardTabs 首次构建真实 tab 条
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
  // document 级选择器默认 null（ensureBoardTabs 首次构建真实 tab 条），可由 seed 显式注入
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  const board = element();
  seed('#board', board);
  const requests = [], confirmations = [], notices = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: (message) => { confirmations.push(message); return true; } },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  // 只压掉拖放链路尾部的刷新副作用；tab/计数函数保持真实实现
  // BUG-20260907-009：二次确认改页面内异步 uiConfirm；测试 stub 视为确认通过
  run('toast = recordNotice; poll = async () => {}; refreshDrawer = async () => {}; uiConfirm = async () => true;');
  return { sandbox, document, state, run, requests, confirmations, notices, seed, board };
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

t('T1 LANES 契约：六列顺序含 planned 与 confirming（REQ-20260908-010 / REQ-20260907-005 更名待测试）', () => {
  assert.match(source, /const LANES = \['submitted', 'accepted', 'planned', 'developing', 'confirming', 'done'\]/,
    '应定义六列 LANES，顺序：待接受/已接受/已计划/开发中/待测试/已完成');
  assert.match(source, /confirming: '待测试'/, 'confirming 列标签应为「待测试」（REQ-20260907-005）');
  // REQ-20260907-005 意图收窄（REQ-20260909-015）：状态/分栏标签不得再用「待确认」；
  // 开源许可页签未知许可的「待确认」标识是 licenses.md 警示新域文案，不在本口径内。
  const labelDef = (re) => {
    const m = source.match(re);
    assert.ok(m, `应存在标签定义 ${re}`);
    return m[0];
  };
  for (const block of [/const STATE_LABEL = \{[\s\S]*?\};/, /const LANE_LABEL = \{[\s\S]*?\};/, /const LANE_HINT = \{[\s\S]*?\};/]) {
    assert.doesNotMatch(labelDef(block), /待确认/, '状态/分栏标签不得残留「待确认」文案');
  }
  assert.match(source, /developing: '开发中'/, 'developing 列标签应为「开发中」');
  assert.match(source, /'in-progress': '开发中'/, 'STATE_LABEL 状态机文案不变（in-progress 仍为开发中）');
  assert.doesNotMatch(source, /pending-alignment/, '不得引入已回退的待对齐分类');
});

t('T2 laneOf 分组：上报与否决定 confirming/developing，其余状态原样', () => {
  const h = setup();
  const probe = (it) => { h.sandbox.testItem = it; return h.run('laneOf(testItem)'); };
  assert.equal(probe(item('R1', 'in-progress', { agentCompletedAt: '2026-09-06T08:00:00.000Z' })), 'confirming');
  assert.equal(probe(item('R2', 'in-progress', { agentCompletedAt: null })), 'developing');
  assert.equal(probe(item('R3', 'in-progress')), 'developing');
  assert.equal(probe(item('R4', 'submitted')), 'submitted');
  assert.equal(probe(item('R5', 'accepted')), 'accepted');
  assert.equal(probe(item('R6', 'done')), 'done');
});

t('T3 筛选档位恢复五档无「全部」（BUG-20260907-016）：renderFilterBar 存在；列表行不再渲染档位状态 chip（BUG-20260909-004）', () => {
  const h = setup();
  h.state.board = { initialized: true, items: sample() };
  assert.ok('renderFilterBar' in h.sandbox, 'renderFilterBar 应随筛选条恢复');
  assert.match(source, /const REQ_FILTERS = LANES\.map\(\(lane\) => \(\{ key: lane, label: LANE_LABEL\[lane\] \}\)\);/, 'REQ_FILTERS 由六档 LANES 派生且无其余档');
  const barSeg = source.slice(source.indexOf('function renderFilterBar'), source.indexOf('function reqRowEl'));
  assert.doesNotMatch(barSeg, /全部|'all'/, 'chips 渲染不得含「全部」档');
  // 列表行不再渲染与档位重复的状态 chip：档位语义由筛选条承载，悬停提示仍按 laneOf 派生（T6）
  h.sandbox.testItem = item('R1', 'in-progress', { agentCompletedAt: '2026-09-06T08:00:00.000Z' });
  assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /class="state s-|>待测试</, '上报列表行不应渲染状态 chip 或档位文字');
  h.sandbox.testItem = item('R2', 'in-progress');
  assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /class="state s-|>开发中</, '未上报列表行不应渲染状态 chip 或档位文字');
});

t('T4 状态流转：看板拖拽已随布局移除；流转走详情按钮路径（in-progress / done 可达）', async () => {
  // REQ-20260907-004：列表模式无拖拽换列；confirming 仍只能由 Agent 上报进入
  assert.doesNotMatch(source, /LANE_DROP_STATUS/, '不得恢复看板拖拽换列映射');
  assert.doesNotMatch(source, /addEventListener\('drop'/, '不得残留列 drop 监听');
  assert.match(source, /function attemptTransition/, '状态流转仍经 attemptTransition（详情按钮路径）');
  const h = setup();
  await h.run("attemptTransition('REQ-20990101-004', 'in-progress')");
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /\/api\/item\/REQ-20990101-004\/status/);
  assert.deepEqual(JSON.parse(h.requests[0].opts.body), { to: 'in-progress' });
  await h.run("attemptTransition('REQ-20990101-004', 'done')");
  assert.equal(h.requests.length, 2);
  assert.deepEqual(JSON.parse(h.requests[1].opts.body), { to: 'done' });
});

t('T5 筛选按档过滤（BUG-20260907-016）：默认待接受档，各 lane 派生仍由 laneOf 支撑', () => {
  const h = setup();
  h.state.board = { initialized: true, items: sample() };
  assert.equal(h.state.reqFilter, 'submitted', '默认选中第一档「待接受」');
  assert.equal(h.run('visibleItems().length'), 1, '默认档下仅待接受条目可见');
  assert.equal(h.run('visibleItems()[0].status'), 'submitted');
  const probe = (it) => { h.sandbox.testItem = it; return h.run('laneOf(testItem)'); };
  assert.equal(probe(item('REQ-20990101-004', 'in-progress', { agentCompletedAt: '2026-09-06T08:00:00.000Z' })), 'confirming', '上报条目仍派生 confirming（行状态展示）');
  assert.equal(probe(item('REQ-20990101-003', 'in-progress')), 'developing', '未上报条目仍派生 developing');
});

t('T6 卡片 tooltip：上报条目提示等待人工测试，未上报提示开发中（REQ-20260907-005）', () => {
  const h = setup();
  h.sandbox.testItem = item('R1', 'in-progress', { agentCompletedAt: '2026-09-06T08:00:00.000Z' });
  assert.match(h.run('reqRowEl(testItem)').title, /等待人工测试/);
  h.sandbox.testItem = item('R2', 'in-progress');
  assert.match(h.run('reqRowEl(testItem)').title, /开发中/);
});

// REQ-20260907-005：已完成（done）视图去掉待测试角标与上报提示；上报未确认（in-progress + agentCompletedAt）保留。
// done 条目的 agentCompletedAt 不清空（仅人工驳回清空），角标/提示渲染条件须显式排除 done。
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

t('T8 已完成列表行：无「待测试」角标；上报未确认行不再渲染 lane 状态 chip，也不叠加重复角标（BUG-20260907-010 / BUG-20260909-004）', () => {
  const h = setup();
  setItem(h, item('R1', 'done', { agentCompletedAt: '2026-09-06T08:00:00.000Z' }));
  assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /class="flag">待测试</, '已完成行不应有待测试角标');
  setItem(h, item('R2', 'in-progress', { agentCompletedAt: '2026-09-06T08:00:00.000Z' }));
  const html = h.run('reqRowEl(testItem)').innerHTML;
  assert.doesNotMatch(html, /class="state s-/, '上报未确认行不应渲染状态 chip（BUG-20260909-004 六档去重，档位由筛选条承载）');
  assert.doesNotMatch(html, /class="flag">待测试</, '卡片不得叠加重复「待测试」角标（BUG-20260907-010）');
});

t('T9 详情页：已完成无角标与「已上报完成」提示；上报未确认两者保留且提示改为人工测试（REQ-20260907-005）', () => {
  const h = setup();
  const drawer = drawerSetup(h);
  setItem(h, item('R1', 'done', { agentCompletedAt: '2026-09-06T08:00:00.000Z' }));
  h.run('renderDrawer()');
  assert.doesNotMatch(drawer.innerHTML, /class="flag">待测试</, '已完成详情头部不应有待测试角标');
  assert.doesNotMatch(drawer.innerHTML, /Agent 已上报完成/, '已完成详情不应再有上报待确认提示');
  setItem(h, item('R2', 'in-progress', { agentCompletedAt: '2026-09-06T08:00:00.000Z' }));
  h.run('renderDrawer()');
  assert.match(drawer.innerHTML, /class="flag">待测试</, '上报未确认详情头部应有待测试角标');
  assert.match(drawer.innerHTML, /Agent 已上报完成/, '上报未确认详情应有上报提示');
  assert.match(drawer.innerHTML, /请人工测试/, '上报提示应为人工测试语义（不再是请人工确认）');
});

t('T10 详情页下属 Bug：已完成 Bug 无角标；上报未确认 Bug 显示「待测试」角标（REQ-20260907-005）', () => {
  const h = setup();
  const drawer = drawerSetup(h);
  setItem(h, item('R1', 'in-progress', {
    agentCompletedAt: '2026-09-06T08:00:00.000Z', bugCount: 2, openBugCount: 2,
    bugs: [
      { id: 'BUG-20990101-001', title: 'b1', status: 'done', agentCompletedAt: '2026-09-06T08:00:00.000Z' },
      { id: 'BUG-20990101-002', title: 'b2', status: 'in-progress', agentCompletedAt: '2026-09-06T08:00:00.000Z' },
    ],
  }));
  h.run('renderDrawer()');
  const bugRows = drawer.innerHTML.match(/data-goto="BUG-[^"]*"[\s\S]*?<\/li>/g) || [];
  assert.equal(bugRows.length, 2, '应渲染两条下属 Bug');
  assert.doesNotMatch(bugRows[0], /class="flag">待测试</, '已完成 Bug 行不应有待测试角标');
  assert.match(bugRows[1], /class="flag">待测试</, '上报未确认 Bug 行应有待测试角标');
});

t('T7 CSS 契约：列表双栏网格无溢出；confirming 独立色；flag 配色一致', () => {
  // BUG-20260910-002：宽屏列表 : 详情改为恒定 1 : 2（详情为 2fr 主阅读区，不再固定 460px 上限）
  assert.match(rule('.req-split'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*2fr\)/, '需求工作区应为列表+详情双栏，比例 1 : 2');
  assert.match(rule('.s-confirming'), /--sc:\s*var\(--confirming\)/, '待确认档应用独立色 --confirming');
  assert.match(rule('.s-developing'), /--sc:\s*var\(--inprogress\)/, '开发中档沿用 --inprogress');
  assert.match(rule(':root'), /--confirming:\s*#[0-9a-f]{6}/, '亮色应定义 --confirming');
  const dark = flat.match(/prefers-color-scheme:\s*dark\)\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(dark, /--confirming:\s*#[0-9a-f]{6}/, '暗色应定义 --confirming');
  assert.match(rule('.flag'), /color:\s*var\(--confirming\)/, '「待测试」小旗应与状态色一致');
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
