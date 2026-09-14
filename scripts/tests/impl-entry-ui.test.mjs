#!/usr/bin/env node
// REQ-20260906-018 批量实施入口改造 —— 前端行为测试（沿用 accept-ui.test.mjs 的 vm 模拟 DOM 模式）
// 修订（BUG-20260909-006）：「进入批量开发」入口与勾选范围推送链路整体移除——
// 已计划档复选框仅为「移出计划」服务；批量开发入口唯一收敛为任务模块（已计划队列口径）。
// 覆盖：E1 静态契约 / E2 常驻复选框（移出计划）/ E3 勾选与全选 / E4 入口移除（0 推送）/
//       E5 创建链路（无勾选 ids；opts.ids 单条重试透传）/ E6 失效剔除 / E7 面板无范围行 /
//       E8 Codex 页无范围提示 / E9 切换项目 / E10 Esc 链还原 / E11 面板轮询不带 ids
// REQ-20260907-009：E3 全选断言随「只选当前筛选档」契约演进，N1-N6 验证新行为与防回退
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

// 已计划列测试数据（REQ-20260908-010）：001/002/BUG-001 可派发；003 已被认领；004 开发中；005 待接受
const item = (id, type = 'requirement', status = 'planned', owner = null) => ({
  id, type, status, owner, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const sample = () => [
  item('REQ-20990101-001'), item('REQ-20990101-002'),
  item('REQ-20990101-003', 'requirement', 'planned', 'codex-x'),
  item('REQ-20990101-004', 'requirement', 'in-progress'),
  item('REQ-20990101-005', 'requirement', 'submitted'),
  item('BUG-20990101-001', 'bug'),
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
    fire(event) { const e = { key: '', target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  const requests = [], confirmations = [], notices = [];
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
  state.board = { initialized: true, items: sample() };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  run('toast = recordNotice; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {}; refreshDrawer = async () => {}; poll = async () => {};');
  const scopePosts = () => requests.filter((r) => String(r.url).includes('/api/dispatch/scope'));
  return { sandbox, document, state, run, requests, confirmations, notices, scopePosts };
}

t('E1 静态契约：顶栏无批量实施按钮；列表头无「进入批量开发」；无模式机件与范围推送链路（BUG-20260909-006）', () => {
  assert.ok(!htmlSrc.includes('id="btnBatch"'), '顶栏应移除 #btnBatch 按钮');
  assert.ok(!source.includes("$('#btnBatch')"), 'app.js 应移除顶栏按钮绑定');
  for (const gone of ['enterImplMode', 'exitImplMode', 'implEntry', 'implSelectBar', 'implCancel']) {
    assert.ok(!source.includes(gone), `不应再有模式机件：${gone}`);
  }
  for (const gone of ['implGo', 'enterBatchImpl', 'pushImplScope', 'pushImplScopeClear', 'scopeActive', '/api/dispatch/scope']) {
    assert.ok(!source.includes(gone), `范围链路应随 BUG-20260909-006 移除：${gone}`);
    assert.ok(!htmlSrc.includes(gone), `页面不得残留范围链路机件：${gone}`);
  }
  for (const id of ['selGroup', 'acceptSelected', 'selectOperable']) assert.match(htmlSrc, new RegExp(`id="${id}"`), `列表头批量区应有 ${id}`);
  assert.match(htmlSrc, /id="runsView"/, '批量实施页面化为任务模块（REQ-20260907-004）');
});

t('E2 常驻复选框：已计划卡片无需模式即含选择框，其他状态没有；syncImpl 同步选中态', () => {
  const h = setup();
  h.run('syncImpl(false)');
  for (const idx of [0, 1, 2, 5]) {
    h.sandbox.testItem = sample()[idx];
    assert.match(h.run('reqRowEl(testItem)').innerHTML, /data-impl-id=/, `${sample()[idx].id}（planned）应有常驻选择框`);
  }
  for (const idx of [3, 4]) {
    h.sandbox.testItem = sample()[idx];
    assert.doesNotMatch(h.run('reqRowEl(testItem)').innerHTML, /data-impl-id/, `${sample()[idx].status} 卡片不应有选择框`);
  }
  // A13 风格同步：复选框态（REQ-20260908-027 起勾选不再加行级 selected 边框类）
  const card = element(), check = element();
  check.dataset.implId = 'REQ-20990101-002';
  check.closest = () => card;
  h.document.querySelectorAll = (selector) => selector === '[data-impl-id]' ? [check] : [];
  h.state.impl.selected.add('REQ-20990101-002');
  h.run('syncImpl(false)');
  assert.equal(check.checked, true);
  assert.equal(card.classList.contains('selected'), false, '勾选不得再加行级 selected 类（REQ-20260908-027）');
  h.state.impl.selected.clear();
  h.run('syncImpl(false)');
  assert.equal(check.checked, false);
  assert.equal(card.classList.contains('selected'), false);
});

t('E3 勾选与选择可操作项：增删集合不冒泡；选择入口仅覆盖 planned 未认领 + 待接受；无可派发时禁用', () => {
  const h = setup();
  h.run('syncImpl(false)');
  h.sandbox.testItem = sample()[0];
  const card = h.run('reqRowEl(testItem)');
  const check = card.querySelector('[data-impl-id]');
  check.checked = true;
  assert.equal(check.fire('click').e.stopped, true, '勾选不得冒泡打开详情');
  check.fire('change');
  assert.ok(h.state.impl.selected.has('REQ-20990101-001'));
  check.checked = false;
  check.fire('change');
  assert.equal(h.state.impl.selected.has('REQ-20990101-001'), false);
  // REQ-20260907-009：「选择可操作项」抽出为具名函数 selectOperable()（vm 可直接调用），
  // 只勾选当前筛选档内条目——默认「待接受」档不再跨档勾选已接受未认领条目
  h.run('selectOperable()');
  assert.deepEqual([...h.state.impl.selected], [], '待接受档不应跨档勾选可实施条目');
  assert.deepEqual([...h.state.acceptance.selected], ['REQ-20990101-005'], '待接受集合只含 submitted');
  h.run('syncImpl(false)');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '计数与当前档所见一致（REQ-20260909-002 起无档位括号）');
  h.state.impl.selected.clear();
  h.state.acceptance.selected.clear();
  h.state.board.items = h.state.board.items.filter((x) => x.status !== 'accepted' || x.owner);
  h.run('syncImpl(false)');
  assert.equal(h.document.querySelector('#selectOperable').disabled, false, '仍有待接受条目时选择入口可用');
  h.state.board.items = [];
  h.run('syncImpl(false)');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '无可操作条目时禁用');
  // BUG-20260907-015（S1/S2）随 REQ-20260907-009 演进：入口可用性按当前筛选档判断——
  // 「已接受」档主场景（仅可实施条目）仍可用；「待接受」档无可操作条目时禁用
  h.state.board.items = sample().filter((x) => x.status !== 'submitted');
  h.run('syncImpl(false)');
  assert.equal(h.document.querySelector('#selectOperable').disabled, true, '待接受档无可操作条目应禁用（REQ-20260907-009）');
  h.run("state.reqFilter = 'planned'");
  h.run('syncImpl(false)');
  assert.equal(h.document.querySelector('#selectOperable').disabled, false, 'S1：已计划档仅有可派发条目时选择入口应可用');
  h.run('selectOperable()');
  assert.deepEqual([...h.state.impl.selected].sort(), ['BUG-20990101-001', 'REQ-20990101-001', 'REQ-20990101-002'], 'S2：已计划档全选应选中全部未认领 planned');
  assert.equal(h.state.acceptance.selected.size, 0, 'S2：待接受集合为空不报错');
  h.state.impl.selected.clear();
  h.run('syncImpl(false)');
});

t('E4 入口移除（BUG-20260909-006）：勾选变化 / 全选 / 全不选 / 同步全程不发起范围推送', async () => {
  const h = setup();
  h.run('syncImpl(false)');
  h.sandbox.testItem = sample()[0];
  const card = h.run('reqRowEl(testItem)');
  const check = card.querySelector('[data-impl-id]');
  check.checked = true;
  check.fire('change');
  h.run("state.reqFilter = 'planned'");
  h.run('selectOperable()');
  h.run('deselectOperable()');
  h.run('syncImpl()');
  assert.equal(h.scopePosts().length, 0, '任何勾选操作都不再 POST /api/dispatch/scope');
});

t('E5 创建链路（BUG-20260909-006；REQ-20260909-011 去 Agent 化）：无勾选 ids 回退移除；opts.ids（单条目重试）仍透传且不带 agent', async () => {
  const h = setup();
  h.state.impl.selected = new Set(['REQ-20990101-001']);
  await h.run('createBatchAndCopy()');
  const create = h.requests.find((r) => String(r.url).includes('/api/batch/create'));
  assert.ok(create, '应发起创建请求');
  assert.equal('ids' in JSON.parse(create.opts.body), false, '创建请求不得再携带列表勾选集合');
  assert.equal('agent' in JSON.parse(create.opts.body), false, '创建请求不得携带 agent（REQ-20260909-011）');
  h.requests.length = 0;
  await h.run("createBatchAndCopy({ ids: ['REQ-20990101-004'] })");
  const retry = h.requests.find((r) => String(r.url).includes('/api/batch/create'));
  assert.ok(retry, '重试路径应发起创建请求');
  assert.deepEqual(JSON.parse(retry.opts.body).ids, ['REQ-20990101-004'], 'opts.ids（REQ-20260908-026 单条目重试）仍透传');
});

t('E6 失效剔除：被认领/离开已计划自动移出，计数同步、toast 提示；不再触发范围推送', async () => {
  const h = setup();
  h.run('syncImpl(false)');
  h.state.impl.selected = new Set(['REQ-20990101-001', 'REQ-20990101-002']);
  h.run('syncImpl()');
  assert.equal(h.scopePosts().length, 0, '剔除不产生范围推送（BUG-20260909-006 链路已移除）');
  h.state.board.items[1].owner = 'zcode-other';
  h.run('renderBoard()');
  assert.equal(h.state.impl.selected.has('REQ-20990101-002'), false);
  h.run("state.reqFilter = 'planned'");
  h.run('syncImpl(false)');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, '计数同步剔除（REQ-20260909-002 起无档位括号）');
  assert.ok(h.notices.some((n) => /REQ-20990101-002/.test(n.message) && /已从选择中移除/.test(n.message)), '应 toast 告知移除');
  h.state.impl.selected.add('REQ-20990101-004');
  h.run('syncImpl()');
  assert.equal(h.state.impl.selected.has('REQ-20990101-004'), false, '资格外条目直接剔除');
});

t('E7 Zcode 创建面板：无论勾选与否不渲染「本批范围」行（BUG-20260909-006）；无上限输入', () => {
  const h = setup();
  h.state.batchData = { batch: null, stats: { candidates: 2, blocked: 0 } };
  h.state.impl.selected = new Set(['REQ-20990101-001', 'REQ-20990101-002']);
  const html = h.run('renderZcodeBatchPanel()');
  assert.doesNotMatch(html, /本批范围/, '范围行应随勾选范围链路移除');
  assert.doesNotMatch(html, /batchLimit|批次上限/, '上限输入框应随设置移除（REQ-20260908-019）');
  h.state.impl.selected.clear();
  assert.doesNotMatch(h.run('renderZcodeBatchPanel()'), /本批范围/, '清空勾选同样无范围行');
});

t('E8 Codex 面板：不显示范围提示；scope-empty 文案随机制移除（BUG-20260909-006）', () => {
  const h = setup();
  h.state.codex.status = { enabled: false, paused: false, current: null, waiting: { kind: 'disabled' } };
  const html = h.run('renderCodexPanel()');
  assert.doesNotMatch(html, /本批范围/, '范围提示应随链路移除');
  assert.ok(!source.includes('scope-empty'), 'scope-empty 等待文案不得残留');
});

t('E9 切换项目：勾选重置；不再向旧项目推送空范围（BUG-20260909-006）', async () => {
  const h = setup();
  h.state.impl.selected = new Set(['REQ-20990101-001']);
  await h.run("switchProject('/project/b')");
  assert.equal(h.state.impl.selected.size, 0);
  assert.equal(h.scopePosts().length, 0, '切换项目不再发起范围清空推送');
});

t('E10 Esc 链（REQ-20260907-004）：任务模块为页面不被 Esc 关闭；弹窗优先于详情', async () => {
  const h = setup();
  const kd = source.slice(source.indexOf("document.addEventListener('keydown'"), source.indexOf("$('#btnInit')"));
  h.run(kd);
  h.document.querySelector('#modalWrap').classList.add('hidden');
  // REQ-20260910-007：快捷键帮助面板初始隐藏桩（对齐 index.html 初始态，处理器读取其显隐）
  h.document.querySelector('#shortcutHelpWrap').classList.add('hidden');
  // REQ-20260910-017：新建截图预览层初始隐藏桩（对齐 index.html 初始态，Esc 链读取其显隐）
  h.document.querySelector('#shotPreview').classList.add('hidden');
  // REQ-20260911-001：待接受编辑侧拉面板初始隐藏桩（对齐 index.html 初始态，Esc 链读取其显隐）
  h.document.querySelector('#editModalWrap').classList.add('hidden');
  // REQ-20260911-007：人工决策侧拉面板初始隐藏桩（对齐 index.html 初始态，Esc 链读取其显隐）
  h.document.querySelector('#holdPanel').classList.add('hidden');
  h.run('syncImpl(false)');
  h.state.impl.selected = new Set(['REQ-20990101-001']);
  await h.run("gotoRuns('develop')");
  assert.equal(h.state.batch.open, true);
  const esc = () => h.document.listeners.keydown({ key: 'Escape', target: h.document });
  esc();
  assert.equal(h.state.batch.open, true, '任务模块是页面，Esc 不关闭（页面化后无抽屉可关）');
  assert.equal(h.state.impl.selected.size, 1, '勾选不受 Esc 影响（无模式可退）');
  // 详情开着、弹窗关着 → Esc 关详情
  h.state.drawer.id = 'REQ-20990101-001';
  h.document.querySelector('#mask').classList.remove('hidden');
  esc();
  assert.equal(h.document.querySelector('#mask').classList.contains('hidden'), true, 'Esc 关闭详情');
  // 弹窗开着 → Esc 关弹窗
  h.document.querySelector('#modalWrap').classList.remove('hidden');
  esc();
  assert.equal(h.document.querySelector('#modalWrap').classList.contains('hidden'), true, 'Esc 关闭新建弹窗');
});

t('E11 面板轮询：拉取不带 ?ids=；统计变化仍触发重渲染；不渲染范围行（BUG-20260909-006）', async () => {
  const h = setup();
  h.state.batch.open = true;
  h.state.batch.mode = 'develop'; // REQ-20260908-020：任务模块默认子面板为批量完善，开发面板须显式进入
  h.state.impl.selected = new Set(['REQ-20990101-001']);
  h.sandbox.fetch = async (url) => {
    h.requests.push({ url });
    return { ok: true, json: async () => ({ batch: null, stats: { candidates: 1, blocked: 0 } }) };
  };
  await h.run('refreshBatch()');
  const fetched = h.requests.map((r) => String(r.url)).find((u) => u.includes('/api/batch/current'));
  assert.ok(fetched, '应拉取批次摘要');
  assert.doesNotMatch(fetched, /[?&]ids=/, '拉取不得再携带勾选集合参数（BUG-20260909-006）');
  const first = h.document.querySelector('#batchDrawer').innerHTML;
  assert.doesNotMatch(first, /本批范围/, '有勾选也不得渲染范围行');
  h.state.impl.selected.clear();
  h.sandbox.fetch = async (url) => {
    h.requests.push({ url });
    return { ok: true, json: async () => ({ batch: null, stats: { candidates: 3, blocked: 0 } }) };
  };
  await h.run('refreshBatch()');
  const second = h.document.querySelector('#batchDrawer').innerHTML;
  assert.doesNotMatch(second, /本批范围/, '清空勾选后同样无范围行');
  assert.doesNotMatch(second, /batchLimit/, '创建面板不再渲染上限输入框（REQ-20260908-019）');
});

t('N1-N3（REQ-20260907-009）：选择可操作项只选当前筛选档条目；其他档无可操作项禁用', () => {
  const h = setup();
  h.run('syncImpl(false)');
  // N1 默认「待接受」档：只选待接受（旧跨档行为会同时选中 3 条可实施，合计 4 项）
  h.run('selectOperable()');
  assert.deepEqual([...h.state.acceptance.selected], ['REQ-20990101-005'], 'N1：待接受档只勾选待接受条目');
  assert.equal(h.state.impl.selected.size, 0, 'N1：不得跨档勾选已接受未认领条目');
  assert.match(h.document.querySelector('#selCount').textContent, /^已选 1 项$/, 'N1：计数与当前档所见一致（REQ-20260909-002 起无档位括号）');
  // N2 「已计划」档：只选已计划未认领（REQ-20260908-010 后调度从此档取单）
  h.state.impl.selected.clear();
  h.state.acceptance.selected.clear();
  h.run("state.reqFilter = 'planned'");
  h.run('selectOperable()');
  assert.deepEqual([...h.state.impl.selected].sort(), ['BUG-20990101-001', 'REQ-20990101-001', 'REQ-20990101-002'], 'N2：已计划档只勾选未认领 planned');
  assert.equal(h.state.acceptance.selected.size, 0, 'N2：不得跨档勾选待接受条目');
  // N3 开发中/待测试/已完成档：无可勾选条目，全选/全不选整体隐藏（BUG-20260909-008 起不再灰显残留）
  h.state.impl.selected.clear();
  for (const lane of ['developing', 'confirming', 'done']) {
    h.state.reqFilter = lane;
    h.run('syncImpl(false)');
    assert.equal(h.document.querySelector('#selectOperable').classList.contains('hidden'), true, `N3：${lane} 档全选按钮应隐藏`);
    assert.equal(h.document.querySelector('#selectNone').classList.contains('hidden'), true, `N3：${lane} 档全不选按钮应隐藏`);
  }
});

t('N4-N6（REQ-20260907-009）：搜索叠加语义保持、手动勾选跨档保留、title 静态契约', () => {
  const h = setup();
  h.run('syncImpl(false)');
  // N4 搜索叠加：搜索命中只含部分待接受条目时，全选只作用可见行
  h.state.search.q = '关键词';
  h.state.search.res = { items: [sample()[4]] }; // 仅 REQ-20990101-005（submitted）命中
  h.run('selectOperable()');
  assert.deepEqual([...h.state.acceptance.selected], ['REQ-20990101-005'], 'N4：搜索可见的待接受条目被选中');
  h.state.search.q = '';
  h.state.search.res = null;
  h.state.acceptance.selected.clear();
  // N5 手动勾选跨档保留（BUG-20260907-016 契约不回退）：勾选后仅切档不清空
  h.state.acceptance.selected.add('REQ-20990101-005');
  h.state.impl.selected.add('REQ-20990101-001');
  h.run("state.reqFilter = 'planned'");
  h.run('renderBoard()');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-005'), 'N5：切档不清空待接受勾选');
  assert.ok(h.state.impl.selected.has('REQ-20990101-001'), 'N5：切档不清空可实施勾选');
  // N5b 全选按档隔离（REQ-20260908-027）：已计划档全选只动当前档集合，待接受勾选保留
  h.run('selectOperable()');
  assert.ok(h.state.acceptance.selected.has('REQ-20990101-005'), 'N5b：已计划档全选不清空待接受勾选（按档隔离）');
  assert.ok(h.state.impl.selected.has('REQ-20990101-001'), 'N5b：可实施集合为当前档全选结果');
  // N6 静态契约：title 不再宣称可跨筛选档位
  assert.doesNotMatch(htmlSrc, /可跨筛选档位/, 'N6：title 不再含「可跨筛选档位」');
  assert.match(htmlSrc, /当前筛选档/, 'N6：title 应说明仅当前筛选档');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
