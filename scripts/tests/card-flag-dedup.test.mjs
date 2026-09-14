#!/usr/bin/env node
// BUG-20260907-010 契约测试 —— 已上报条目卡片标记去重（lane 状态 chip 与「待测试」角标不叠加），
// done 态不残留角标/横幅（该半部分已由 REQ-20260907-005 收敛，此处回归防退化）。
// BUG-20260909-004：六档列表行不再渲染 lane 状态 chip，卡片「待测试」归零（去重目标升级为移除）。
// 详情页（抽屉头部、下属 Bug 列表）无 lane 状态 chip，角标语义保留，防止卡片去重误伤。
// 用法：node scripts/tests/card-flag-dedup.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
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
const REPORTED = '2026-09-06T08:00:00.000Z';
const count = (html, s) => html.split(s).length - 1;

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

t('T1 卡片去重（核心）：上报未确认行不出现「待测试」——lane 状态 chip 已随 BUG-20260909-004 六档去重移除，也不叠加 flag 角标', () => {
  const h = setup();
  setItem(h, item('R1', 'in-progress', { agentCompletedAt: REPORTED }));
  const html = h.run('reqRowEl(testItem)').innerHTML;
  assert.equal(count(html, '待测试'), 0, `上报未确认卡片「待测试」应 0 次（chip 已移除且不叠加角标），实际 ${count(html, '待测试')} 次`);
  assert.doesNotMatch(html, /class="state s-/, '列表行不应再渲染 lane 状态 chip（BUG-20260909-004）');
  assert.doesNotMatch(html, /class="flag">待测试</, '卡片不得再叠加「待测试」flag 角标（BUG-20260907-010 现象 1）');
});

t('T2 未上报行：无状态 chip、无「待测试」标记', () => {
  const h = setup();
  setItem(h, item('R2', 'in-progress'));
  const html = h.run('reqRowEl(testItem)').innerHTML;
  assert.doesNotMatch(html, /class="state s-/, '未上报行不应再渲染状态 chip（BUG-20260909-004）');
  assert.doesNotMatch(html, /待测试|class="flag"/, '未上报行不应出现任何「待测试」或 flag 角标');
});

t('T3 已完成卡片：无状态 chip、无「待测试」角标（BUG-20260907-010 现象 2 卡片回归，agentCompletedAt 保留为上报事实）', () => {
  const h = setup();
  setItem(h, item('R3', 'done', { agentCompletedAt: REPORTED }));
  const html = h.run('reqRowEl(testItem)').innerHTML;
  assert.doesNotMatch(html, /class="state s-/, '已完成行不应再渲染状态 chip（BUG-20260909-004）');
  assert.doesNotMatch(html, /待测试/, '已完成卡片不应残留「待测试」标记');
});

t('T4 详情页语义保留：上报未确认抽屉有 flag 与上报提示；已完成抽屉两者皆无（现象 2 详情回归）', () => {
  const h = setup();
  const drawer = drawerSetup(h);
  setItem(h, item('R4', 'in-progress', { agentCompletedAt: REPORTED }));
  h.run('renderDrawer()');
  assert.match(drawer.innerHTML, /class="flag">待测试</, '上报未确认详情头部应保留「待测试」flag（无 lane chip，不重复）');
  assert.match(drawer.innerHTML, /Agent 已上报完成[\s\S]*?请人工测试/, '上报未确认详情应保留「已上报完成…请人工测试」横幅');
  setItem(h, item('R5', 'done', { agentCompletedAt: REPORTED }));
  h.run('renderDrawer()');
  assert.doesNotMatch(drawer.innerHTML, /class="flag">待测试</, '已完成详情头部不应有「待测试」flag');
  assert.doesNotMatch(drawer.innerHTML, /Agent 已上报完成/, '已完成详情不应残留上报待确认横幅');
});

t('T5 详情页下属 Bug 列表：上报未确认 Bug 行保留「待测试」角标（卡片去重不误伤无状态 chip 的列表）', () => {
  const h = setup();
  const drawer = drawerSetup(h);
  setItem(h, item('R6', 'in-progress', {
    agentCompletedAt: REPORTED, bugCount: 1, openBugCount: 1,
    bugs: [{ id: 'BUG-20990101-009', title: 'b9', status: 'in-progress', agentCompletedAt: REPORTED }],
  }));
  h.run('renderDrawer()');
  const bugRows = drawer.innerHTML.match(/data-goto="BUG-[^"]*"[\s\S]*?<\/li>/g) || [];
  assert.equal(bugRows.length, 1, '应渲染一条下属 Bug');
  assert.match(bugRows[0], /class="flag">待测试</, '上报未确认下属 Bug 行应保留「待测试」角标');
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
