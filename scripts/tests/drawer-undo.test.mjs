#!/usr/bin/env node
// REQ-20260906-014 契约测试 —— 详情页操作按钮免二次确认 + 撤销按钮。
// 用法：node scripts/tests/drawer-undo.test.mjs
// 覆盖 test-cases.md 的 T1–T7；M1 为浏览器人工核验。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSITIONS } from '../lib/core.mjs';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

// 压平 CSS（去注释/空白），同 confirm-lane.test.mjs
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
// 由测试显式 seed（#toast），保证真实 toast 可被驱动
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
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  const seed = (selector, el) => document.nodes.set(selector, el);
  const toastEl = element();
  seed('#toast', toastEl);
  const requests = [], confirmations = [];
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
  // BUG-20260907-009：二次确认改页面内异步 uiConfirm；stub 记录弹窗文案并视为确认
  sandbox.recordConfirm = (text) => confirmations.push(text);
  run('uiConfirm = (o) => { recordConfirm(`${o.title}\n${o.message || ""}`); return true; };');
  run('poll = async () => { pollN++; }; pollN = 0; refreshDrawer = async () => { drawerN++; }; drawerN = 0;');
  return { sandbox, document, state, run, requests, confirmations, seed, toastEl };
}

const item = (id, status) => ({ id, type: 'requirement', status, parent: null, title: id });

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 详情页确认完成/驳回完成：零二次确认、立即 POST，成功 toast 带「撤销」', async () => {
  const h = setup();
  await h.run("drawerAction('REQ-20990101-004', 'done')");
  assert.equal(h.confirmations.length, 0, '详情页确认完成不得弹 window.confirm');
  assert.equal(h.requests.length, 1, '点击应立即发起流转请求');
  assert.match(h.requests[0].url, /\/api\/item\/REQ-20990101-004\/status\?project=%2Fproject%2Fa$/);
  assert.equal(h.requests[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[0].opts.body), { to: 'done' });
  assert.ok(h.toastEl.children.length >= 2, '成功 toast 应含文本与撤销按钮');
  assert.match(h.toastEl.children[0].textContent, /已确认完成/, '应提示已确认完成');
  assert.equal(h.toastEl.children[1].textContent, '撤销');
  await h.run("drawerAction('REQ-20990101-005', 'in-progress', '驳回完成（退回开发）')");
  assert.equal(h.confirmations.length, 0, '驳回完成同样免二次确认');
  assert.deepEqual(JSON.parse(h.requests.at(-1).opts.body), { to: 'in-progress' });
});

t('T2 撤销映射契约：done↔in-progress 且与后端状态机一致；接受可撤销（REQ-20260907-011 驳回接受）', async () => {
  const h = setup();
  const undo = h.run('ACTION_UNDO');
  assert.ok(undo, '应定义 ACTION_UNDO 撤销映射');
  // REQ-20260910-011：补 submitted（撤销驳回接受 = 重新接受），四类免确认流转单条入口均可回退
  assert.deepEqual(Object.keys(undo).sort(), ['accepted', 'done', 'in-progress', 'planned', 'submitted'], 'done/in-progress/accepted/submitted/planned 五类可撤销');
  assert.equal(undo['done'].to, 'in-progress', '撤销确认完成 = 驳回完成');
  assert.equal(undo['in-progress'].to, 'done', '撤销驳回完成 = 重新确认完成');
  assert.equal(undo['accepted'].to, 'submitted', '撤销接受 = 驳回接受（REQ-20260907-011）');
  assert.equal(undo['submitted'].to, 'accepted', '撤销驳回接受 = 重新接受（REQ-20260910-011）');
  // 每条撤销边必须是 core.TRANSITIONS 合法边（防止前端映射跑赢状态机）
  for (const [from, u] of Object.entries(undo)) {
    assert.ok(TRANSITIONS[from]?.includes(u.to), `撤销边 ${from} → ${u.to} 必须是后端合法流转`);
  }
  const a = h.run("undoActionFor('REQ-1', 'accepted')");
  assert.equal(a.label, '撤销', '接受提供撤销');
  const d = h.run("undoActionFor('REQ-1', 'done')");
  assert.equal(d.label, '撤销');
  assert.equal(typeof d.run, 'function');
});

t('T3 toast 操作按钮：textContent 组装、点击隐藏并执行 run；无 action 保持纯文本', async () => {
  const h = setup();
  h.sandbox.undoRan = 0;
  await h.run("toast('✓ REQ-1 已确认完成', false, { label: '撤销', run: async () => { undoRan++; } })");
  assert.equal(h.toastEl.classList.contains('hidden'), false, 'toast 应显示');
  assert.equal(h.toastEl.children.length, 2, '应为文本 + 按钮两个节点');
  assert.equal(h.toastEl.children[0].textContent, '✓ REQ-1 已确认完成', '文本用 textContent 组装（无注入面）');
  const btn = h.toastEl.children[1];
  assert.equal(btn.textContent, '撤销');
  assert.match(String(btn.className), /toast-act/, '按钮应有 toast-act 类');
  await btn.listeners.click();
  assert.equal(h.sandbox.undoRan, 1, '点击撤销应执行 run');
  assert.equal(h.toastEl.classList.contains('hidden'), true, '点击后应隐藏 toast');
  // 无 action：旧契约不回归（纯文本、不留按钮）
  h.run("toast('普通提示', true)");
  assert.equal(h.toastEl.textContent, '普通提示');
  assert.equal(h.toastEl.children.length, 0, '纯文本 toast 不得残留按钮节点');
  assert.equal(h.toastEl.classList.contains('err'), true);
});

t('T4 详情页与批量接受：均免二次确认（REQ-20260910-011），复用 acceptItems 提交路径', async () => {
  const h = setup();
  h.state.board = { initialized: true, items: [item('REQ-20990101-001', 'submitted'), item('REQ-20990101-002', 'submitted')] };
  await h.run("drawerAction('REQ-20990101-001', 'accepted')");
  assert.equal(h.confirmations.length, 0, '详情页接受不得二次确认');
  assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(h.requests[0].opts.body), { to: 'accepted' });
  assert.match(h.state.acceptance.message, /REQ-20990101-001 已接受/, '单条路径文案带单号且 toast 附撤销');
  await h.run("acceptItems(['REQ-20990101-002'])");
  assert.equal(h.confirmations.length, 0, '批量接受入口同样免二次确认（REQ-20260910-011）');
  assert.deepEqual(JSON.parse(h.requests.at(-1).opts.body), { to: 'accepted' });
});

t('T5 点击撤销：POST 反向状态并刷新；失败错误提示不假成功', async () => {
  const h = setup();
  const a = h.run("undoActionFor('REQ-20990101-004', 'done')");
  await a.run();
  assert.deepEqual(JSON.parse(h.requests.at(-1).opts.body), { to: 'in-progress' }, '撤销确认完成应驳回回开发');
  assert.ok(h.run('pollN') >= 1, '撤销后应刷新看板');
  assert.match(h.toastEl.children[0]?.textContent ?? h.toastEl.textContent, /已撤销/, '应有撤销成功提示');
  const b = h.run("undoActionFor('REQ-20990101-005', 'in-progress')");
  await b.run();
  assert.deepEqual(JSON.parse(h.requests.at(-1).opts.body), { to: 'done' }, '撤销驳回应重新确认完成');
  // 失败路径：状态已被变更等服务端拒绝
  h.sandbox.fetch = async () => ({ ok: false, json: async () => ({ error: '非法流转：done → submitted' }) });
  const c = h.run("undoActionFor('REQ-20990101-006', 'done')");
  await c.run(); // 不得抛出
  assert.equal(h.toastEl.classList.contains('err'), true, '失败应以错误 toast 提示');
  assert.match(h.toastEl.textContent, /非法流转/, '错误文案应透传');
});

t('T6 静态契约：抽屉 [data-act] 换绑 drawerAction；attemptTransition 保留二次确认（BUG-20260907-009 起为页面内 uiConfirm）', async () => {
  const bind = source.match(/for \(const b of drawer\.querySelectorAll\('\[data-act\]'\)\)[\s\S]{0,300}?\n  \}/);
  assert.ok(bind, '抽屉应存在 [data-act] 按钮绑定');
  assert.match(bind[0], /drawerAction\(/, '详情页按钮应绑定 drawerAction（免确认）');
  assert.doesNotMatch(bind[0], /attemptTransition\(/, '详情页按钮不得再走 attemptTransition');
  const fn = source.match(/async function attemptTransition[\s\S]*?\n}/);
  assert.ok(fn, 'attemptTransition 应保留（换列/卡片路径）');
  assert.match(fn[0], /await uiConfirm\(/, '卡片/换列路径的二次确认不应回归丢失（页面内对话框）');
  assert.doesNotMatch(fn[0], /window\.confirm\(/, '不得使用阻塞式 window.confirm');
  assert.match(source, /acceptItems\(\[id\], \{ single: true \}\)/, '详情页接受应走单条路径（免确认 + toast 撤销，REQ-20260910-011）');
});

t('T7 CSS：.toast 行内按钮布局与 .toast-act 样式', () => {
  assert.match(rule('.toast'), /display:\s*flex/, 'toast 应为行内 flex 布局容纳按钮');
  assert.match(rule('.toast'), /align-items:\s*center/, '垂直居中');
  assert.match(rule('.toast'), /gap:\s*\d+px/, '文本与按钮间应有间距');
  const act = rule('.toast-act');
  assert.match(act, /margin-left:\s*12px|margin-left:\s*10px/, '按钮与文本留白');
  assert.match(act, /cursor:\s*pointer/, '按钮可点击');
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
