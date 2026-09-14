#!/usr/bin/env node
// BUG-20260907-009 契约测试 —— 内置浏览器中同步 window.confirm 冻结整页：
// 三处二次确认改页面内异步对话框 uiConfirm（Promise 化，不阻塞主线程与轮询）。
// 用法：node scripts/tests/confirm-dialog.test.mjs
// 覆盖 test-cases.md 的 C1–C7；M1 为内置浏览器人工核验。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

// DOM 接缝：控件级 stub（accept-ui.test.mjs 同法），另支持 uiConfirm 用到的
// remove/focus/className/body；window keydown 监听可捕获驱动键盘路径
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, className: '', role: '',
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {}, removed: false, focused: false,
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    removeEventListener() {},
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    remove() { this.removed = true; },
    focus() { this.focused = true; },
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  const keydowns = [];
  const requests = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: {
      addEventListener: (ev, fn) => { if (ev === 'keydown') keydowns.push(fn); },
      removeEventListener: (ev, fn) => { if (ev === 'keydown') { const i = keydowns.indexOf(fn); if (i >= 0) keydowns.splice(i, 1); } },
    },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {};');
  return { sandbox, document, state, run, requests, keydowns };
}

const item = (id, status = 'submitted') => ({ id, type: 'requirement', status, parent: null, title: id });

// 从 document.body 尾部取当前确认框：{ overlay, box, cancelBtn, okBtn }
function currentDialog(h) {
  const overlay = h.document.body.children.at(-1);
  assert.ok(overlay, '确认框应挂载到 document.body');
  const box = overlay.children[0];
  const actions = box.children.at(-1);
  return { overlay, box, actions, cancelBtn: actions.children[0], okBtn: actions.children[1] };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('C1 静态契约：app.js 彻底移除 window.confirm/alert/prompt 调用，存在 uiConfirm 定义', () => {
  assert.doesNotMatch(source, /window\.confirm\(/, '不得调用 window.confirm（内置浏览器冻结根因）');
  assert.doesNotMatch(source, /window\.alert\(/, '不得调用 window.alert');
  assert.doesNotMatch(source, /window\.prompt\(/, '不得调用 window.prompt');
  assert.match(source, /function uiConfirm\(/, '应定义页面内确认对话框 uiConfirm');
});

t('C2 uiConfirm 契约：动态对话框、按钮文案来自参数、确认/取消/遮罩关闭、节点与监听清理', async () => {
  const h = setup();
  const p1 = h.run("uiConfirm({ title: '确定接受所选 3 条需求 / Bug？', message: 'REQ-1\\nREQ-2\\nREQ-3', confirmText: '接受' })");
  const d = currentDialog(h);
  assert.match(String(d.overlay.className), /confirm-wrap/, '覆盖层应有 confirm-wrap 类');
  assert.match(String(d.box.className), /confirm-box/, '对话框容器应有 confirm-box 类');
  assert.equal(d.box.children[0].textContent, '确定接受所选 3 条需求 / Bug？', '标题来自参数');
  assert.equal(d.box.children[1].textContent, 'REQ-1\nREQ-2\nREQ-3', '正文来自参数且保留换行');
  assert.equal(d.cancelBtn.textContent, '取消', '缺省取消文案');
  assert.equal(d.okBtn.textContent, '接受', '确认文案来自参数');
  assert.equal(d.okBtn.focused, true, '打开后应聚焦确认按钮（键盘可达）');
  d.okBtn.fire('click');
  assert.equal(await p1, true, '点确认 resolve(true)');
  assert.equal(d.overlay.removed, true, '关闭后覆盖层应移除');
  assert.equal(h.keydowns.length, 0, 'keydown 监听应解绑');
  // 取消按钮
  const p2 = h.run("uiConfirm({ title: 't', confirmText: 'ok' })");
  currentDialog(h).cancelBtn.fire('click');
  assert.equal(await p2, false, '点取消 resolve(false)');
  // 点击遮罩空白处取消
  const p3 = h.run("uiConfirm({ title: 't', confirmText: 'ok' })");
  const d3 = currentDialog(h);
  d3.overlay.fire('click'); // e.target === overlay
  assert.equal(await p3, false, '点遮罩空白应取消');
  // 点击对话框本体不误关
  const p4 = h.run("uiConfirm({ title: 't', confirmText: 'ok' })");
  const d4 = currentDialog(h);
  d4.box.fire('click'); // e.target === box ≠ overlay
  d4.okBtn.fire('click');
  assert.equal(await p4, true, '点对话框本体不得误关闭');
});

t('C3 键盘与互斥：Enter 确认、Escape 取消；新确认自动取消未决旧框', async () => {
  const h = setup();
  const p1 = h.run("uiConfirm({ title: '旧框', confirmText: 'ok' })");
  const key = (k) => h.keydowns.at(-1)({ key: k, preventDefault() {} });
  key('Escape');
  assert.equal(await p1, false, 'Escape 应取消');
  assert.equal(h.keydowns.length, 0, '取消后监听应解绑');
  const p2 = h.run("uiConfirm({ title: '新框', confirmText: 'ok' })");
  key('Enter');
  assert.equal(await p2, true, 'Enter 应确认');
  // 互斥：旧框未决时来新框，旧框 resolve(false) 且被移除，页面只剩一个覆盖层
  const p3 = h.run("uiConfirm({ title: 'A', confirmText: 'ok' })");
  const d3 = currentDialog(h);
  const p4 = h.run("uiConfirm({ title: 'B', confirmText: 'ok' })");
  assert.equal(await p3, false, '旧框应被自动取消');
  assert.equal(d3.overlay.removed, true, '旧框节点应移除');
  assert.equal(h.document.body.children.filter((c) => !c.removed).length, 1, '同时至多一个确认框');
  currentDialog(h).okBtn.fire('click');
  assert.equal(await p4, true);
});

t('C4 批量/单卡接受集成：REQ-20260910-011 起免二次确认，点击立即 POST 且不弹确认框', async () => {
  const h = setup();
  h.state.board = { initialized: true, items: [item('REQ-1'), item('REQ-2'), item('REQ-3')] };
  const before = h.document.body.children.length;
  await h.run("acceptItems(['REQ-1', 'REQ-2'])");
  assert.equal(h.requests.length, 2, '免确认后应立即逐条提交');
  assert.deepEqual(JSON.parse(h.requests[1].opts.body), { to: 'accepted' });
  assert.equal(h.document.body.children.length, before, '批量接受不得弹确认框（REQ-20260910-011）');
  // 单条入口（卡片 / 详情页）同样免确认直接提交
  await h.run("acceptItems(['REQ-3'], { single: true })");
  assert.equal(h.requests.length, 3);
  assert.equal(h.document.body.children.length, before, '单条入口不得弹确认框');
});

t('C5 流转按钮集成：attemptTransition 确认后 POST，取消无请求', async () => {
  const h = setup();
  const pCancel = h.run("attemptTransition('REQ-1', 'done', '确认完成')");
  const d = currentDialog(h);
  assert.match(d.box.children[0].textContent, /确认完成.*REQ-1/, '标题应含动作与条目');
  assert.equal(d.okBtn.textContent, '确认完成', '确认按钮文案应为动作名');
  d.cancelBtn.fire('click');
  await pCancel;
  assert.equal(h.requests.length, 0, '取消不得发流转请求');
  const pOk = h.run("attemptTransition('REQ-1', 'done', '确认完成')");
  currentDialog(h).okBtn.fire('click');
  await pOk;
  assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(h.requests[0].opts.body), { to: 'done' });
});

t('C6 停止执行入口：#cxStopCurrent 改用 uiConfirm（危险确认），不再 window.confirm', () => {
  const seg = source.match(/const stop = drawer\.querySelector\('#cxStopCurrent'\)[\s\S]{0,800}?\n  \}\);/);
  assert.ok(seg, '应存在 #cxStopCurrent 点击绑定');
  assert.match(seg[0], /await uiConfirm\(/, '停止执行应走页面内确认 uiConfirm');
  assert.doesNotMatch(seg[0], /window\.confirm\(/, '不得使用阻塞式 window.confirm');
  assert.match(seg[0], /danger:\s*true/, '停止执行是危险操作，确认按钮应为 danger 态');
  assert.match(seg[0], /确认回收后才释放占用/, '原确认文案信息不得丢失');
});

t('C7 CSS 契约：确认正文多行换行展示；danger 按钮样式', () => {
  assert.match(rule('.confirm-message'), /white-space:\s*pre-line/, '多行 ID 列表应按换行展示');
  const danger = rule('.btn.danger');
  assert.match(danger, /background:\s*var\(--warn\)/, '危险确认应使用警示色');
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
