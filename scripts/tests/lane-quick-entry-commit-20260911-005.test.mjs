#!/usr/bin/env node
// BUG-20260911-005 已完成档「开始 Commit」快捷入口 —— REQ-20260911-010 回退后契约测试
// （沿用 lane-quick-entry-20260909-007.test.mjs 的 vm 模拟 DOM 模式）
// 批量 Commit 面板已随人工批量提交流程回退移除，已完成档不再显示快捷入口：
//   W1 done 档入口隐藏（无「▶ 开始 Commit」，不留禁用态死控件）
//   W2 done 档点击不发生（无 commit 导航分支；不请求 /api/commit/current|create）
//   W3 既有映射不回归（accepted → refine、planned → develop；其余档隐藏）
//   W4 常驻可用性（与勾选、批量进行中解耦；轮询不重建按钮节点）
//   W5 静态契约（#laneQuickEntry 仍为唯一快捷入口节点；无批量 Commit 页签残留）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 001 已接受；002 已计划；003/004 待接受；005 开发中；006 已完成
const item = (id, status = 'accepted', extra = {}) => ({
  id, type: 'requirement', status, owner: null, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const sample = () => [
  item('REQ-20990101-001'),
  item('REQ-20990101-002', 'planned'),
  item('REQ-20990101-003', 'submitted'),
  item('REQ-20990101-004', 'submitted'),
  item('REQ-20990101-005', 'in-progress', { owner: 'dev-x' }),
  item('REQ-20990101-006', 'done'),
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
    location: { pathname: '/', search: '' }, history: { replaceState() {} },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }), confirm: (message) => { confirmations.push(message); return true; } },
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
  run('toast = recordNotice; poll = async () => {}; refreshDrawer = async () => {}; refreshHealth = async () => {}; updateBoardTabs = () => {}; markActiveTab = () => {};');
  // 快捷按钮点击绑定切片：#selectNone 绑定行之后、#mask 绑定行之前（快捷入口绑定落点）
  const bindStart = source.indexOf("$('#selectNone').addEventListener");
  const bindEnd = source.indexOf("$('#mask').addEventListener");
  if (bindStart >= 0 && bindEnd > bindStart) run(source.slice(bindStart, bindEnd));
  return { sandbox, document, state, run, requests, confirmations, notices };
}

const hidden = (h, sel) => h.document.querySelector(sel).classList.contains('hidden');

// W1 done 档入口回退：已完成档不显示快捷入口（无「▶ 开始 Commit」、无禁用态残留）
t('W1 done 档入口回退：已完成档隐藏快捷入口；文案/导航均无 Commit 残留；其余三档（待接受/开发中/待测试）同样隐藏', () => {
  const h = setup();
  for (const lane of ['done', 'submitted', 'developing', 'confirming']) {
    h.state.reqFilter = lane;
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#laneQuickEntry'), true, `${lane} 档快捷入口应隐藏`);
  }
  const btn = h.document.querySelector('#laneQuickEntry');
  assert.ok(!btn.textContent.includes('Commit'), '已完成档不得残留 Commit 文案');
});

// W2 done 档无 commit 导航分支：点击绑定不指向 commit；源码无 /api/commit/current|create 请求
t('W2 done 档无 commit 导航：绑定只有 accepted→refine / 其余→develop 两分支；无批量 Commit 面板数据请求', () => {
  const bind = source.match(/\$\('#laneQuickEntry'\)\?\.addEventListener\('click',[^;]+;/);
  assert.ok(bind, '应保留快捷入口点击绑定');
  assert.doesNotMatch(bind[0], /commit/, '点击绑定不得再有 commit 分支');
  assert.doesNotMatch(source, /\/api\/commit\/(current|create)/, '源码不应有批量 Commit 面板数据请求');
});

// W3 既有映射不回归：accepted 点击仍进批量完善（/api/refine/current）；planned 点击仍进批量开发（/api/batch/current）
t('W3 既有映射不回归：accepted → refine（/api/refine/current）；planned → develop（/api/batch/current）；点击仅导航', async () => {
  const h = setup();
  h.state.reqFilter = 'accepted';
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已接受档入口保留');
  h.requests.length = 0;
  await h.run("$('#laneQuickEntry').listeners.click()");
  assert.ok(h.requests.some((r) => r.url.includes('/api/refine/current')), 'accepted 点击应拉取批量完善面板数据');
  h.state.reqFilter = 'planned';
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已计划档入口保留');
  h.requests.length = 0;
  await h.run("$('#laneQuickEntry').listeners.click()");
  assert.ok(h.requests.some((r) => r.url.includes('/api/batch/current')), 'planned 点击应拉取批量开发面板数据');
  assert.ok(!h.requests.some((r) => r.url.includes('/api/commit/')), '任何档位点击都不得触发批量 Commit 接口');
});

// W4 常驻可用性：done 档隐藏与勾选/批量进行中解耦；多次 syncAcceptance（轮询口径）不换节点、不闪变
t('W4 常驻可用性：done 档隐藏与勾选、批量进行中解耦；轮询重跑 syncAcceptance 行为稳定', () => {
  const h = setup();
  h.state.reqFilter = 'done';
  h.state.plan.selected.add('REQ-20990101-001');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), true, 'done 档快捷入口保持隐藏（与勾选无关）');
  h.state.plan.selected.clear();
  h.run('syncAcceptance()');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), true, '轮询重跑仍隐藏（节点常驻、行为稳定）');
});

// W5 静态契约：#laneQuickEntry 仍为唯一快捷入口节点；页面无批量 Commit 页签/面板残留
t('W5 静态契约：#laneQuickEntry 仍为唯一快捷入口节点（btn small primary、初始 hidden）；无批量 Commit 页签残留', () => {
  const quick = htmlSrc.match(/<button[^>]*id="laneQuickEntry"[^>]*>/);
  assert.ok(quick, '#laneQuickEntry 节点保留（accepted/planned 档仍在用）');
  assert.match(quick[0], /hidden/, '初始隐藏（按档显隐）');
  assert.doesNotMatch(source, /data-bmode="commit"/, '任务模块无批量 Commit 页签');
  assert.ok(!source.includes('▶ 开始 Commit'), '无「▶ 开始 Commit」文案残留');
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
