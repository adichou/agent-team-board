#!/usr/bin/env node
// REQ-20260910-011 契约测试 —— 接受 / 驳回待接受 / 移入计划 / 移出计划四个可回退流转
// 去二次确认（免确认 + toast 撤销范式从详情页扩展到卡片与批量入口）；删除等不可撤销
// 操作的确认保留。用法：node scripts/tests/no-confirm-undo-20260910-011.test.mjs
// 覆盖 test-cases.md 的 N1–N9；M1 为内置浏览器人工核验。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSITIONS } from '../lib/core.mjs';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// 取整个函数源码块（含函数头，止于列首 }）：静态契约用
function fnBlock(name) {
  const m = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `应存在函数 ${name}`);
  return m[0];
}

// DOM 接缝：控件级 stub（accept-ui / drawer-undo 同法）；seed #toast 让真实 toast 可驱动
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    removeEventListener() {},
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  const seed = (selector, el) => document.nodes.set(selector, el);
  const toastEl = element();
  seed('#toast', toastEl);
  const requests = [], confirmations = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [
    { id: 'REQ-20990101-001', type: 'requirement', status: 'submitted', parent: null, title: '待接受单' },
    { id: 'REQ-20990101-002', type: 'requirement', status: 'accepted', parent: null, title: '已接受单' },
    { id: 'REQ-20990101-003', type: 'requirement', status: 'planned', parent: null, owner: null, title: '已计划单' },
    { id: 'REQ-20990101-004', type: 'requirement', status: 'accepted', parent: null, title: '已接受单二' },
  ] };
  // uiConfirm stub：记录弹窗参数并按当前返回值应答——被测路径不得触发（confirmations 应为空）
  sandbox.recordConfirm = (o) => confirmations.push(o);
  run('uiConfirm = (o) => { recordConfirm(o); return uiConfirmResult; }; uiConfirmResult = true;');
  run('poll = async () => {}; refreshDrawer = async () => {}; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {};');
  return { sandbox, document, state, run, requests, confirmations, seed, toastEl };
}

const statusPosts = (h) => h.requests.filter((r) => /\/api\/item\/[^/]+\/status/.test(r.url));
const lastBody = (h) => JSON.parse(statusPosts(h).at(-1).opts.body);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('N1 静态契约：四个流转函数零 uiConfirm / skipConfirm；deleteItem 保留 danger 确认', () => {
  for (const name of ['acceptItems', 'moveToPlan', 'rejectToSubmitted', 'removeFromPlan']) {
    const fn = fnBlock(name);
    assert.doesNotMatch(fn, /uiConfirm/, `${name} 不得再弹二次确认（REQ-20260910-011）`);
    assert.doesNotMatch(fn, /skipConfirm/, `${name} 应移除 skipConfirm 参数（确认已整体去除）`);
  }
  const del = fnBlock('deleteItem');
  assert.match(del, /uiConfirm\(/, '删除是看板层面不可撤销操作，须保留二次确认');
  assert.match(del, /danger:\s*true/, '删除确认应为 danger 态');
  assert.match(del, /删除 \$\{id\}？/, '删除确认标题应显示单号');
});

t('N2 单条接受：零确认立即 POST；toast「✓ {单号} 已接受」带撤销，点击走驳回接受回退', async () => {
  const h = setup();
  await h.run("acceptItems(['REQ-20990101-001'], { single: true })");
  assert.equal(h.confirmations.length, 0, '单条接受不得弹二次确认');
  assert.equal(statusPosts(h).length, 1, '点击应立即发起流转请求');
  assert.deepEqual(lastBody(h), { to: 'accepted' });
  assert.match(h.state.acceptance.message, /REQ-20990101-001 已接受/, '单条结果文案应带单号');
  assert.ok(h.toastEl.children.length >= 2, '成功 toast 应含文本与撤销按钮');
  assert.match(h.toastEl.children[0].textContent, /REQ-20990101-001 已接受/);
  assert.equal(h.toastEl.children[1].textContent, '撤销');
  await h.toastEl.children[1].listeners.click();
  assert.equal(statusPosts(h).length, 2, '点击撤销应发起回退请求');
  assert.deepEqual(lastBody(h), { to: 'submitted' }, '撤销接受 = 驳回接受（REQ-20260907-011 合法回退边）');
  assert.match(h.toastEl.textContent, /已撤销/, '撤销成功应有提示');
});

t('N3 批量接受：零确认逐条 POST；批量文案无撤销按钮', async () => {
  const h = setup();
  h.state.board.items.push({ id: 'REQ-20990101-005', type: 'requirement', status: 'submitted', parent: null, title: '待接受单二' });
  await h.run("acceptItems(['REQ-20990101-001', 'REQ-20990101-005'])");
  assert.equal(h.confirmations.length, 0, '批量接受不得弹二次确认');
  assert.equal(statusPosts(h).length, 2, '确认去掉后应立即逐条提交');
  assert.match(h.state.acceptance.message, /接受完成：成功 2 条，失败 0 条/, '批量文案口径不变');
  assert.equal(h.toastEl.children.length, 0, '批量 toast 为纯文本，无撤销按钮（批量回退走反向批量操作）');
  assert.match(h.toastEl.textContent, /成功 2 条/);
});

t('N4 批量移入计划 / 驳回待接受 / 移出计划：零确认立即逐条流转，进度与完成文案不变', async () => {
  const h = setup();
  await h.run("moveToPlan(['REQ-20990101-002'])");
  assert.equal(h.confirmations.length, 0, '批量移入计划不得弹二次确认');
  assert.deepEqual(lastBody(h), { to: 'planned' });
  assert.match(h.state.plan.message, /移入计划完成：成功 1 条，失败 0 条/);
  h.state.board.items[1].status = 'accepted';
  await h.run("rejectToSubmitted(['REQ-20990101-002'])");
  assert.equal(h.confirmations.length, 0, '批量驳回待接受不得弹二次确认');
  assert.deepEqual(lastBody(h), { to: 'submitted' });
  assert.match(h.state.reject.message, /驳回待接受完成：成功 1 条，失败 0 条/);
  h.state.board.items[2].status = 'planned';
  await h.run("removeFromPlan(['REQ-20990101-003'])");
  assert.equal(h.confirmations.length, 0, '批量移出计划不得弹二次确认');
  assert.deepEqual(lastBody(h), { to: 'accepted' });
  assert.match(h.state.impl.message, /移出计划完成：成功 1 条，失败 0 条/);
  // 资格过滤口径不变：非已计划单混入移出计划 → 不发请求并提示
  h.requests.length = 0;
  await h.run("removeFromPlan(['REQ-20990101-004'])");
  assert.equal(statusPosts(h).length, 0, '已接受单（非已计划）不可移出计划');
});

t('N5 单条移出计划：toast「✓ {单号} 已移出计划」带撤销（重新移入计划）；撤销失败错误 toast 不假成功', async () => {
  const h = setup();
  await h.run("removeFromPlan(['REQ-20990101-003'], { single: true })");
  assert.equal(h.confirmations.length, 0, '详情页移出计划本就免确认，不得回归');
  assert.deepEqual(lastBody(h), { to: 'accepted' });
  assert.match(h.state.impl.message, /REQ-20990101-003 已移出计划/, '单条结果文案应带单号');
  assert.equal(h.toastEl.children[1]?.textContent, '撤销');
  await h.toastEl.children[1].listeners.click();
  assert.deepEqual(lastBody(h), { to: 'planned' }, '撤销移出计划 = 重新移入计划（REQ-20260908-010 合法回退边）');
  // 撤销失败：超窗后状态已变，服务端按状态机拒绝
  h.sandbox.fetch = async () => ({ ok: false, json: async () => ({ error: '非法流转：planned → planned' }) });
  const undo = h.run("undoActionTo('REQ-20990101-003', 'planned')");
  await undo.run();
  assert.equal(h.toastEl.classList.contains('err'), true, '撤销失败应以错误 toast 提示');
  assert.match(h.toastEl.textContent, /撤销失败/, '不得出现假成功');
});

t('N6 驳回接受单条：ACTION_UNDO 覆盖 submitted → accepted 合法边；toast 带撤销并重新接受', async () => {
  const h = setup();
  const undoMap = h.run('ACTION_UNDO');
  assert.equal(undoMap['submitted']?.to, 'accepted', '撤销驳回接受 = 重新接受');
  for (const [from, u] of Object.entries(undoMap)) {
    assert.ok(TRANSITIONS[from]?.includes(u.to), `撤销边 ${from} → ${u.to} 必须是后端合法流转`);
  }
  await h.run("drawerAction('REQ-20990101-002', 'submitted', '驳回接受（退回待接受）')");
  assert.equal(h.confirmations.length, 0, '详情页驳回接受免确认不回归（REQ-20260906-014）');
  assert.deepEqual(lastBody(h), { to: 'submitted' });
  assert.equal(h.toastEl.children[1]?.textContent, '撤销', '驳回接受成功 toast 应提供撤销');
  await h.toastEl.children[1].listeners.click();
  assert.deepEqual(lastBody(h), { to: 'accepted' }, '点击撤销应重新接受');
});

t('N7 drawerAction accepted 分支：两种来源均走单条（single）路径（静态）', () => {
  const fn = fnBlock('drawerAction');
  assert.match(fn, /removeFromPlan\(\[id\], \{ single: true \}\)/, '已计划来源应走单条移出计划（带撤销）');
  assert.match(fn, /acceptItems\(\[id\], \{ single: true \}\)/, '待接受来源应走单条接受（带撤销）');
  assert.doesNotMatch(fn, /skipConfirm/, 'skipConfirm 参数应随确认一并移除');
  // 卡片「✓ 接受」也是单条入口：走 single 路径获得撤销
  const row = source.match(/function reqRowEl\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(row, /acceptItems\(\[it\.id\], \{ single: true \}\)/, '卡片接受应走单条路径');
});

t('N8 删除防回归：danger 确认显示单号与标题及不可恢复说明；取消零请求；成功 toast 无撤销', async () => {
  const h = setup();
  h.run('uiConfirmResult = false;'); // 取消
  await h.run("deleteItem('REQ-20990101-001')");
  assert.equal(h.requests.length, 0, '取消删除不得发请求');
  assert.equal(h.confirmations.length, 1, '删除仍应弹一次确认');
  assert.equal(h.confirmations[0].danger, true, '删除确认为 danger 态');
  assert.match(h.confirmations[0].title, /REQ-20990101-001/, '确认标题应含单号');
  assert.match(h.confirmations[0].message, /待接受单/, '确认正文应含条目标题');
  assert.match(h.confirmations[0].message, /不可恢复/, '确认正文应说明不可恢复');
  h.run('uiConfirmResult = true;'); // 确认
  await h.run("deleteItem('REQ-20990101-001')");
  const del = h.requests.find((r) => r.opts?.method === 'DELETE');
  assert.ok(del, '确认后应发 DELETE 请求');
  assert.equal(h.toastEl.children.length, 0, '删除成功 toast 无撤销按钮（该路径无撤销入口）');
  assert.doesNotMatch(fnBlock('deleteItem'), /undoAction/, 'deleteItem 不得出现撤销逻辑');
});

t('N9 其余确认框零回归（静态）：终止批量完善与开发 / 停止执行 / 项目面板确认入口保持', () => {
  // REQ-20260913-003：deleteBatchById（删除未在执行轮次）随批次排队概念移除，不再有对应确认框
  for (const name of ['abortRefineTask', 'abortDevTask']) {
    assert.match(fnBlock(name), /uiConfirm\(/, `${name} 的二次确认不得丢失`);
  }
  const stop = source.match(/const stop = drawer\.querySelector\('#cxStopCurrent'\)[\s\S]{0,800}?\n  \}\);/);
  assert.ok(stop, '应存在 #cxStopCurrent 点击绑定');
  assert.match(stop[0], /await uiConfirm\(/, '停止执行确认不得丢失');
  // 项目面板：移出项目 / 批量移出不存在目录的确认步函数保持
  for (const name of ['showRemoveConfirm', 'showBatchRemoveConfirm', 'confirmRemoveProject', 'confirmBatchRemove']) {
    assert.ok(source.includes(`function ${name}`), `项目面板确认入口 ${name} 不得丢失`);
  }
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
