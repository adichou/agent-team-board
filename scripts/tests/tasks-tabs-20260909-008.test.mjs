#!/usr/bin/env node
// REQ-20260909-008 任务界面采用多页签布局优化 —— 静态契约 + vm 行为测试
// 覆盖 test-cases.md 的 N1–N13（1020px 窄屏换行与深浅色为人工浏览器实测）。
// 用法：node scripts/tests/tasks-tabs-20260909-008.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(name) {
  const m = js.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

// ---------- vm 沙箱（全量加载渲染代码，排除 boot 自执行） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
  };
}

function setupUI() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const requests = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    fetch: async (url, opts) => { requests.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(js.split('\nboot();')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/p';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {};');
  return { sandbox, document, seed, state, run, requests };
}

const mkBatch = (extra = {}) => ({
  batchId: 'B-20990909-001', mode: 'zcode', agent: 'zcode', status: 'running',
  abortRequested: false, aborted: false, pauseRequested: false, developer: null,
  createdAt: '2026-09-09T00:00:00.000Z', lastActivityAt: '2026-09-09T00:10:00.000Z',
  candidates: [], prompt: '主调度提示词内容', ...extra,
});

const devRunData = (extra = {}) => ({
  batch: mkBatch(),
  current: { runId: 'run-1', itemId: 'REQ-20990909-001', title: '当前项', owner: 'w', createdAt: new Date().toISOString() },
  counts: { total: 5, reported: 2, failed: 1, blockedRuns: 0, interrupted: 0, remaining: 2 },
  queue: [{ batchId: 'B-20990909-002', status: 'prepared', queuePosition: 1, total: 3, developer: null, createdAt: '2026-09-09T00:05:00.000Z' }],
  pending: [{ id: 'REQ-20990909-002', type: 'requirement', title: '待开发项' }],
  records: [{ runId: 'run-9', itemId: 'REQ-20990909-001', title: '已处理项', owner: 'w', result: 'failed', attempt: 1, at: '2026-09-09T00:08:00.000Z', reason: '执行超时' }],
  recordsTotal: 1, nextAction: 'stop', notice: null, stats: { candidates: 1, blocked: 0 },
  ...extra,
});

const refineRunData = (extra = {}) => ({
  batch: { ...mkBatch(), batchId: 'RFB-20990909-001' },
  current: null,
  counts: { total: 2, done: 1, failed: 0, skipped: 0, interrupted: 0, remaining: 1 },
  candidates: [{ id: 'REQ-20990909-003', type: 'requirement', title: '候选', reasons: ['缺 README'] }],
  records: [], recordsTotal: 0, nextAction: 'stop', notice: null, stats: { candidates: 1 },
  ...extra,
});

// ---------- N1 一级页签独立保留 + 二级页签位置 ----------

t('N1 一级页签「批量完善 / 批量开发」独立保留；二级页签行位于一级页签之后、内容区之前', () => {
  const h = setupUI();
  h.state.batch.mode = 'refine';
  h.state.refine.data = refineRunData();
  const drawer = element();
  h.seed('#batchDrawer', drawer);
  h.run('renderBatchDrawer()');
  const html = drawer.innerHTML;
  const modes = html.match(/<nav class="tabs batch-modes">[\s\S]*?<\/nav>/);
  assert.ok(modes, '一级页签行 .tabs.batch-modes 应保留');
  assert.match(modes[0], /data-bmode="refine"[^>]*>批量完善</, '「批量完善」一级页签保留');
  assert.match(modes[0], /data-bmode="develop"[^>]*>批量开发</, '「批量开发」一级页签保留');
  assert.doesNotMatch(modes[0], /data-task-pane/, '一级页签行不得混入二级页签');
  // 位置契约：一级页签 → 二级页签 → 分区内容
  const pModes = html.indexOf('class="tabs batch-modes"');
  const pSub = html.indexOf('class="tabs task-subtabs"');
  const pPane = html.indexOf('data-pane="overview"');
  assert.ok(pModes >= 0 && pSub > pModes, '二级页签行应在一级页签之后');
  assert.ok(pPane > pSub, '分区内容应在二级页签之后');
});

// ---------- N2/N3 运行态二级页签结构 ----------

function assertPaneStructure(html, scope) {
  const nav = html.match(/<nav class="tabs task-subtabs"[^>]*role="tablist"[^>]*>/);
  assert.ok(nav, '应有二级页签行（tablist）');
  const tabs = [...html.matchAll(/<button type="button" class="tab task-pane-tab[^"]*" role="tab" aria-selected="([^"]+)" data-task-pane="([^"]+)" data-task-scope="([^"]+)">([^<]+)<\/button>/g)];
  assert.equal(tabs.length, 4, '应有四枚二级页签');
  assert.deepEqual(tabs.map((m) => m[2]), ['overview', 'queue', 'prompt', 'records'], '页签顺序：概况/队列/提示词/记录');
  assert.deepEqual(tabs.map((m) => m[4]), ['概况', '队列', '提示词', '记录'], '页签文案');
  assert.ok(tabs.every((m) => m[3] === scope), `页签 scope 应为 ${scope}`);
  assert.deepEqual(tabs.map((m) => m[1]), ['true', 'false', 'false', 'false'], '默认仅概况 aria-selected=true');
  for (const key of ['overview', 'queue', 'prompt', 'records']) {
    const re = new RegExp(`<section class="task-pane([^"]*)" data-pane="${key}" data-pane-scope="${scope}" role="tabpanel"`);
    const m = html.match(re);
    assert.ok(m, `应存在 ${key} 分区（role=tabpanel）`);
    assert.equal(m[1].includes('hidden'), key !== 'overview', `${key} 分区 hidden 应${key === 'overview' ? '无' : '有'}`);
  }
  // 同一时刻仅一个分区可见
  const visible = [...html.matchAll(/<section class="task-pane( hidden)?" data-pane="/g)].filter((m) => !m[1]);
  assert.equal(visible.length, 1, '同一时刻仅显示一个分区');
  return tabs;
}

t('N2 批量开发运行态渲染四分区二级页签（默认概况显示，其余 hidden）', () => {
  const h = setupUI();
  h.state.batchData = devRunData();
  const html = h.run('renderZcodeBatchPanel()');
  assertPaneStructure(html, 'develop');
});

t('N3 批量完善运行态同样渲染四分区二级页签（scope=refine）', () => {
  const h = setupUI();
  h.state.refine.data = refineRunData();
  const html = h.run('renderRefinePanel()');
  assertPaneStructure(html, 'refine');
});

// ---------- N4 启动态 / 加载态不拆页签 ----------

t('N4 启动态与加载态不渲染二级页签行（保持启动区 + 队列单屏）', () => {
  const h = setupUI();
  // 完善启动态：无进行中任务
  h.state.refine.data = { batch: null, candidates: [{ id: 'REQ-20990909-003', type: 'requirement', title: 't', reasons: [] }] };
  const rfStart = h.run('renderRefinePanel()');
  assert.doesNotMatch(rfStart, /task-subtabs|task-pane/, '完善启动态不得渲染二级页签');
  assert.match(rfStart, /id="refineCreate"/, '启动区保留');
  // 开发启动态：无进行中任务
  h.state.batchData = { batch: null, stats: { candidates: 2, blocked: 0 }, pending: [] };
  const devStart = h.run('renderZcodeBatchPanel()');
  assert.doesNotMatch(devStart, /task-subtabs|task-pane/, '开发启动态不得渲染二级页签');
  // 加载态：数据未到达
  h.state.refine.data = null;
  assert.doesNotMatch(h.run('renderRefinePanel()'), /task-subtabs/, '完善加载态无页签');
  h.state.batchData = null;
  assert.doesNotMatch(h.run('renderZcodeBatchPanel()'), /task-subtabs/, '开发加载态无页签');
  assert.match(h.run('renderZcodeBatchPanel()'), /加载中/, '加载态显示占位');
});

// ---------- N5 独立记忆与无效回落 ----------

t('N5 二级页签选择相互独立记忆；无效 pane 回落「概况」', () => {
  const h = setupUI();
  h.state.batchData = devRunData();
  h.state.refine.data = refineRunData();
  const shown = (html, key) => assert.match(html, new RegExp(`<section class="task-pane" data-pane="${key}"`), `${key} 分区应显示（无 hidden）`);
  const hidden = (html, key) => assert.match(html, new RegExp(`<section class="task-pane hidden" data-pane="${key}"`), `${key} 分区应隐藏`);
  // 批量开发切到「队列」：仅开发面板恢复 queue，完善面板仍是自己的记忆
  h.state.batch.pane = 'queue';
  const dev = h.run('renderZcodeBatchPanel()');
  shown(dev, 'queue');
  hidden(dev, 'overview');
  const rf = h.run('renderRefinePanel()');
  shown(rf, 'overview');
  hidden(rf, 'records');
  // 批量完善切到「记录」：互不串扰
  h.state.refine.pane = 'records';
  const rf2 = h.run('renderRefinePanel()');
  shown(rf2, 'records');
  hidden(rf2, 'overview');
  const dev2 = h.run('renderZcodeBatchPanel()');
  shown(dev2, 'queue');
  hidden(dev2, 'prompt');
  // 无效值回落概况
  h.state.refine.pane = 'bogus';
  shown(h.run('renderRefinePanel()'), 'overview');
  h.state.batch.pane = null;
  shown(h.run('renderZcodeBatchPanel()'), 'overview');
});

// ---------- N6 activateTaskPane 行为（vm 提取） ----------

function mkPaneEl(scope, key, kind) {
  const classes = new Set(kind === 'pane' && key !== 'overview' ? ['hidden'] : []);
  if (kind === 'tab' && key === 'overview') classes.add('active');
  return {
    classes,
    attrs: {},
    dataset: kind === 'tab' ? { taskPane: key, taskScope: scope } : { pane: key, paneScope: scope },
    classList: {
      toggle(cls, on) { on ? classes.add(cls) : classes.delete(cls); },
      contains(cls) { return classes.has(cls); },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
  };
}

function runActivate(scope, pane) {
  const consts = js.match(/const TASK_PANES = \[[\s\S]*?\];/);
  assert.ok(consts, '应存在 TASK_PANES 常量定义');
  const src = `${consts[0]}\n${fnSrc('activateTaskPane')}\nactivateTaskPane(__scope, __pane);`;
  const tabs = [];
  const panes = [];
  for (const sc of ['develop', 'refine']) {
    for (const key of ['overview', 'queue', 'prompt', 'records']) {
      tabs.push({ sc, key, el: mkPaneEl(sc, key, 'tab') });
      panes.push({ sc, key, el: mkPaneEl(sc, key, 'pane') });
    }
  }
  const drawer = {
    querySelectorAll: (sel) => (sel === '.task-pane-tab' ? tabs.map((x) => x.el)
      : sel === '.task-pane' ? panes.map((x) => x.el) : []),
  };
  const state = { batch: { pane: 'overview' }, refine: { pane: 'overview' } };
  const requests = [];
  const sandbox = {
    $: (s) => (s === '#batchDrawer' ? drawer : null),
    state,
    fetch: async (url) => { requests.push(String(url)); return { ok: true, json: async () => ({}) }; },
    saveViewSnapshot: () => {}, // REQ-20260910-001：页签切换落盘刷新快照（纯本地存储），此处仅桩
    __scope: scope,
    __pane: pane,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { tabs, panes, state, requests };
}

t('N6 activateTaskPane：切换 active/aria/hidden，scope 隔离，纯前端零请求，无效值回落概况', () => {
  const r = runActivate('develop', 'prompt');
  assert.equal(r.state.batch.pane, 'prompt', '应写入开发面板 pane 记忆');
  assert.equal(r.state.refine.pane, 'overview', '完善面板记忆不受影响（scope 隔离）');
  const tab = (sc, key) => r.tabs.find((x) => x.sc === sc && x.key === key).el;
  const pane = (sc, key) => r.panes.find((x) => x.sc === sc && x.key === key).el;
  assert.ok(tab('develop', 'prompt').classes.has('active'), '目标页签激活');
  assert.equal(tab('develop', 'prompt').attrs['aria-selected'], 'true', '目标页签 aria-selected=true');
  assert.equal(tab('develop', 'overview').attrs['aria-selected'], 'false', '其余页签 aria-selected=false');
  assert.ok(!pane('develop', 'prompt').classes.has('hidden'), '目标分区显示');
  assert.ok(pane('develop', 'overview').classes.has('hidden'), '其余分区隐藏');
  // 另一 scope 的页签与分区不动
  assert.equal(tab('refine', 'overview').attrs['aria-selected'], undefined, '完善面板页签不被触碰');
  assert.ok(!pane('refine', 'overview').classes.has('hidden'), '完善面板分区保持显示');
  assert.deepEqual(r.requests, [], '二级页签切换不得发起任何请求');
  // 无效 pane 回落概况
  const r2 = runActivate('refine', 'bogus');
  assert.equal(r2.state.refine.pane, 'overview', '无效 pane 回落 overview');
  assert.ok(!r2.panes.find((x) => x.sc === 'refine' && x.key === 'overview').el.classes.has('hidden'), '回落后概况分区显示');
  // 源码契约：切换不调用 api / renderBatchDrawer / refresh
  const fn = fnSrc('activateTaskPane');
  assert.doesNotMatch(fn, /api\(|fetch\(|refreshBatch|refreshRefine|renderBatchDrawer/, '切换为纯前端行为');
});

// ---------- N7 内容归组（批量开发） ----------

function paneSlice(html, key) {
  const start = html.indexOf(`data-pane="${key}"`);
  assert.ok(start > 0, `应存在 ${key} 分区`);
  const next = ['overview', 'queue', 'prompt', 'records'].map((k) => html.indexOf(`data-pane="${k}"`, start + 1)).filter((p) => p > 0);
  return html.slice(start, next.length ? Math.min(...next) : undefined);
}

t('N7 内容归组（批量开发）：概况/队列/提示词/记录各自归属，关键操作只出现一次', () => {
  const h = setupUI();
  h.state.batchData = devRunData();
  const html = h.run('renderZcodeBatchPanel()');
  const overview = paneSlice(html, 'overview');
  for (const word of ['batch-status-line', 'meta-grid', 'task-stats', 'id="batchPause"', 'id="batchAbort"', '暂停后续领取', 'Zcode 原生任务']) {
    assert.ok(overview.includes(word), `概况分区应包含 ${word}`);
  }
  const queue = paneSlice(html, 'queue');
  // REQ-20260913-003：排队批次节与删除入口随批次排队概念移除——队列分区仅实时待处理队列
  for (const word of ['task-queue', '待开发']) {
    assert.ok(queue.includes(word), `队列分区应包含 ${word}`);
  }
  assert.ok(!queue.includes('batch-queue'), '队列分区不得再含排队批次节');
  assert.ok(!queue.includes('data-del-batch'), '队列分区不得再含排队批次删除入口');
  const prompt = paneSlice(html, 'prompt');
  // BUG-20260910-005：会话入口（原 batchOpenZcode 底部按钮）迁至头部一级页签旁，提示词分区不再承载
  for (const word of ['id="batchPrompt"', 'id="batchRecopy"', 'id="batchResumeCopy"']) {
    assert.ok(prompt.includes(word), `提示词分区应包含 ${word}`);
  }
  const records = paneSlice(html, 'records');
  for (const word of ['attempt-table', 'data-retry-run', '本轮处理记录']) {
    assert.ok(records.includes(word), `记录分区应包含 ${word}`);
  }
  // 关键操作入口归组唯一（不得跨分区重复出现）
  for (const id of ['id="batchPause"', 'id="batchAbort"', 'id="batchRecopy"', 'id="batchPrompt"', 'data-retry-run']) {
    assert.equal((html.match(new RegExp(id.replace(/[-"]/g, '\\$&'), 'g')) || []).length, 1, `${id} 应只出现一次`);
  }
  // 终态：概况提供「启动新一轮」，且不显示暂停/终止
  h.state.batchData = devRunData({
    batch: mkBatch({ status: 'finished' }),
    current: null,
    counts: { total: 2, reported: 2, failed: 0, blockedRuns: 0, interrupted: 0, remaining: 0 },
  });
  const done = h.run('renderZcodeBatchPanel()');
  const doneOverview = paneSlice(done, 'overview');
  assert.match(doneOverview, /id="batchNext"/, '终态概况含启动新一轮');
  assert.doesNotMatch(doneOverview, /id="devNextMode"/, 'REQ-20260909-011：终态概况不再内嵌执行 Agent 选择');
  assert.doesNotMatch(done, /id="batchPause"/, '终态不显示暂停（口径不回归）');
});

// ---------- N8 内容归组与空态（批量完善） ----------

t('N8 内容归组与空态（批量完善）：概况操作、队列终态空态、提示词缺失空态、记录空态', () => {
  const h = setupUI();
  h.state.refine.data = refineRunData();
  const html = h.run('renderRefinePanel()');
  const overview = paneSlice(html, 'overview');
  for (const word of ['batch-status-line', 'meta-grid', 'task-stats', 'id="refinePause"', 'id="refineAbort"']) {
    assert.ok(overview.includes(word), `完善概况分区应包含 ${word}`);
  }
  assert.ok(paneSlice(html, 'queue').includes('task-queue'), '完善队列分区含待完善队列');
  assert.ok(paneSlice(html, 'prompt').includes('id="refinePrompt"'), '完善提示词分区含提示词块');
  assert.ok(paneSlice(html, 'prompt').includes('id="refineRecopy"'), '完善提示词分区含重新复制');
  assert.ok(paneSlice(html, 'records').includes('attempt-table'), '完善记录分区含四列表格');
  // 终态队列空态：页签保留 + 分区内空态说明
  h.state.refine.data = refineRunData({
    batch: { ...mkBatch(), batchId: 'RFB-20990909-002', status: 'finished' },
    counts: { total: 1, done: 1, failed: 0, skipped: 0, interrupted: 0, remaining: 0 },
    candidates: [],
  });
  const done = h.run('renderRefinePanel()');
  assert.match(done, /data-pane="queue"/, '终态仍保留队列页签');
  assert.match(paneSlice(done, 'queue'), /已收尾/, '终态队列分区给空态说明');
  // 提示词缺失：页签保留 + 空态说明
  h.state.refine.data = refineRunData({ batch: { ...mkBatch(), batchId: 'RFB-20990909-003', prompt: '' } });
  const noPrompt = h.run('renderRefinePanel()');
  assert.match(noPrompt, /data-pane="prompt"/, '无提示词仍保留提示词页签');
  assert.match(paneSlice(noPrompt, 'prompt'), /暂无调度提示词/, '提示词分区给空态说明');
  // 记录空态沿用共用文案
  assert.match(paneSlice(noPrompt, 'records'), /暂无执行记录/, '记录空态沿用现状文案');
});

// ---------- N9 键盘可达 ----------

t('N9 页签为原生 button + role/aria；CSS 有可见焦点态', () => {
  const shell = fnSrc('taskPaneShell');
  assert.match(shell, /role="tablist"/, '页签栏为 tablist');
  assert.match(shell, /<button type="button" class="tab task-pane-tab[^"]*" role="tab" aria-selected="/, '页签为 button+role=tab+aria-selected');
  assert.match(shell, /role="tabpanel"/, '分区为 tabpanel');
  assert.match(css, /\.task-pane-tab:focus-visible\s*\{[^}]*outline/, '页签应有可见焦点态');
});

// ---------- N10 窄屏与视觉层级 ----------

t('N10 二级页签行可换行、无横向滚动；下划线式与一级胶囊区分层；分区样式存在', () => {
  const rule = css.match(/\.task-subtabs\s*\{[^}]*\}/);
  assert.ok(rule, '应存在 .task-subtabs 样式');
  assert.match(rule[0], /flex-wrap:\s*wrap/, '窄屏页签行应可换行');
  assert.doesNotMatch(rule[0], /overflow-x:\s*(auto|scroll)/, '不应产生横向滚动');
  assert.match(css, /\.task-subtabs \.tab\.active\s*\{[^}]*border-bottom-color:\s*var\(--primary\)/, '激活态为下划线式（区别一级胶囊）');
  assert.match(css, /\.task-pane\s*\{[^}]*flex-direction:\s*column/, '分区应为纵向布局（沿用 batch-run 间距口径）');
});

// ---------- N11 Codex 深链兼容 ----------

t('N11 存量 Codex 执行记录深链：renderBatchDrawer 保留 codex 分支且该面板不引入二级页签', () => {
  const rd = fnSrc('renderBatchDrawer');
  assert.match(rd, /mode === 'codex' \? renderCodexPanel\(q\)/, 'codex 渲染分支保留');
  const cx = fnSrc('renderCodexPanel');
  assert.doesNotMatch(cx, /task-subtabs|task-pane|data-task-pane/, 'codex 面板不得引入二级页签');
  assert.match(rd, /data-bmode="refine"/, '一级页签机制不变');
  assert.match(rd, /data-bmode="develop"/, '一级页签机制不变');
});

// ---------- N12 轮询与绑定契约 ----------

t('N12 轮询签名机制与页签绑定契约：重渲染按记忆恢复、切换走 activateTaskPane', () => {
  const rb = fnSrc('refreshBatch');
  assert.match(rb, /sig === state\.batchSig/, '开发面板签名比对保留（无变化不重渲染）');
  const rr = fnSrc('refreshRefine');
  assert.match(rr, /sig === state\.refine\.sig/, '完善面板签名比对保留');
  const bind = fnSrc('bindBatchDrawer');
  assert.match(bind, /querySelectorAll\('\.task-pane-tab'\)/, '应绑定二级页签点击');
  assert.match(bind, /activateTaskPane\(b\.dataset\.taskScope, b\.dataset\.taskPane\)/, '点击切换走 activateTaskPane');
  // 渲染壳按 store 记忆恢复（轮询重渲染不重置二级页签）；无效记忆经 taskPaneOf 回落概况
  const shell = fnSrc('taskPaneShell');
  assert.match(shell, /taskPaneOf\(store\)/, '渲染壳应经 taskPaneOf 读取 pane 记忆');
  const paneOf = fnSrc('taskPaneOf');
  assert.match(paneOf, /TASK_PANES\.some\(\(p\) => p\.key === store\.pane\)/, '无效记忆回落概况');
  // 状态记忆初始化在 state.batch / state.refine（REQ-20260909-011：devAgent 草稿已随去 Agent 化移除）
  assert.match(js, /batch: \{ open: false, mode: 'refine', pane: 'overview' \}/, 'state.batch 应含 pane 记忆');
  assert.match(js, /refine: \{[\s\S]{0,400}?pane: 'overview'/, 'state.refine 应含 pane 记忆');
});

// ---------- N13 现有功能零回退（控件清单） ----------

t('N13 操作控件零回退：启动/终态/运行/提示词/记录/跳转入口全部保留（REQ-20260909-011：无 Agent 选择控件）', () => {
  const h = setupUI();
  // 完善启动态
  h.state.refine.data = { batch: null, candidates: [{ id: 'REQ-20990909-003', type: 'requirement', title: 't', reasons: [] }] };
  const rfStart = h.run('renderRefinePanel()');
  for (const id of ['id="refineCreate"']) assert.match(rfStart, new RegExp(id), `完善启动态应含 ${id}`);
  assert.doesNotMatch(rfStart, /id="refineDev"/, 'REQ-20260910-027：完善启动态不再含开发人员输入');
  assert.doesNotMatch(rfStart, /id="refineMode"/, 'REQ-20260909-011：完善启动态不再含执行 Agent 选择');
  // 开发启动态（启动区由 renderBatchDrawer 前置渲染，单测直取其输出）
  const devStart = h.run('renderDevStartBar()');
  for (const id of ['id="devStart"']) assert.match(devStart, new RegExp(id), `开发启动态应含 ${id}`);
  assert.doesNotMatch(devStart, /id="devMode"/, 'REQ-20260909-011：开发启动态不再含执行 Agent 选择');
  // 运行态（含排队批次 / 记录重试 / 条目跳转）
  h.state.batchData = devRunData();
  const dev = h.run('renderZcodeBatchPanel()');
  // BUG-20260910-005：工作区入口迁至头部（batchOpenZcode 不在面板内），此处不再断言
  for (const id of ['id="batchPause"', 'id="batchAbort"', 'id="batchRecopy"', 'id="batchResumeCopy"', 'data-retry-run', 'data-goto-item']) {
    assert.match(dev, new RegExp(id.replace(/[-]/g, '\\$&')), `开发运行态应含 ${id}`);
  }
  // REQ-20260913-003：删除入口随批次排队概念移除——无在途执行时也不再出现
  h.state.batchData = devRunData({ current: null });
  assert.ok(!h.run('renderZcodeBatchPanel()').includes('id="batchDelete"'), '不再提供「删除本批次」入口');
  // 完善运行态
  h.state.refine.data = refineRunData();
  const rf = h.run('renderRefinePanel()');
  for (const id of ['id="refinePause"', 'id="refineAbort"', 'id="refineRecopy"', 'data-goto-item']) assert.match(rf, new RegExp(id.replace(/[-]/g, '\\$&')), `完善运行态应含 ${id}`);
  // 终态启动新一轮
  h.state.batchData = devRunData({ batch: mkBatch({ status: 'finished' }), current: null, counts: { total: 2, reported: 2, failed: 0, blockedRuns: 0, interrupted: 0, remaining: 0 } });
  assert.match(h.run('renderZcodeBatchPanel()'), /id="batchNext"/, '开发终态启动新一轮保留');
  h.state.refine.data = refineRunData({ batch: { ...mkBatch(), batchId: 'RFB-20990909-009', status: 'finished' }, counts: { total: 1, done: 1, failed: 0, skipped: 0, interrupted: 0, remaining: 0 }, candidates: [{ id: 'REQ-20990909-004', type: 'requirement', title: 't', reasons: [] }] });
  const rfDone = h.run('renderRefinePanel()');
  assert.match(rfDone, /id="refineNext"/, '完善终态启动新一轮保留');
  assert.doesNotMatch(rfDone, /id="refineNextMode"/, 'REQ-20260909-011：完善终态不再含执行 Agent 选择');
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
