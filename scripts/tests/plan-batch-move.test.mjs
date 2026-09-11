#!/usr/bin/env node
// REQ-20260908-018 已接受列表批量移入计划 —— 前端行为测试
// （沿用 accept-ui / planned-state 的 vm 模拟 DOM 模式）
// 覆盖 test-cases.md 用例 1-9：静态契约 / 复选框交互 / 合并计数 / 批量流转 /
// 资格过滤 / 免确认与防重入（REQ-20260910-011 起移入计划免二次确认）/ 单项失败不回滚 / 轮询剪枝 / 全选与清空
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

// 001/002 已接受；003 已计划未认领；004 开发中；005 待接受
const item = (id, type = 'requirement', status = 'accepted', owner = null) => ({
  id, type, status, owner, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const sample = () => [
  item('REQ-20990101-001'), item('REQ-20990101-002'),
  item('REQ-20990101-003', 'requirement', 'planned'),
  item('REQ-20990101-004', 'requirement', 'in-progress', 'dev-x'),
  item('REQ-20990101-005', 'requirement', 'submitted'),
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

const statusPosts = (h) => h.requests.filter((r) => /\/api\/item\/[^/]+\/status/.test(r.url));

t('U1 静态契约：工具条有「移入计划」#planAdd；已接受行有 data-plan-id 复选框，其他状态行没有', () => {
  assert.match(htmlSrc, /id="planAdd"/, '选择工具条应有移入计划按钮');
  assert.match(htmlSrc, /移入计划/, '按钮文案应为移入计划');
  assert.doesNotMatch(htmlSrc, /改为已计划/, '本需求不改既有「改为已计划」文案（BUG-20260908-006 另行处理）');
  assert.match(htmlSrc, /待接受 \/ 已接受 \/ 已计划/, '选择可操作项 title 应覆盖已接受');
  const h = setup();
  h.run('syncPlan(false)');
  for (const idx of [0, 1]) {
    h.sandbox.testItem = sample()[idx];
    assert.match(h.run('reqRowEl(testItem)').innerHTML, /data-plan-id=/, `${sample()[idx].id}（accepted）应有常驻选择框`);
  }
  for (const idx of [2, 3, 4]) {
    h.sandbox.testItem = sample()[idx];
    const html = h.run('reqRowEl(testItem)').innerHTML;
    assert.doesNotMatch(html, /data-plan-id/, `${sample()[idx].status} 行不应有移入计划选择框`);
    assert.doesNotMatch(html, /data-impl-id=.*data-plan-id|data-plan-id=.*data-impl-id/, '同一行不得同时出现两类批量选择框');
  }
});

t('U2 复选框交互：点击不冒泡打开详情；change 增删 state.plan.selected', () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.sandbox.testItem = sample()[0];
  const card = h.run('reqRowEl(testItem)');
  const check = card.querySelector('[data-plan-id]');
  check.checked = true;
  assert.equal(check.fire('click').e.stopped, true, '勾选不得冒泡打开详情');
  check.fire('change');
  assert.ok(h.state.plan.selected.has('REQ-20990101-001'), '勾选应入已接受集合');
  check.checked = false;
  check.fire('change');
  assert.equal(h.state.plan.selected.has('REQ-20990101-001'), false, '取消勾选应移出集合');
});

t('U3 列表头右组按档计数（REQ-20260908-027/20260909-002）：#selCount 只统计当前档勾选且无档位括号；#planAdd 随已接受勾选数启用、文案无数量后缀', () => {
  const h = setup();
  h.run('syncPlan(false)');
  assert.equal(h.document.querySelector('#planAdd').disabled, true, '零选择应禁用移入计划');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  h.state.acceptance.selected.add('REQ-20990101-005');
  h.state.impl.selected.add('REQ-20990101-003');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 2 项$/, '计数只统计当前档（已接受）勾选');
  assert.equal(h.document.querySelector('#planAdd').disabled, false);
  assert.equal(h.document.querySelector('#planAdd').textContent, '移入计划', 'REQ-20260909-002 起按钮不带数量后缀');
  h.state.plan.selected.clear();
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#planAdd').disabled, true, '已接受勾选清零后应禁用');
  // 其他档勾选不计入当前档：切到待接受档只显示待接受计数
  h.state.plan.selected.add('REQ-20990101-001');
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '待接受档只统计待接受勾选');
});

t('U4 批量移入计划：免二次确认（REQ-20260910-011）；逐条 POST {to:"planned"} 且绑定当前项目；完成反馈成功计数', async () => {
  const h = setup();
  await h.run('moveToPlan(["REQ-20990101-001", "REQ-20990101-002"])');
  assert.equal(h.confirmations.length, 0, '移入计划可撤销，不得弹二次确认');
  const posts = statusPosts(h);
  assert.equal(posts.length, 2, '两条已接受单均应发起流转');
  for (const r of posts) {
    assert.match(r.url, /^\/api\/item\/REQ-20990101-00[12]\/status\?project=%2Fproject%2Fa$/, '请求绑定当前项目');
    assert.equal(r.opts.method, 'POST');
    assert.deepEqual(JSON.parse(r.opts.body), { to: 'planned' });
  }
  assert.match(h.state.plan.message, /移入计划完成：成功 2 条，失败 0 条/);
  assert.ok(h.notices.some((n) => /成功 2 条/.test(n.message)), '应 toast 成功计数');
  assert.equal(h.state.plan.selected.size, 0, '成功单应从勾选集合移除');
});

t('U5 资格过滤：待接受/已计划/开发中单混入不发请求并提示；重复 id 去重', async () => {
  const h = setup();
  await h.run('moveToPlan(["REQ-20990101-003", "REQ-20990101-004", "REQ-20990101-005"])');
  assert.equal(statusPosts(h).length, 0, '非已接受单不得发起流转');
  assert.ok(h.notices.some((n) => /没有可移入计划/.test(n.message)), '应提示无可移入条目');
  h.requests.length = 0;
  await h.run('moveToPlan(["REQ-20990101-001", "REQ-20990101-001"])');
  assert.equal(statusPosts(h).length, 1, '重复 id 应去重为一次');
});

t('U6 免确认立即发请求（REQ-20260910-011）；pending 期间防重入', async () => {
  const h = setup();
  await h.run('moveToPlan(["REQ-20990101-001"])');
  assert.equal(h.requests.length, 1, '点击应立即发流转请求');
  h.requests.length = 0;
  let finish;
  h.sandbox.fetch = (url, opts) => {
    h.requests.push({ url: String(url), opts });
    if (String(url).includes('REQ-20990101-001')) return new Promise((r) => { finish = r; }); // 首条挂起
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const pending = h.run('moveToPlan(["REQ-20990101-001", "REQ-20990101-002"])');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.state.plan.pending, true, '流转中应置 pending');
  assert.equal(h.document.querySelector('#planAdd').disabled, true, 'pending 应禁用移入计划按钮');
  await h.run('moveToPlan(["REQ-20990101-002"])');
  assert.equal(statusPosts(h).length, 1, 'pending 期间重复调用不得追发请求');
  finish({ ok: true, json: async () => ({}) });
  await pending;
  assert.equal(h.state.plan.pending, false, '完成后应复位 pending');
  assert.equal(statusPosts(h).length, 2, '释放后第二条继续流转');
});

t('U7 单项失败不回滚：失败单进 failures 分列反馈，其余成功单正常计数', async () => {
  const h = setup();
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url: String(url), opts });
    if (String(url).includes('REQ-20990101-002')) return { ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ error: '非法流转' }) };
    return { ok: true, json: async () => ({}) };
  };
  await h.run('moveToPlan(["REQ-20990101-001", "REQ-20990101-002"])');
  assert.equal(statusPosts(h).length, 2, '两条都应尝试流转');
  assert.match(h.state.plan.message, /成功 1 条，失败 1 条/, '成功与失败分开计数');
  assert.deepEqual([...h.state.plan.failures.map((f) => f.id)], ['REQ-20990101-002']);
  assert.match(h.state.plan.failures[0].error, /非法流转/);
  assert.equal(h.state.plan.selected.has('REQ-20990101-001'), false, '成功单移出勾选');
  assert.equal(h.state.plan.selected.has('REQ-20990101-002'), true, '失败单保留勾选便于重试');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  const resultHtml = h.document.querySelector('#acceptResult').innerHTML;
  assert.match(resultHtml, /非法流转/, '结果区应分列失败原因');
});

t('U8 轮询剪枝：勾选单离开已接受状态自动移出并 toast；切档不清空（跨档保留）', () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  h.state.board.items[1].status = 'planned'; // 002 被并行置计划
  h.run("state.reqFilter = 'accepted'");
  h.run('renderBoard()');
  assert.equal(h.state.plan.selected.has('REQ-20990101-002'), false, '离开已接受状态应被剪枝');
  assert.ok(h.state.plan.selected.has('REQ-20990101-001'), '仍在已接受状态的勾选保留');
  assert.ok(h.notices.some((n) => /REQ-20990101-002/.test(n.message) && /已不在已接受状态/.test(n.message)), '应 toast 告知移除');
  // 跨档保留：切到待接受档不清空已接受勾选
  h.run("state.reqFilter = 'submitted'");
  h.run('renderBoard()');
  assert.ok(h.state.plan.selected.has('REQ-20990101-001'), '切档不清空已接受勾选');
});

t('U9 全选 / 全不选 / 切换项目（REQ-20260908-027 按档隔离口径；REQ-20260909-002 起清除选择统一用全不选）', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.run("state.reqFilter = 'accepted'");
  h.run('selectOperable()');
  assert.deepEqual([...h.state.plan.selected].sort(), ['REQ-20990101-001', 'REQ-20990101-002'], '已接受档全选应只含已接受条目');
  assert.equal(h.state.acceptance.selected.size, 0, '不得跨档勾选待接受条目');
  assert.equal(h.state.impl.selected.size, 0, '不得跨档勾选已计划条目');
  // 其他档不回退：待接受档全选只含 submitted（既有契约）
  h.run("state.reqFilter = 'submitted'");
  h.run('selectOperable()');
  assert.deepEqual([...h.state.acceptance.selected], ['REQ-20990101-005'], '待接受档行为不回退');
  assert.equal(h.state.plan.selected.size, 2, '按档隔离：待接受档全选不清空已接受勾选');
  // 全不选（清除选择唯一入口）仅清当前档
  h.run('deselectOperable()');
  assert.equal(h.state.acceptance.selected.size, 0, '全不选应清当前档勾选');
  assert.equal(h.state.plan.selected.size, 2, '全不选不得清空其他档勾选');
  // 切换项目重置已接受勾选
  await h.run("switchProject('/project/b')");
  assert.equal(h.state.plan.selected.size, 0, '切换项目应重置已接受勾选');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
