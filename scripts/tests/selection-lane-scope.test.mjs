#!/usr/bin/env node
// REQ-20260908-027 选择功能重构 —— 前端行为测试（沿用 plan-batch-move 的 vm 模拟 DOM 模式）
// 覆盖 test-cases.md 用例 S1-S12（BUG-20260909-008 增补 S13）：
//   工具条按档收窄 / 计数按档 / 批量驳回待接受（含完善中拦截）/ 全选全不选（仅当前档）/
//   清空选择仅当前档 / 去勾选蓝边框 / 进行中防误触 / 结果区按档 / 切项目重置 /
//   非选择档全选/全不选整体隐藏（BUG-20260909-008）
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

const statusPosts = (h) => h.requests.filter((r) => /\/api\/item\/[^/]+\/status/.test(r.url));
const hidden = (h, sel) => h.document.querySelector(sel).classList.contains('hidden');

t('S1 静态契约：合并列表头右组含 #planReject；左组成对「全选 #selectOperable / 全不选 #selectNone」；#refineGo/#implGo 不在批量右组（REQ-20260909-002 起操作条并入列表头；BUG-20260909-006 移除进入批量开发）', () => {
  const group = htmlSrc.match(/<div id="selGroup"[\s\S]*?<\/div>/);
  assert.ok(group, '应存在列表头右组 #selGroup');
  assert.match(group[0], /id="planReject"/, '右组应有驳回待接受按钮');
  assert.match(group[0], /驳回待接受/, '按钮文案为「驳回待接受」');
  assert.doesNotMatch(group[0], /id="refineGo"/, '批量完善与勾选无关，不得留在批量右组（REQ-20260908-020 面向已接受单，入口在任务模块/完善徽标）');
  assert.doesNotMatch(group[0], /id="implGo"/, '「进入批量开发」应随 BUG-20260909-006 移除（批量入口唯一收敛任务模块）');
  assert.doesNotMatch(htmlSrc, /进入批量开发/, '页面不得残留「进入批量开发」文案');
  const caption = htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="acceptResult"/);
  assert.ok(caption, '应存在合并列表头 #reqCaption');
  // REQ-20260910-026：全选 / 全不选图标化——按钮仅图标（去文字），语义由 aria-label 与 title 承载；
  // BUG-20260910-019：图标载体由 ☑ / ☐ 字形改为内联 SVG（带勾方框 / 空方框）
  assert.match(caption[0], /id="selectOperable"[^>]*aria-label="全选"[^>]*>\s*<svg\b/, '全选入口应为内联 SVG 图标按钮且带 aria-label="全选"');
  assert.match(caption[0], /id="selectNone"[^>]*aria-label="全不选"/, '应提供成对的「全不选」图标入口（aria-label）');
  assert.match(caption[0], /title="全不选：仅取消当前筛选档的勾选"/, '全不选 title 保留完整语义');
  assert.match(source, /\$\('#planReject'\)\.addEventListener\('click'/, '应绑定驳回待接受点击');
  assert.match(source, /\$\('#selectNone'\)\.addEventListener\('click', deselectOperable\)/, '应绑定全不选点击');
  assert.doesNotMatch(source, /\$\('#refineGo'\)/, 'refineGo 按钮与绑定应移除');
});

t('S2 批量右组与全选/全不选按档收窄：各档只显示本档操作；开发中/待测试/已完成档右组与全选/全不选整体隐藏（REQ-20260909-002 起右组并入列表头；BUG-20260909-008 起非选择档两按钮不再灰显残留）', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  // 待接受档：仅「接受所选」；全选/全不选显示（选择档常驻）
  h.run("state.reqFilter = 'submitted'");
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), false, '当前档有勾选时右组出现');
  assert.equal(hidden(h, '#acceptSelected'), false, '待接受档应显示接受所选');
  assert.equal(hidden(h, '#selectOperable'), false, '待接受档应显示全选（BUG-20260909-008：选择档不回归）');
  assert.equal(hidden(h, '#selectNone'), false, '待接受档应显示全不选');
  for (const sel of ['#planAdd', '#planReject', '#planRemove']) {
    assert.equal(hidden(h, sel), true, `待接受档不应显示 ${sel}`);
  }
  // 已接受档：仅「移入计划」「驳回待接受」
  h.run("state.reqFilter = 'accepted'");
  h.state.plan.selected.add('REQ-20990101-001');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#planAdd'), false, '已接受档应显示移入计划');
  assert.equal(hidden(h, '#planReject'), false, '已接受档应显示驳回待接受');
  assert.equal(hidden(h, '#selectOperable'), false, '已接受档应显示全选');
  assert.equal(hidden(h, '#selectNone'), false, '已接受档应显示全不选');
  for (const sel of ['#acceptSelected', '#planRemove']) {
    assert.equal(hidden(h, sel), true, `已接受档不应显示 ${sel}`);
  }
  // 已计划档：仅「移出计划」（BUG-20260909-006 移除「进入批量开发」）
  h.run("state.reqFilter = 'planned'");
  h.state.impl.selected.add('REQ-20990101-005');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#planRemove'), false, '已计划档应显示移出计划');
  assert.equal(hidden(h, '#selectOperable'), false, '已计划档应显示全选');
  assert.equal(hidden(h, '#selectNone'), false, '已计划档应显示全不选');
  for (const sel of ['#acceptSelected', '#planAdd', '#planReject']) {
    assert.equal(hidden(h, sel), true, `已计划档不应显示 ${sel}`);
  }
  // 开发中/待测试/已完成档：无可勾选条目，即使其他档有残留勾选，右组与全选/全不选也整体隐藏
  for (const lane of ['developing', 'confirming', 'done']) {
    h.run(`state.reqFilter = '${lane}'`);
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#selGroup'), true, `${lane} 档批量右组应隐藏`);
    assert.equal(hidden(h, '#selectOperable'), true, `${lane} 档全选按钮应整体隐藏（BUG-20260909-008，不得灰显残留）`);
    assert.equal(hidden(h, '#selectNone'), true, `${lane} 档全不选按钮应整体隐藏（BUG-20260909-008，不得灰显残留）`);
  }
});

t('S3 计数按档：只统计当前档勾选，不再三类合并；当前档勾选 0 时右组隐藏且其他档勾选保留（REQ-20260909-002 起计数无档位括号）', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  h.state.impl.selected.add('REQ-20990101-005');
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '待接受档计数只含待接受勾选');
  assert.doesNotMatch(h.document.querySelector('#selCount').textContent, /·/, '不得再出现三类合并计数');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 2 项$/, '已接受档计数只含已接受勾选');
  h.run("state.reqFilter = 'planned'");
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '已计划档计数只含已计划勾选');
  // 当前档勾选 0：右组隐藏；其他档勾选保留（BUG-20260907-016 契约不回退）
  h.state.impl.selected.clear();
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '当前档勾选 0 时右组隐藏');
  assert.equal(h.state.acceptance.selected.size, 1, '其他档勾选不被清空');
  assert.equal(h.state.plan.selected.size, 2, '其他档勾选不被清空');
});

t('S4 批量驳回待接受：免二次确认（REQ-20260910-011）；逐条 POST {to:"submitted"} 绑定当前项目；成功移出勾选、失败保留、结果分列', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  h.run("state.reqFilter = 'accepted'");
  await h.run('rejectToSubmitted(["REQ-20990101-001", "REQ-20990101-002"])');
  assert.equal(h.confirmations.length, 0, '驳回待接受可撤销，不得弹二次确认');
  const posts = statusPosts(h);
  assert.equal(posts.length, 2, '两条已接受单均应发起流转');
  for (const r of posts) {
    assert.match(r.url, /^\/api\/item\/REQ-20990101-00[12]\/status\?project=%2Fproject%2Fa$/, '请求绑定当前项目');
    assert.equal(r.opts.method, 'POST');
    assert.deepEqual(JSON.parse(r.opts.body), { to: 'submitted' });
  }
  assert.match(h.state.reject.message, /驳回待接受完成：成功 2 条，失败 0 条/);
  assert.equal(h.state.plan.selected.size, 0, '成功单应从勾选集合移除');
});

t('S5 完善中拦截：refining 单被服务端拒绝进失败清单，单项失败不回滚、保留勾选可重试', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url: String(url), opts });
    if (String(url).includes('REQ-20990101-002')) {
      return { ok: false, status: 403, json: async () => ({ error: 'REQ-20990101-002 完善中，待本轮批量完善结束后再驳回回待接受' }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  await h.run('rejectToSubmitted(["REQ-20990101-001", "REQ-20990101-002"])');
  assert.equal(statusPosts(h).length, 2, '两条都应尝试流转（不因单项失败回滚）');
  assert.match(h.state.reject.message, /成功 1 条，失败 1 条/);
  assert.deepEqual([...h.state.reject.failures.map((f) => f.id)], ['REQ-20990101-002']);
  assert.match(h.state.reject.failures[0].error, /完善中/);
  assert.equal(h.state.plan.selected.has('REQ-20990101-001'), false, '成功单移出勾选');
  assert.equal(h.state.plan.selected.has('REQ-20990101-002'), true, '失败单保留勾选便于重试');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  const resultHtml = h.document.querySelector('#acceptResult').innerHTML;
  assert.match(resultHtml, /完善中/, '结果区应分列失败原因');
});

t('S6 全选：仅勾选当前档可见可操作条目（叠搜索）；当前档集合替换为所见，其他档勾选不动', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.state.acceptance.selected.add('REQ-20990101-003'); // 其他档残留勾选
  h.run("state.reqFilter = 'accepted'");
  h.run('selectOperable()');
  assert.deepEqual([...h.state.plan.selected].sort(), ['REQ-20990101-001', 'REQ-20990101-002'], '已接受档全选应只含已接受条目');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-003'), '全选不得清空其他档勾选（按档隔离）');
  assert.equal(h.state.impl.selected.size, 0);
  // 搜索叠加：全选只作用可见行，且当前档集合替换为所见集合
  h.state.search.q = '关键词';
  h.state.search.res = { items: [sample()[0]] }; // 仅 REQ-20990101-001 命中
  h.run('selectOperable()');
  assert.deepEqual([...h.state.plan.selected], ['REQ-20990101-001'], '搜索可见的已接受条目被选中（替换为所见）');
  h.state.search.q = '';
  h.state.search.res = null;
  // 可用性：当前档无可操作条目禁用；有则可用
  h.state.board.items = h.state.board.items.filter((x) => x.status !== 'accepted');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '当前档无可操作条目应禁用全选');
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectOperable').disabled, false, '有待接受条目时全选可用');
});

t('S7 全不选：仅清当前档勾选（其他档保留）；全程不发起范围推送（BUG-20260909-006 移除链路）；0 勾选禁用', async () => {
  const h = setup();
  h.run('syncImpl(false); syncPlan(false);');
  h.state.impl.selected.add('REQ-20990101-005');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.state.plan.selected.add('REQ-20990101-001');
  h.run("state.reqFilter = 'planned'");
  h.run('deselectOperable()');
  assert.equal(h.state.impl.selected.size, 0, '全不选应清当前档勾选');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-003'), '其他档勾选保留');
  assert.ok(h.state.plan.selected.has('REQ-20990101-001'), '其他档勾选保留');
  const scopePosts = h.requests.filter((r) => String(r.url).includes('/api/dispatch/scope'));
  assert.equal(scopePosts.length, 0, '任何勾选操作都不再发起 /api/dispatch/scope 推送');
  // 可用性：当前档 0 勾选禁用；有勾选可用
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '当前档勾选 0 应禁用全不选');
  h.state.impl.selected.add('REQ-20990101-005');
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectNone').disabled, false, '当前档有勾选时全不选可用');
});

t('S8 去清空选择（REQ-20260909-002）：入口与函数移除，清除选择统一走「全不选」仅清当前档', () => {
  assert.doesNotMatch(htmlSrc, /clearSelection/, '页面不得再有「清空选择」按钮');
  assert.doesNotMatch(source, /clearSelection/, 'app.js 不得再有清空选择入口/绑定');
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.state.impl.selected.add('REQ-20990101-005');
  h.run("state.reqFilter = 'accepted'");
  h.run('deselectOperable()');
  assert.equal(h.state.plan.selected.size, 0, '全不选应清当前档勾选');
  assert.equal(h.state.acceptance.selected.size, 1, '不得跨档清空待接受勾选');
  assert.equal(h.state.impl.selected.size, 1, '不得跨档清空已计划勾选');
});

t('S9 视觉契约：勾选行不再有主题蓝边框（删除 .req-row.selected 规则与 selected 类切换）', () => {
  assert.doesNotMatch(cssSrc, /\.req-row\.selected\s*\{/, 'style.css 不得再有 .req-row.selected 蓝边框规则');
  assert.doesNotMatch(source, /toggle\('selected'/, 'app.js 不得再对勾选行 toggle selected 类');
  assert.doesNotMatch(source, /classList\.add\('selected'\)/, '不得以其他方式添加 selected 类');
});

t('S10 进行中防误触：驳回进行中全选/全不选禁用、按钮显「驳回中…」、复选框禁用；pending 复位后恢复', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  h.run("state.reqFilter = 'accepted'");
  let finish;
  h.sandbox.fetch = (url, opts) => {
    h.requests.push({ url: String(url), opts });
    if (String(url).includes('REQ-20990101-001')) return new Promise((r) => { finish = r; });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const pending = h.run('rejectToSubmitted(["REQ-20990101-001", "REQ-20990101-002"])');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.state.reject.pending, true, '流转中应置 pending');
  assert.match(h.document.querySelector('#planReject').textContent, /驳回中…/, '进行中按钮文案');
  assert.equal(h.document.querySelector('#planReject').disabled, true, '进行中驳回按钮禁用');
  assert.equal(h.document.querySelector('#planAdd').disabled, true, '同档另一批量进行中应禁用移入计划');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '进行中全选禁用');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '进行中全不选禁用');
  const check = element();
  check.dataset.planId = 'REQ-20990101-002';
  h.document.querySelectorAll = (selector) => (selector === '[data-plan-id]' ? [check] : []);
  h.run('syncPlan(false)');
  assert.equal(check.disabled, true, '进行中复选框禁用（防误触）');
  h.document.querySelectorAll = () => [];
  finish({ ok: true, json: async () => ({}) });
  await pending;
  assert.equal(h.state.reject.pending, false, '完成后应复位 pending');
  // 完成后勾选已被消费（计数 0 禁用属正常）；重新勾选即恢复可操作
  h.state.plan.selected.add('REQ-20990101-002');
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#planReject').disabled, false, 'pending 复位且有勾选时恢复可操作');
});

t('S11 结果区按档：批量反馈只在对应档显示；切档不清勾选不回退', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.state.plan.selected.add('REQ-20990101-001');
  h.run("state.reqFilter = 'accepted'");
  await h.run('moveToPlan(["REQ-20990101-001"])');
  assert.equal(hidden(h, '#acceptResult'), false, '已接受档应显示移入计划结果');
  assert.match(h.document.querySelector('#acceptResult').innerHTML, /移入计划完成/);
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#acceptResult'), true, '切到待接受档不显示已接受档的批量结果');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#acceptResult'), false, '切回已接受档结果仍可见');
  // 跨档勾选保留（BUG-20260907-016 契约保持）
  h.state.plan.selected.add('REQ-20990101-002');
  h.run("state.reqFilter = 'submitted'");
  h.run('renderBoard()');
  assert.ok(h.state.plan.selected.has('REQ-20990101-002'), '切档不清空已接受勾选');
});

t('S12 切换项目：重置驳回态并停止后续驳回请求', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  let finish;
  h.sandbox.fetch = (url, opts) => {
    h.requests.push({ url: String(url), opts });
    if (String(url).includes('REQ-20990101-001')) return new Promise((r) => { finish = r; });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const pending = h.run('rejectToSubmitted(["REQ-20990101-001", "REQ-20990101-002"])');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.state.reject.pending, true);
  await h.run("switchProject('/project/b')");
  assert.equal(h.state.reject.pending, false, '切换项目应重置驳回 pending');
  assert.equal(h.state.reject.message, '', '切换项目应重置驳回结果');
  assert.equal(h.state.reject.failures.length, 0);
  finish({ ok: true, json: async () => ({}) });
  await pending;
  assert.equal(statusPosts(h).length, 1, '项目切换后不应继续发送剩余旧请求');
});

// S13（BUG-20260909-008）：非选择档全选/全不选整体隐藏——三选择档显示、切非选择档即时隐藏
// （不得以 disabled 灰显残留）、切回恢复；勾选跨档保留契约不回退；静态节点位次契约不受影响
t('S13 非选择档全选/全不选整体隐藏（BUG-20260909-008）：切档即时隐藏与恢复；勾选跨档保留；静态位次不变', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '待接受档全选按钮显示');
  assert.equal(hidden(h, '#selectNone'), false, '待接受档全不选按钮显示');
  // 切到开发中档：两按钮整体隐藏（非灰显死控件），其他档勾选保留
  h.run("state.reqFilter = 'developing'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), true, '开发中档全选按钮应隐藏');
  assert.equal(hidden(h, '#selectNone'), true, '开发中档全不选按钮应隐藏');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-003'), '切档不清空待接受勾选（BUG-20260907-016 跨档保留契约不回退）');
  // 切回待接受档：按钮恢复显示、勾选保留
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selectOperable'), false, '切回待接受档全选恢复显示');
  assert.equal(hidden(h, '#selectNone'), false, '切回待接受档全不选恢复显示');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-003'), '勾选仍保留');
  // 实现方式契约：保留静态节点仅按档隐藏（REQ-20260907-004 绑定一次策略不变），
  // REQ-20260910-008 单行工具栏后 #laneQuickEntry 位于 #reqCaption 工具栏内、#reqSort 之后（常驻口径不变）
  const toolbar = htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="reqList"/);
  assert.ok(toolbar, '应存在列表头工具栏 #reqCaption');
  assert.ok(toolbar[0].indexOf('id="laneQuickEntry"') > toolbar[0].indexOf('id="reqSort"'), '#laneQuickEntry 应在工具栏 #reqSort 之后');
  assert.match(source, /\$\('#selectOperable'\)\.addEventListener\('click', selectOperable\)/, '静态绑定保留不改为条件渲染');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
