#!/usr/bin/env node
// REQ-20260909-007 已接受/已计划列表头「开始完善 / 开始开发」常驻快捷按钮 —— 前端行为与静态契约测试
// （沿用 selection-bar-merge.test.mjs 的 vm 模拟 DOM 模式）
// 覆盖 test-cases.md 用例 Q1-Q6：
//   静态契约与位置 / 按档显隐与文案 / 开始完善点击行为 / 开始开发点击行为 /
//   常驻可用性（与勾选、批量进行中解耦）/ 现有入口不回退
// 口径（design.md 定稿）：BUG-20260909-006 已移除「进入批量开发」与勾选范围链路
// （批量开发入口唯一收敛任务模块，范围恒为已计划队列），故「开始开发」= gotoRuns('develop')，
// 无勾选范围语义；「开始完善」= gotoRuns('refine')，与勾选无关。
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
  // 快捷按钮点击绑定切片：#selectNone 绑定行之后、#mask 绑定行之前（本需求新增绑定落点）
  const bindStart = source.indexOf("$('#selectNone').addEventListener");
  const bindEnd = source.indexOf("$('#mask').addEventListener");
  if (bindStart >= 0 && bindEnd > bindStart) run(source.slice(bindStart, bindEnd));
  return { sandbox, document, state, run, requests, confirmations, notices };
}

const hidden = (h, sel) => h.document.querySelector(sel).classList.contains('hidden');

// Q1 静态契约：常驻快捷按钮位于列表头单行工具栏内「排序」之后（REQ-20260910-008 单行工具栏，
// 取代 BUG-20260909-009 两行结构下迁入 .caption-info 的位次；空间足够时经 margin-left:auto 靠右）；
// 不在右组；初始隐藏；无范围链路符号回流
t('Q1 静态契约：#laneQuickEntry 在 #reqCaption 工具栏内、#reqSort 之后，btn small primary 且初始 hidden、type=button、带 aria-label；不在 #selGroup 内；CSS 靠右（margin-left:auto）；右组无「开始完善 / 开始开发 / 批量完善」；无 BUG-20260909-006 移除符号回流；工具栏保留 wrap', () => {
  const left = htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="reqList"/);
  assert.ok(left, '应存在列表头 #reqCaption');
  const btn = left[0].match(/<button[^>]*id="laneQuickEntry"[^>]*>/);
  assert.ok(btn, '工具栏应包含 #laneQuickEntry 快捷按钮');
  assert.match(btn[0], /type="button"/, '原生 button type=button（键盘可达）');
  assert.match(btn[0], /class="[^"]*btn small primary[^"]*"/, '主操作观感：btn small primary（与 quiet 全选/全不选区分）');
  assert.match(btn[0], /class="[^"]*\bhidden\b[^"]*"/, '初始隐藏（syncAcceptance 按档启用）');
  assert.match(btn[0], /aria-label="/, '应带 aria-label');
  assert.ok(left[0].indexOf('id="laneQuickEntry"') > left[0].indexOf('id="reqSort"'), '按钮应位于「排序」之后（工具栏内，REQ-20260910-008 单行位次契约）');
  // 右组口径（REQ-20260908-027 不回退）：快捷按钮不在 #selGroup，右组按钮文案不出现完善/开发启动入口
  // （右组按钮的 title 提示文案可合法提及「批量完善」等词，故只断言按钮可见文案）
  const group = htmlSrc.match(/<div id="selGroup"[\s\S]*?<\/div>/);
  assert.ok(group, '应存在右组 #selGroup');
  assert.ok(!group[0].includes('laneQuickEntry'), '快捷按钮不得放进右组（与勾选无关）');
  const groupBtnLabels = [...group[0].matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
  for (const word of ['开始完善', '开始开发', '批量完善']) {
    assert.ok(!groupBtnLabels.some((label) => label.includes(word)), `右组按钮文案不得为「${word}」（REQ-20260908-027 口径）`);
  }
  // BUG-20260909-006 移除符号不得随本需求回流
  for (const gone of ['implGo', 'enterBatchImpl', 'pushImplScope', 'pushImplScopeClear', 'scopeActive', '/api/dispatch/scope']) {
    assert.ok(!source.includes(gone), `范围链路符号不得回流：${gone}`);
    assert.ok(!htmlSrc.includes(gone), `页面不得残留：${gone}`);
  }
  // 绑定契约：点击仅导航（gotoRuns），不创建任务
  // BUG-20260911-005：done 档新增「开始 Commit」分支（accepted → refine、planned → develop、done → commit）
  assert.match(source, /\$\('#laneQuickEntry'\)\?\.addEventListener\('click', \(\) => gotoRuns\([^)]*'refine'[^)]*'develop'[^)]*\)\)/, '点击绑定应为 gotoRuns 按档导航（含 refine/develop 分支）');
  assert.doesNotMatch(source, /\$\('#laneQuickEntry'\)[^\n]*addEventListener\('click'[^\n]*(batch\/create|dispatch|api\()/, '点击绑定不得创建任务或调接口');
  // 窄屏契约：工具栏允许换行（宽度不足按组整体落行，按钮不被遮挡）；快捷入口空间足够时靠右
  const capRule = cssSrc.match(/\.req-caption\s*\{[^}]*\}/);
  assert.ok(capRule, '应有 .req-caption 规则');
  assert.match(capRule[0], /flex-wrap:\s*wrap/, '工具栏允许换行（按钮不被遮挡）');
  const quickRule = cssSrc.match(/#laneQuickEntry\s*\{[^}]*\}/);
  assert.ok(quickRule, '应有 #laneQuickEntry 规则');
  assert.match(quickRule[0], /margin-left:\s*auto/, '快捷入口空间足够时靠右');
});

// Q2 显隐与文案：仅已接受/已计划档显示，文案与 title 随档切换，切档即时
t('Q2 显隐与文案：已接受档「▶ 开始完善」（title 含批量完善）；已计划档「▶ 开始开发」（title 含批量开发）；其余档（待接受/开发中/待测试）隐藏；来回切档正确', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), true, '默认待接受档不显示');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已接受档显示快捷按钮');
  assert.equal(btn.textContent, '▶ 开始完善', '已接受档文案');
  assert.match(btn.title, /批量完善/, '已接受档 title 指向批量完善面板');
  assert.match(btn.title, /与勾选无关/, '已接受档 title 说明与勾选无关');
  h.run("state.reqFilter = 'planned'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已计划档显示快捷按钮');
  assert.equal(btn.textContent, '▶ 开始开发', '已计划档文案');
  assert.match(btn.title, /批量开发/, '已计划档 title 指向批量开发面板');
  assert.match(btn.title, /已计划队列/, '已计划档 title 说明范围=已计划队列（BUG-20260909-006 口径）');
  // BUG-20260911-005：done 档改由「开始 Commit」快捷入口接管（详见 lane-quick-entry-commit-20260911-005.test.mjs），
  // 本测试只守其余三档（待接受 / 开发中 / 待测试）不显示
  for (const lane of ['submitted', 'developing', 'confirming']) {
    h.state.reqFilter = lane;
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#laneQuickEntry'), true, `${lane} 档不显示快捷按钮`);
  }
  // 回到已接受：文案与显隐恢复（切档来回正确）
  h.state.reqFilter = 'accepted';
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false);
  assert.equal(btn.textContent, '▶ 开始完善');
});

// Q3 「开始完善」点击行为：gotoRuns('refine')——切任务模块 + 拉取完善面板数据；不创建任务、无确认弹窗
t('Q3 开始完善点击：view=runs、batch.mode=refine、拉取 /api/refine/current + /api/refine/candidates；无创建/启动请求、无确认弹窗、无范围推送', async () => {
  const h = setup();
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  // 已接受档有勾选：行为仍与勾选无关
  h.state.plan.selected.add('REQ-20990101-001');
  await h.document.querySelector('#laneQuickEntry').fire('click').result;
  assert.equal(h.state.view, 'runs', '点击后切到任务模块');
  assert.equal(h.state.batch.mode, 'refine', '激活批量完善子面板');
  assert.equal(h.state.batch.open, true, '任务模块打开');
  const urls = h.requests.map((r) => r.url);
  assert.ok(urls.some((u) => u.includes('/api/refine/current')), '应拉取 /api/refine/current');
  assert.ok(urls.some((u) => u.includes('/api/refine/candidates')), '应拉取 /api/refine/candidates');
  assert.ok(!urls.some((u) => u.includes('/api/batch/create')), '点击不得创建批量开发任务');
  assert.ok(!urls.some((u) => u.includes('/api/refine/start')), '点击不得启动完善任务');
  assert.ok(!urls.some((u) => u.includes('/api/dispatch/scope')), '不得发起范围推送');
  assert.equal(h.confirmations.length, 0, '纯导航不弹确认框');
});

// Q4 「开始开发」点击行为：gotoRuns('develop')——拉取 /api/batch/current 且不带 ?ids=；勾选有无不影响范围
t('Q4 开始开发点击：view=runs、batch.mode=develop、拉取 /api/batch/current 不带 ?ids=；有勾选同样不携带范围、无范围推送（BUG-20260909-006 口径）', async () => {
  const h = setup();
  h.run("state.reqFilter = 'planned'");
  h.run('syncAcceptance()');
  await h.document.querySelector('#laneQuickEntry').fire('click').result;
  assert.equal(h.state.view, 'runs', '点击后切到任务模块');
  assert.equal(h.state.batch.mode, 'develop', '激活批量开发子面板');
  const fetched = h.requests.map((r) => r.url).find((u) => u.includes('/api/batch/current'));
  assert.ok(fetched, '应拉取批次摘要');
  assert.doesNotMatch(fetched, /[?&]ids=/, '拉取不得携带勾选集合参数（范围恒为已计划队列）');
  assert.ok(!h.requests.some((r) => r.url.includes('/api/batch/create')), '点击不得创建任务');
  assert.ok(!h.requests.some((r) => r.url.includes('/api/dispatch/scope')), '不得发起范围推送');
  // 已计划档有勾选：范围仍为已计划队列（勾选仅为「移出计划」服务）
  h.requests.length = 0;
  h.state.batch.mode = '';
  h.state.impl.selected.add('REQ-20990101-005');
  await h.document.querySelector('#laneQuickEntry').fire('click').result;
  const fetched2 = h.requests.map((r) => r.url).find((u) => u.includes('/api/batch/current'));
  assert.ok(fetched2, '有勾选时仍应拉取批次摘要');
  assert.doesNotMatch(fetched2, /[?&]ids=/, '有勾选也不携带范围参数');
  assert.equal(h.confirmations.length, 0, '纯导航不弹确认框');
});

// Q5 常驻可用性：零勾选可见可点；批量操作进行中不禁用；与右组显隐互不影响
t('Q5 常驻可用性：零勾选时可见且 disabled=false；四路批量 pending 均不禁用；右组隐藏时快捷按钮仍显示', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  // 已接受档零勾选：右组隐藏、快捷按钮可见可点
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '零勾选右组隐藏');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '快捷按钮常驻不依赖勾选');
  assert.equal(btn.disabled, false, '零勾选不禁用');
  // 批量操作进行中（anyBatchPending 四路）不禁用：仅导航无副作用
  for (const mod of ['acceptance', 'plan', 'impl', 'reject']) {
    h.state[mod].pending = true;
    h.run('syncAcceptance()');
    assert.equal(btn.disabled, false, `${mod} 批量进行中不禁用快捷按钮`);
    h.state[mod].pending = false;
  }
  // 已计划档零勾选同理
  h.run("state.reqFilter = 'planned'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '已计划档零勾选右组隐藏');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已计划档快捷按钮常驻');
  assert.equal(btn.disabled, false, '已计划档零勾选不禁用');
});

// Q6 现有入口不回退：完善徽标跳转 / 任务模块子面板 / 右组既有按钮照常
t('Q6 现有入口不回退：完善三态徽标 data-goto-refine 跳转绑定保留；#runsView 与子面板 tab 保留；右组既有四按钮静态存在', () => {
  const h = setup();
  assert.match(source, /data-goto-refine/, '完善徽标跳转标记保留');
  assert.match(source, /gotoRuns\('refine'\)/, '徽标仍经 gotoRuns(\'refine\') 跳转');
  assert.match(htmlSrc, /id="runsView"/, '任务模块页面保留');
  assert.match(source, /data-bmode/, '任务模块子面板 tab 机制（data-bmode）保留');
  const group = htmlSrc.match(/<div id="selGroup"[\s\S]*?<\/div>/);
  for (const id of ['acceptSelected', 'planAdd', 'planReject', 'planRemove']) {
    assert.ok(group[0].includes(`id="${id}"`), `右组既有按钮 ${id} 保留`);
  }
  // 动态：右组按档动作不受快捷按钮影响（REQ-20260909-002 契约抽查）
  h.run("state.reqFilter = 'planned'");
  h.state.impl.selected.add('REQ-20990101-005');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#planRemove'), false, '已计划档勾选后「移出计划」照常出现');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '快捷按钮与右组并存');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
