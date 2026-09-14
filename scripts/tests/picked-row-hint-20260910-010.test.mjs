#!/usr/bin/env node
// BUG-20260910-010：列表行「详情打开中」标记（.picked）原为主题蓝边框 + 视图栏
// 靛紫左缘条（--primary / --viewrail-accent），界面零解释且深色下与「待测试」档紫
// 极易混淆。修复契约（README 期望方向 1）：
//   1. 保留标记，但 picked 行悬停提示在档位说明外补充「详情打开中（右侧抽屉正展示此条目）」；
//   2. 标记样式改中性 var(--text)，不再引用 --primary / --viewrail-accent；
//   3. 无回归：picked 恒与抽屉状态同步（listSig 含 drawer.id）；勾选行仍无主题蓝边框
//      （REQ-20260908-027 口径不变）。
// 用法：node scripts/tests/picked-row-hint-20260910-010.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const PICKED_HINT = '详情打开中（右侧抽屉正展示此条目）';

// DOM 接缝：控件级 stub（req-filter-removed.test.mjs 同法）
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
  return { sandbox, document, state, run };
}

const item = (id, status, extra = {}) => ({ id, type: 'requirement', status, parent: null, title: id, ...extra });

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 静态契约：.req-row.picked 用中性 var(--text)，不再引用 --primary / --viewrail-accent', () => {
  const m = css.match(/\.req-row\.picked\s*\{[^}]*\}/);
  assert.ok(m, 'style.css 应保留 .req-row.picked 规则（标记保留，不移除）');
  assert.match(m[0], /var\(--text\)/, 'picked 标记应使用中性前景色 var(--text)');
  assert.doesNotMatch(m[0], /var\(--primary\)/, 'picked 不得再引用主题蓝 --primary');
  assert.doesNotMatch(m[0], /var\(--viewrail-accent\)/, 'picked 不得复用视图切换栏专属强调色 --viewrail-accent');
});

t('T2 行为：picked 行 title 在档位说明外补充「详情打开中」，非 picked 行不受影响', () => {
  const h = setup();
  h.state.board = { initialized: true, items: [] };
  h.sandbox.testItem = item('REQ-20990101-001', 'planned');
  // 抽屉正展示该行：title = 档位说明 + 分隔 + 详情打开中说明
  h.state.drawer.id = 'REQ-20990101-001';
  const pickedEl = h.run('reqRowEl(testItem)');
  assert.match(pickedEl.title, new RegExp(LANE_HINT_ESC), 'picked 行 title 应保留档位说明');
  assert.ok(pickedEl.title.includes(PICKED_HINT), 'picked 行 title 应包含详情打开中说明');
  assert.ok(pickedEl.title.indexOf('已排入开发计划') < pickedEl.title.indexOf(PICKED_HINT), '档位说明应在详情打开中说明之前');
  // 抽屉关闭（或展示其他行）：title 回到仅档位说明
  h.state.drawer.id = null;
  const plainEl = h.run('reqRowEl(testItem)');
  assert.equal(plainEl.title, '已排入开发计划，开发启动后最旧优先处理', '非 picked 行 title 应仅为档位说明');
  assert.ok(!plainEl.title.includes(PICKED_HINT), '非 picked 行不得出现详情打开中说明');
});

t('T3 行为：picked class 恒与抽屉当前条目同步', () => {
  const h = setup();
  h.state.board = { initialized: true, items: [] };
  h.sandbox.testItem = item('REQ-20990101-001', 'planned');
  h.state.drawer.id = 'REQ-20990101-001';
  assert.match(h.run('reqRowEl(testItem)').className, /(^|\s)picked(\s|$)/, '抽屉展示行应带 picked class');
  h.state.drawer.id = 'REQ-20990101-999'; // 抽屉切到其他条目
  assert.doesNotMatch(h.run('reqRowEl(testItem)').className, /picked/, '非抽屉展示行不应带 picked class');
});

t('T4 防回归：listSig 含 drawer.id（关抽屉即重渲染去 picked）；勾选行仍无主题蓝边框', () => {
  // renderBoard 列表签名含 state.drawer.id：openDrawer/closeDrawer 均重置 listSig 强制重算，
  // 抽屉关闭后 picked 标记随重渲染消失（无需新逻辑，静态断言防回归）
  const sigSeg = js.slice(js.indexOf('const sig = JSON.stringify'), js.indexOf('const sig = JSON.stringify') + 300);
  assert.match(sigSeg, /state\.drawer\.id/, '列表重渲染签名应包含 state.drawer.id');
  assert.match(js, /function closeDrawer\(\)\s*\{[\s\S]*?state\.listSig = ''/, 'closeDrawer 应重置 listSig 强制重算行选中态');
  // REQ-20260908-027 口径不变：勾选行不得恢复主题蓝边框规则
  assert.doesNotMatch(css, /\.req-row\.selected/, '不得恢复 .req-row.selected 勾选边框规则');
});

// LANE_HINT['planned'] 文案中的正则转义
const LANE_HINT_ESC = '已排入开发计划，开发启动后最旧优先处理'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
