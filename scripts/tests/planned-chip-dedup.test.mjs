#!/usr/bin/env node
// BUG-20260908-024 契约测试 —— 「已计划」档内列表卡片不再渲染与档位重复的「已计划」状态 chip。
// BUG-20260909-004 扩展为六档统一去重：列表按档过滤（applyReqFilter），任意档内的
// 卡片状态标签都与所在档位重复，无增量信息，六档一律不渲染状态 chip。
// planned 复选框/悬停提示、完善徽标、详情抽屉状态字段均不受影响。
// 用法：node scripts/tests/planned-chip-dedup.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// DOM 接缝：控件级 stub（card-flag-dedup.test.mjs 同法）
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

const item = (id, status, extra = {}) => ({ id, type: 'requirement', status, parent: null, title: `标题-${id}`, owner: 'zcode-x', ...extra });
const REPORTED = '2026-09-06T08:00:00.000Z';

function setItem(h, it) {
  h.sandbox.testItem = it;
}

function drawerSetup(h) {
  const drawer = element();
  h.seed('#drawer', drawer);
  h.seed('#drawerClose', element()); // renderDrawer 尾部直接绑定 closeDrawer，需真实节点
  h.run('syncAcceptance=()=>{}; batchSettingsHtml=()=>""; bindBatchSettings=()=>{};');
  return drawer;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 核心收敛：planned 卡片不再渲染「已计划」状态 chip（与所在档位重复），其余卡片信息保留', () => {
  const h = setup();
  setItem(h, item('REQ-20990101-001', 'planned'));
  const row = h.run('reqRowEl(testItem)');
  assert.doesNotMatch(row.innerHTML, /class="state s-planned"/, 'planned 卡片不应再渲染「已计划」状态 chip（BUG-20260908-024）');
  assert.doesNotMatch(row.innerHTML, />已计划</, '卡片内不应出现「已计划」文本节点');
  assert.match(row.innerHTML, /data-impl-id=/, 'planned 卡片复选框（移出计划）应保留');
  assert.match(row.innerHTML, /REQ-20990101-001/, '单号应保留');
  assert.match(row.innerHTML, /标题-REQ-20990101-001/, '标题应保留');
  assert.match(row.innerHTML, /zcode-x/, '认领者展示位应保留');
  assert.match(row.innerHTML, /m-time/, '更新时间应保留');
});

t('T2 其余五档统一去重（BUG-20260909-004）：列表行不再渲染任何与档位重复的状态 chip，REQ / BUG 同口径', () => {
  const h = setup();
  const rows = [
    [item('REQ-20990101-002', 'submitted'), />待接受</],
    [item('REQ-20990101-003', 'accepted'), />已接受</],
    [item('REQ-20990101-004', 'in-progress'), />开发中</],
    [item('REQ-20990101-005', 'in-progress', { agentCompletedAt: REPORTED }), />待测试</],
    [item('REQ-20990101-006', 'done'), />已完成</],
    [item('BUG-20990101-010', 'in-progress', { agentCompletedAt: REPORTED, type: 'bug' }), />待测试</],
  ];
  for (const [it, re] of rows) {
    setItem(h, it);
    const html = h.run('reqRowEl(testItem)').innerHTML;
    assert.doesNotMatch(html, /class="state s-/, `${it.id} 列表行不应再渲染状态 chip（BUG-20260909-004 六档去重）`);
    assert.doesNotMatch(html, re, `${it.id} 列表行不应出现与所在档位重复的档位文字`);
  }
});

t('T2b 样式清理：reqRowEl 不再输出 .state chip 后，style.css 移除仅服务于列表行的 .req-row .state 规则', () => {
  const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  assert.doesNotMatch(css, /\.req-row \.state\s*\{/, '.req-row .state 规则失去引用应删除（详情抽屉 .state 由通用 span.state 承载）');
});

t('T3 行悬停提示保留：planned 行 title 仍为 LANE_HINT.planned（状态语义不丢失）', () => {
  const h = setup();
  setItem(h, item('REQ-20990101-007', 'planned'));
  const row = h.run('reqRowEl(testItem)');
  assert.equal(row.title, h.run('LANE_HINT["planned"]'), 'planned 行悬停提示应保留');
  assert.match(row.title, /已排入开发计划/, '悬停提示应仍说明已计划语义');
});

t('T4 详情抽屉回归：planned 条目详情状态字段仍显示「已计划」（抽屉可从任意入口打开，状态是必要上下文）', () => {
  const h = setup();
  const drawer = drawerSetup(h);
  const it = item('REQ-20990101-008', 'planned');
  h.state.board = { initialized: true, items: [it] };
  h.state.drawer.id = it.id;
  h.state.drawer.item = it;
  h.state.drawer.navIds = null;
  h.run('renderDrawer()');
  assert.match(drawer.innerHTML, /<label>状态<\/label><span class="state s-planned">已计划</, '详情抽屉状态字段应不受卡片收敛影响');
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
