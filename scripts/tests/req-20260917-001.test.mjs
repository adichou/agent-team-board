#!/usr/bin/env node
// REQ-20260917-001 契约测试 —— 需求模块「▶ AI 分析 / ▶ AI 开发」快捷入口从「跳任务页再启动」
// 改为「就地创建任务并复制主调度提示词」（不切视图、与勾选无关、无候选/进行中禁用、
// 重复启动由服务端 400 如实反馈、复制失败指引任务页手动复制）。
// 覆盖 test-cases.md L1–L8（vm 模拟 DOM，沿用 lane-quick-entry-precise-20260915-009 模式）；
// L9（存量契约同步）由三个改写后的存量测试守；L10（范围回归）由 npm test 全量守。
// 用法：node scripts/tests/req-20260917-001.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 文案常量（与 app.js / i18n.js 同源；改词须三处同步）
const TITLE_REFINE_OK = '点击即创建 AI 分析任务并复制主调度提示词（不跳转任务页）：范围为全部已接受未完善条目，与勾选无关';
const TITLE_DEV_OK = '点击即创建 AI 开发任务并复制主调度提示词（不跳转任务页）：范围为已计划队列（最旧优先），与勾选无关';
const TITLE_REFINE_EMPTY = '暂无可完善候选：已接受条目均已完善（或尚无已接受条目）';
const TITLE_DEV_EMPTY = '暂无已计划候选：请先在看板接受条目并「移入计划」';
const COPY_FAIL_REFINE = '任务已创建，但复制失败：请到「任务」页 AI 分析面板「提示词」页签手动复制（不会产生新任务）';
const COPY_FAIL_DEV = '任务已创建，但复制失败：请到「任务」页 AI 开发面板「提示词」页签手动复制（不会产生新任务）';
const REFINE_PROMPT = '【AI 分析主调度提示词】atb refine next …';
const DEV_PROMPT = '【AI 开发主调度提示词】atb batch check …';
const DUP_400_ERROR = '已有进行中的完善任务（执行中）：同一时间只有一轮执行，无需重复启动；如需重开请先完成、恢复或终止当前任务';

const item = (id, status = 'accepted', extra = {}) => ({
  id, type: 'requirement', status, owner: null, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const sample = () => [
  item('REQ-20990101-001'),                            // 已接受未完善
  item('REQ-20990101-005', 'planned'),                 // 已计划未认领
];
const sampleRefined = () => [item('REQ-20990101-001', 'accepted', { refineState: 'refined' })];
const sampleEmptyPlanned = () => [item('REQ-20990101-001', 'accepted')];

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

// 创建接口响应（与任务页「启动」同一接口、同一提示词事实源）
const RESP_REFINE_OK = { created: true, prompt: REFINE_PROMPT, counts: { candidates: 1 } };
const RESP_BATCH_OK = { created: true, prompt: DEV_PROMPT, counts: { candidates: 1, blocked: 0 } };

function setup({ fetch: fetchOverride, clipboardFail = false, items = sample() } = {}) {
  const document = element();
  document.createElement = element;
  const requests = [];
  const toasts = [];
  const copied = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    navigator: { clipboard: { writeText: async (text) => { if (clipboardFail) throw new Error('clipboard denied'); copied.push(text); } } },
    // toast 经宿主桥接收集（vm 跨 realm 数组会让 deepEqual 误判不等）
    __pushToast: (m, e) => toasts.push([String(m), Boolean(e)]),
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }), confirm: () => true },
    fetch: fetchOverride || (async (url, opts) => {
      const u = String(url);
      requests.push({ url: u, opts });
      if (u.includes('/api/refine/create')) return { ok: true, status: 200, statusText: 'OK', json: async () => RESP_REFINE_OK };
      if (u.includes('/api/batch/create')) return { ok: true, status: 200, statusText: 'OK', json: async () => RESP_BATCH_OK };
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.view = 'status';
  state.board = { initialized: true, items };
  run('toast = (m, e) => { __pushToast(m, e); };');
  run('poll = async () => {}; refreshDrawer = async () => {}; refreshHealth = async () => {}; updateBoardTabs = () => {}; markActiveTab = () => {};');
  // 快捷按钮点击绑定切片（与 lane-quick-entry-precise-20260915-009 同落点）
  const bindStart = source.indexOf("$('#selectNone').addEventListener");
  const bindEnd = source.indexOf("$('#mask').addEventListener");
  if (bindStart >= 0 && bindEnd > bindStart) run(source.slice(bindStart, bindEnd));
  return {
    sandbox, document, state, run, requests, copied,
    toasts: () => toasts,
    quick: document.querySelector('#laneQuickEntry'),
    createReqs: () => requests.filter((r) => r.url.includes('/api/refine/create') || r.url.includes('/api/batch/create')),
  };
}

// ---------- L1 静态契约（源码 + index.html） ----------

t('L1 静态契约：#laneQuickEntry 点击绑定就地创建入口 laneQuickCreate（不再 gotoRuns 导航），旧「进入任务模块……」title 零残留，index.html 静态 title 同步新语义', () => {
  assert.match(source, /\$\('#laneQuickEntry'\)\?\.addEventListener\('click', laneQuickCreate\);/, '点击应绑定 laneQuickCreate');
  assert.ok(!source.includes("gotoRuns(state.reqFilter === 'accepted' ? 'refine' : 'develop')"), '旧导航绑定不得残留');
  assert.ok(!source.includes('进入任务模块 AI 分析面板'), '旧 title 文案不得残留（app.js）');
  assert.ok(!source.includes('进入任务模块 AI 开发面板'), '旧 title 文案不得残留（app.js）');
  const btn = htmlSrc.match(/<button[^>]*id="laneQuickEntry"[^>]*>/);
  assert.ok(btn, 'index.html 应存在 #laneQuickEntry 按钮');
  assert.ok(btn[0].includes(`title="${TITLE_REFINE_OK}"`), 'index.html 静态 title 应为新语义');
});

// ---------- L2 / L3 就地创建 + 复制（不切视图） ----------

t('L2 已接受档点击「▶ AI 分析」：视图保持需求页，POST /api/refine/create，剪贴板获得接口返回 prompt（与任务页「提示词」页签同源），toast 统一成功口径（候选 1，子代理模式；状态：待启动）', async () => {
  const h = setup();
  h.state.reqFilter = 'accepted';
  h.run('syncAcceptance()');
  assert.equal(h.quick.classList.contains('hidden'), false, '已接受档显示');
  assert.equal(h.quick.disabled, false, '有候选可点');
  assert.equal(h.quick.title, TITLE_REFINE_OK, 'title 为就地创建语义');
  await h.quick.fire('click').result;
  assert.equal(h.state.view, 'status', '不切换视图（停留需求页）');
  const create = h.requests.filter((r) => r.url.includes('/api/refine/create'));
  assert.equal(create.length, 1, '应发出一次 AI 分析创建请求');
  assert.equal(create[0].opts?.method, 'POST', '创建请求应为 POST');
  assert.deepEqual(h.copied, [REFINE_PROMPT], '剪贴板应获得创建接口返回的主调度提示词');
  assert.deepEqual(h.toasts(), [[
    '✓ 任务已创建、提示词已复制，请在对应项目会话粘贴发送（候选 1，子代理模式；状态：待启动）', false,
  ]], 'toast 呈现统一成功口径');
});

t('L3 已计划档点击「▶ AI 开发」：POST /api/batch/create，复制 prompt，toast 成功口径（候选 1，受阻 0；状态：待启动），不切视图', async () => {
  const h = setup();
  h.state.reqFilter = 'planned';
  h.run('syncAcceptance()');
  assert.equal(h.quick.classList.contains('hidden'), false, '已计划档显示');
  assert.equal(h.quick.disabled, false, '有候选可点');
  assert.equal(h.quick.title, TITLE_DEV_OK, 'title 为就地创建语义');
  await h.quick.fire('click').result;
  assert.equal(h.state.view, 'status', '不切换视图（停留需求页）');
  const create = h.requests.filter((r) => r.url.includes('/api/batch/create'));
  assert.equal(create.length, 1, '应发出一次 AI 开发创建请求');
  assert.equal(create[0].opts?.method, 'POST', '创建请求应为 POST');
  assert.deepEqual(h.copied, [DEV_PROMPT], '剪贴板应获得创建接口返回的主调度提示词');
  assert.deepEqual(h.toasts(), [[
    '✓ 任务已创建、提示词已复制，请在对应项目会话粘贴发送（候选 1，受阻 0；状态：待启动）', false,
  ]], 'toast 呈现统一成功口径');
});

// ---------- L4 无候选禁用 ----------

t('L4a 已接受档无可完善候选：按钮禁用、title 说明原因，点击不发请求', async () => {
  const h = setup({ items: sampleRefined() });
  h.state.reqFilter = 'accepted';
  h.run('syncAcceptance()');
  assert.equal(h.quick.classList.contains('hidden'), false, '已接受档仍显示按钮');
  assert.equal(h.quick.disabled, true, '无可完善候选应禁用');
  assert.equal(h.quick.title, TITLE_REFINE_EMPTY, 'title 说明禁用原因（对齐任务页启动口径）');
  await h.quick.fire('click').result;
  assert.equal(h.createReqs().length, 0, '禁用态点击不得触发创建请求');
});

t('L4b 已计划档空队列：按钮禁用、title 说明原因，点击不发请求', async () => {
  const h = setup({ items: sampleEmptyPlanned() });
  h.state.reqFilter = 'planned';
  h.run('syncAcceptance()');
  assert.equal(h.quick.classList.contains('hidden'), false, '已计划档仍显示按钮');
  assert.equal(h.quick.disabled, true, '已计划队列为空应禁用');
  assert.equal(h.quick.title, TITLE_DEV_EMPTY, 'title 说明禁用原因（对齐任务页启动口径）');
  await h.quick.fire('click').result;
  assert.equal(h.createReqs().length, 0, '禁用态点击不得触发创建请求');
});

// ---------- L5 连点防重复 ----------

t('L5 连点防重复：首个创建请求进行中按钮禁用，期间再点不发出第二个请求，回执后恢复可点', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  let createCalls = 0;
  const h = setup({ fetch: async (url) => {
    if (String(url).includes('/api/refine/create')) { createCalls++; await gate; }
    return { ok: true, status: 200, statusText: 'OK', json: async () => RESP_REFINE_OK };
  } });
  h.state.reqFilter = 'accepted';
  h.run('syncAcceptance()');
  const first = h.quick.fire('click').result;
  assert.equal(h.quick.disabled, true, '请求进行中按钮应禁用');
  await h.quick.fire('click').result; // 连点（vm 手动 fire 模拟）
  release();
  await first;
  assert.equal(createCalls, 1, '进行中连点不得产生第二个创建请求');
  assert.equal(h.quick.disabled, false, '回执后恢复可点');
});

// ---------- L6 重复启动（服务端 400） ----------

t('L6 重复启动如实反馈：服务端 400 拒绝时 toast 警示样式原样展示原因，不复制提示词、不误报成功', async () => {
  const h = setup({ fetch: async (url) => {
    if (String(url).includes('/api/refine/create')) {
      return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: DUP_400_ERROR }) };
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
  } });
  h.state.reqFilter = 'accepted';
  h.run('syncAcceptance()');
  await h.quick.fire('click').result;
  assert.deepEqual(h.toasts(), [[DUP_400_ERROR, true]], '错误 toast 原样展示服务端原因（警示样式）');
  assert.deepEqual(h.copied, [], '服务端拒绝时不复制提示词');
  assert.equal(h.quick.disabled, false, '回执后按钮恢复');
});

// ---------- L7 复制失败 ----------

t('L7 复制失败不静默：剪贴板不可用时如实说明任务已创建但复制失败，指引到任务页对应面板「提示词」页签手动复制，不误报「已复制」', async () => {
  const hA = setup({ clipboardFail: true });
  hA.state.reqFilter = 'accepted';
  hA.run('syncAcceptance()');
  await hA.quick.fire('click').result;
  assert.deepEqual(hA.copied, [], '复制失败：剪贴板未获得内容');
  const listA = hA.toasts();
  // copyDispatchText 内建失败 toast 先落、fromLane 指引后落——单例 toast 最终展示后者
  assert.deepEqual(listA[listA.length - 1], [COPY_FAIL_REFINE, true], 'AI 分析侧最终 toast 指引任务页手动复制');

  const hB = setup({ clipboardFail: true });
  hB.state.reqFilter = 'planned';
  hB.run('syncAcceptance()');
  await hB.quick.fire('click').result;
  const listB = hB.toasts();
  assert.deepEqual(listB[listB.length - 1], [COPY_FAIL_DEV, true], 'AI 开发侧最终 toast 指引任务页手动复制');
  for (const [msg] of listA.concat(listB)) {
    assert.ok(!msg.includes('已复制，请在'), '不得误报「已复制」');
  }
  assert.ok(listA.some(([m]) => m.includes('任务已创建')), '如实说明任务已创建');
});

// ---------- L8 i18n 契约 ----------

t('L8 i18n 中英同步：新 title 4 条（两档 × 有/无候选）与两条复制失败 toast 词条入 EN；旧「进入任务模块……」两条词条移除', () => {
  const pairs = [
    [`'${TITLE_REFINE_OK}': `, 'Click to create an AI analysis task and copy the master dispatch prompt'],
    [`'${TITLE_DEV_OK}': `, 'Click to create an AI development task and copy the master dispatch prompt'],
    [`'${TITLE_REFINE_EMPTY}'`, 'No refine candidates'],
    [`'${TITLE_DEV_EMPTY}'`, 'No planned candidates'],
    [`'${COPY_FAIL_REFINE}': `, 'Task created, but copying failed'],
    [`'${COPY_FAIL_DEV}': `, 'Task created, but copying failed'],
  ];
  for (const [zh, en] of pairs) {
    assert.ok(i18nSrc.includes(zh), `i18n.js 应含中文键：${zh.slice(0, 24)}…`);
    assert.ok(i18nSrc.includes(en), `i18n.js 应含对应英文：${en}`);
  }
  for (const gone of [
    '进入任务模块 AI 分析面板：对已接受未完善条目批量补全文档（与勾选无关）',
    '进入任务模块 AI 开发面板：以已计划队列（最旧优先）为范围，由面板内「启动」创建任务',
    'Open the AI analysis panel: complete documents of accepted unrefined items in bulk',
    'Open the AI development panel: scoped to the planned queue',
  ]) {
    assert.ok(!i18nSrc.includes(gone), `旧词条不得残留：${gone.slice(0, 24)}…`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
