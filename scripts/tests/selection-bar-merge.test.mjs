#!/usr/bin/env node
// REQ-20260909-002 列表头与批量操作条合并为单行 —— 前端行为与静态契约测试
// （沿用 selection-lane-scope.test.mjs 的 vm 模拟 DOM 模式）
// 覆盖 test-cases.md 用例 M1-M9：
//   合并行静态结构 / 右组显隐 / 计数与动作文案精简 / 去清空选择 /
//   按档动作不回退 / 结果区独立 / 计数更新不重建列表头 / 选择入口可用性
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

const hidden = (h, sel) => h.document.querySelector(sel).classList.contains('hidden');

// M1 静态契约：列表头单行工具栏（REQ-20260910-008 取代 BUG-20260909-009 的固定两行——
// 全选/全不选、右组与快捷入口同行；普通「N 个条目」移除，#reqCount 转条件提示；
// REQ-20260910-016 排序菜单迁至第三行 #pageHead 定位组，工具栏不再含排序入口）；
// 独立操作条与「清空选择」彻底移除
t('M1 静态契约：#reqCaption 单行工具栏承载选择入口与批量动作（右组 #selGroup role=group）与快捷入口；#reqSort 已迁至 #pageHead 定位组（工具栏无排序入口与占位）；#reqCount 为条件提示（初始 hidden）；#acceptResult 在列表头后；无 #selectionBar / #clearSelection / #selectRow；CSS 无 .selection-bar、单行 wrap、右组不靠右隔断、快捷入口靠右', () => {
  const caption = htmlSrc.match(/<div id="reqCaption"[^>]*>[\s\S]*?<div id="reqList"/);
  assert.ok(caption, '应存在合并列表头 .req-caption');
  const head = htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="acceptResult"/)[0];
  for (const id of ['reqCount', 'selectOperable', 'selectNone', 'selGroup', 'laneQuickEntry']) {
    assert.ok(head.includes(`id="${id}"`), `列表头应包含 #${id}`);
  }
  // REQ-20260910-016：排序菜单迁至搜索框左侧定位组，工具栏不再有排序入口（无占位残留）
  assert.ok(!head.includes('id="reqSort"'), '工具栏不得再含 #reqSort（已迁至 #pageHead 定位组）');
  assert.doesNotMatch(head, /sort-placeholder|排序占位/, '不得遗留排序占位');
  const group = head.match(/<div id="selGroup"[\s\S]*?<\/div>/);
  assert.ok(group, '应存在右组 #selGroup');
  assert.match(group[0], /role="group"/, '批量右组保留 role="group"');
  assert.match(group[0], /aria-label="批量操作"/, '批量右组保留可读 aria-label');
  // 顺序契约：#acceptResult 位于列表头之后（进度/结果不塞入列表头）
  assert.ok(htmlSrc.indexOf('id="reqCaption"') >= 0 || htmlSrc.indexOf('class="req-caption"') >= 0, '列表头存在');
  assert.ok(htmlSrc.indexOf('<div id="acceptResult"') > htmlSrc.indexOf('id="selGroup"'), '结果区应在列表头（右组）之后');
  // 移除独立操作条与清空选择；两行结构已随 REQ-20260910-008 取消
  assert.doesNotMatch(htmlSrc, /id="selectionBar"/, '不得再有独立 #selectionBar 操作条');
  assert.doesNotMatch(htmlSrc, /clearSelection/, '页面不得再有「清空选择」按钮');
  assert.doesNotMatch(source, /clearSelection/, 'app.js 不得再有 clearSelection 入口/绑定');
  assert.doesNotMatch(cssSrc, /\.selection-bar\s*\{/, 'style.css 应删除 .selection-bar 规则');
  assert.doesNotMatch(htmlSrc, /id="selectRow"/, '不得再有 #selectRow 第二行（REQ-20260910-008 单行工具栏）');
  // 单行契约（REQ-20260910-008）：wrap 兜底、快捷入口靠右、右组与全选/全不选连续不靠右
  const capRule = cssSrc.match(/\.req-caption\s*\{[^}]*\}/);
  assert.ok(capRule, '应有 .req-caption 规则');
  assert.match(capRule[0], /flex-wrap:\s*wrap/, '宽度不足按组整体换行兜底（不产生横向滚动、不截断）');
  assert.doesNotMatch(capRule[0], /flex-direction:\s*column/, '不得再纵向固定两行');
  const quickRule = cssSrc.match(/#laneQuickEntry\s*\{[^}]*\}/);
  assert.ok(quickRule, '应有 #laneQuickEntry 规则');
  assert.match(quickRule[0], /margin-left:\s*auto/, '快捷入口空间足够时靠右');
  const grpRule = cssSrc.match(/\.sel-group\s*\{[^}]*\}/);
  assert.ok(grpRule, '应有 .sel-group 规则');
  assert.match(grpRule[0], /flex-wrap:\s*wrap/, '右组内按钮必要时继续换行');
  assert.doesNotMatch(grpRule[0], /margin-left:\s*auto/, '右组不得 margin-left:auto 靠右（选择区需连续）');
});

// M2 右组显隐：当前档选中数 > 0 出现；清零/无批量档隐藏；跨档勾选不撑出右组
t('M2 右组显隐：当前档勾选 >0 显示、清零隐藏；开发中/待测试/已完成档即使其他档有勾选也隐藏', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '待接受档零勾选右组隐藏');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), false, '当前档有勾选右组出现');
  h.state.acceptance.selected.clear();
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '当前档清零后右组隐藏（无空占位）');
  // 其他档有勾选但当前档（待接受）为零：右组不出现
  h.state.plan.selected.add('REQ-20990101-001');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '其他档勾选不计入当前档，右组不出现');
  // 开发中/待测试/已完成：无可勾选条目，右组整体隐藏
  h.state.impl.selected.add('REQ-20990101-005');
  for (const lane of ['developing', 'confirming', 'done']) {
    h.run(`state.reqFilter = '${lane}'`);
    h.run('syncAcceptance()');
    assert.equal(hidden(h, '#selGroup'), true, `${lane} 档不出现批量右组`);
  }
});

// M3 计数文案：统一「已选 M 项」，无档位括号；按档计数不回退
t('M3 计数文案：「已选 M 项」不含档位括号；切档只统计当前档勾选', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  h.state.impl.selected.add('REQ-20990101-005');
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '待接受档计数无档位括号');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 2 项$/, '已接受档只统计已接受勾选');
  h.run("state.reqFilter = 'planned'");
  h.run('syncAcceptance()');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '已计划档只统计已计划勾选');
  // 条目计数与选择计数互不替代：REQ-20260910-008 起普通「N 个条目」已移除（分类标签承载计数），
  // 普通档 #reqCount 隐藏且无文案（截断/搜索提示语义见 caption-toolbar-20260910-008.test.mjs L3）
  h.run("state.reqFilter = 'submitted'");
  h.run('renderBoard()');
  assert.equal(h.document.querySelector('#reqCount').textContent, '', '普通档不再展示与分类标签重复的条目计数');
  assert.equal(hidden(h, '#reqCount'), true, '普通档 #reqCount 隐藏');
});

// M4 动作文案：静止无数量后缀；进行中「…中」文案
t('M4 动作文案：各按钮静止文案无「（N）」后缀；批量进行中显示「移入中…」等', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#planAdd').textContent, '移入计划', '静止文案无数量后缀');
  assert.equal(h.document.querySelector('#planReject').textContent, '驳回待接受', '静止文案无数量后缀');
  h.run("state.reqFilter = 'submitted'");
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.state.acceptance.selected.add('REQ-20990101-004');
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#acceptSelected').textContent, '接受所选', '静止文案无数量后缀');
  h.run("state.reqFilter = 'planned'");
  h.state.impl.selected.add('REQ-20990101-005');
  h.run('syncAcceptance()');
  // BUG-20260909-006：#implGo 已移除，已计划档批量组仅剩「移出计划」（文案为 HTML 静态）
  assert.ok(!htmlSrc.includes('implGo'), '进入批量开发按钮应随 BUG-20260909-006 移除');
  assert.equal(h.document.querySelector('#planRemove').textContent, '移出计划', '静止文案无数量后缀');
  // 进行中文案：挂起首条移入计划请求
  let finish;
  h.run("state.reqFilter = 'accepted'");
  h.sandbox.fetch = (url, opts) => {
    h.requests.push({ url: String(url), opts });
    if (String(url).includes('REQ-20990101-001')) return new Promise((r) => { finish = r; });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const pending = h.run('moveToPlan(["REQ-20990101-001", "REQ-20990101-002"])');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.document.querySelector('#planAdd').textContent, '移入中…', '移入计划进行中文案');
  finish({ ok: true, json: async () => ({}) });
  await pending;
});

// M5 去清空选择：清除选择统一走全不选（仅当前档，其他档保留）
t('M5 去清空选择：清除选择统一用 deselectOperable（仅清当前档，其他档勾选保留）', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.state.impl.selected.add('REQ-20990101-005');
  h.run("state.reqFilter = 'accepted'");
  h.run('deselectOperable()');
  assert.equal(h.state.plan.selected.size, 0, '全不选清当前档勾选');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-003'), '其他档勾选保留');
  assert.ok(h.state.impl.selected.has('REQ-20990101-005'), '其他档勾选保留');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '清除当前档选择后右组消失');
});

// M6 按档动作显隐：合并行下三档动作互不串档（REQ-20260908-027 契约不回退；
// BUG-20260909-006：已计划档仅「移出计划」）
t('M6 按档动作显隐：待接受→接受所选；已接受→移入计划+驳回待接受；已计划→移出计划', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.run("state.reqFilter = 'submitted'");
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#acceptSelected'), false);
  for (const sel of ['#planAdd', '#planReject', '#planRemove']) assert.equal(hidden(h, sel), true, `待接受档不应显示 ${sel}`);
  h.run("state.reqFilter = 'accepted'");
  h.state.plan.selected.add('REQ-20990101-001');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#planAdd'), false);
  assert.equal(hidden(h, '#planReject'), false);
  for (const sel of ['#acceptSelected', '#planRemove']) assert.equal(hidden(h, sel), true, `已接受档不应显示 ${sel}`);
  h.run("state.reqFilter = 'planned'");
  h.state.impl.selected.add('REQ-20990101-005');
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#planRemove'), false);
  for (const sel of ['#acceptSelected', '#planAdd', '#planReject']) assert.equal(hidden(h, sel), true, `已计划档不应显示 ${sel}`);
});

// M7 结果区独立：位于合并行下方，按档显示；右组隐藏后结果仍可读
t('M7 结果区独立：批量反馈只进 #acceptResult（合并行下方），右组隐藏后结果仍可见', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.state.plan.selected.add('REQ-20990101-001');
  h.run("state.reqFilter = 'accepted'");
  await h.run('moveToPlan(["REQ-20990101-001"])');
  assert.equal(hidden(h, '#acceptResult'), false, '已接受档应显示移入计划结果');
  assert.match(h.document.querySelector('#acceptResult').innerHTML, /移入计划完成/);
  // 成功后勾选被消费 → 右组隐藏，但结果区仍可查看（不塞进合并行）
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#selGroup'), true, '成功消费后右组隐藏');
  assert.equal(hidden(h, '#acceptResult'), false, '右组隐藏后结果区仍可读');
});

// M8 计数更新不重建列表头：syncAcceptance/renderBoard 只改控件态，不重写合并行容器
t('M8 计数更新不重建列表头：多次勾选/切档同步后合并行容器内容未被重写', () => {
  const h = setup();
  h.run('syncPlan(false); syncImpl(false);');
  h.state.acceptance.selected.add('REQ-20990101-003');
  h.state.plan.selected.add('REQ-20990101-001');
  for (const lane of ['submitted', 'accepted', 'planned', 'submitted']) {
    h.state.reqFilter = lane;
    h.run('syncAcceptance()');
    h.run('renderBoard()');
  }
  const caption = h.document.querySelector('.req-caption');
  assert.equal(caption.innerHTML, '', '合并行容器未被重写（无 innerHTML 重建）');
  assert.equal(caption.children.length, 0, '合并行容器未被 replaceChildren 重建');
});

// M9 选择入口可用性不回退：无候选禁用全选、0 勾选禁用全不选、进行中均禁用
t('M9 选择入口可用性：无候选禁用全选；当前档 0 勾选禁用全不选；批量进行中两者禁用', async () => {
  const h = setup();
  h.run('syncPlan(false)');
  h.run("state.reqFilter = 'submitted'");
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '当前档 0 勾选禁用全不选');
  h.state.board.items = h.state.board.items.filter((x) => x.status !== 'submitted');
  h.run('syncAcceptance()');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '当前档无可操作条目禁用全选');
  // 进行中：挂起首条移入计划请求，全选/全不选均禁用
  h.run("state.reqFilter = 'accepted'");
  h.state.board = { initialized: true, items: sample() };
  h.state.plan.selected.add('REQ-20990101-001');
  h.state.plan.selected.add('REQ-20990101-002');
  let finish;
  h.sandbox.fetch = (url, opts) => {
    h.requests.push({ url: String(url), opts });
    if (String(url).includes('REQ-20990101-001')) return new Promise((r) => { finish = r; });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const pending = h.run('moveToPlan(["REQ-20990101-001", "REQ-20990101-002"])');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '进行中禁用全选');
  assert.equal(h.document.querySelector('#selectNone').disabled, true, '进行中禁用全不选');
  finish({ ok: true, json: async () => ({}) });
  await pending;
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
