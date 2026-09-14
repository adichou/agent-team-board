#!/usr/bin/env node
// REQ-20260908-026 优化批量任务管理界面与 Agent 配置 —— 前端/服务端契约测试
// 覆盖：启动文案「启动」、复制成功提示、运行面板计数与耗时、阶段化占位、
//       最近两条（待处理队列 + 本轮处理记录四列表格）、暂停文案与终态隐藏、
//       任务设置四列表格（含全部隐藏）、重试入口与路由、无 Demo 残留。
// 用法：node scripts/tests/tasks-panel-26.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
const srv = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- vm 沙箱（加载事件绑定之前的全部渲染/交互代码） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false,
    value: '', children: [], listeners: {},
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

function setupUI() {
  const document = element();
  document.createElement = element;
  const requests = [];
  const notices = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    navigator: { clipboard: { writeText: async () => true } },
    fetch: async (url, opts) => { requests.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  // 加载全部源码（含设置模块渲染），仅排除末尾 boot() 自执行
  vm.runInContext(js.split('\nboot();')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/p';
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  run('toast = recordNotice; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; uiConfirm = async () => true;');
  return { sandbox, document, state, run, requests, notices };
}

const mkBatch = (extra = {}) => ({
  batchId: 'B-20990101-001', mode: 'zcode', agent: 'zcode', status: 'running',
  abortRequested: false, aborted: false, pauseRequested: false, developer: null,
  createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:10:00.000Z',
  candidates: [], prompt: '调度提示词', ...extra,
});

// ---------- 启动与提示词复制 ----------

t('K1 两类任务启动按钮文案均为「启动」；REQ-20260909-011 去 Agent 化后无全部隐藏禁用提示', () => {
  assert.doesNotMatch(js, /启动批量完善|启动批量开发/, '不得再出现「启动批量完善 / 启动批量开发」');
  const h = setupUI();
  h.run('plannedQueue = () => [{ id: "REQ-1", title: "t" }];');
  const bar = h.run('renderDevStartBar()');
  assert.match(bar, /id="devStart"[^>]*>\s*启动\s*</, '批量开发启动按钮文案为「启动」');
  // 存量已全部隐藏的设置（合法持久数据）不再影响启动（按 Agent 配置已移除）
  h.state.tasks.settings = { agents: { refine: [], develop: [] }, models: {} };
  const hiddenBar = h.run('renderDevStartBar()');
  assert.doesNotMatch(hiddenBar, /无可选执行 Agent（设置中已全部隐藏）/, '不再出现全隐藏禁用提示');
  assert.doesNotMatch(hiddenBar, /id="devStart"[^>]*disabled/, '存量全隐藏不阻断启动');
  // 批量完善创建面板（无批次）
  h.state.tasks.settings = null;
  h.state.refine.data = { batch: null, candidates: [{ id: 'REQ-20990101-001', type: 'requirement', title: 't', reasons: [] }] };
  const refineHtml = h.run('renderRefinePanel()');
  assert.match(refineHtml, /id="refineCreate"[^>]*>\s*启动\s*</, '批量完善启动按钮文案为「启动」');
});

t('K2 复制成功提示统一「任务已创建、提示词已复制，请在对应项目会话粘贴发送」；复制失败保留任务并给恢复方式', () => {
  assert.match(js, /任务已创建、提示词已复制，请在对应项目会话粘贴发送/, '统一成功提示文案');
  const devFn = js.match(/async function createBatchAndCopy[\s\S]{0,2400}/)[0];
  assert.match(devFn, /任务已创建、提示词已复制，请在对应项目会话粘贴发送/, '开发创建成功提示');
  assert.match(devFn, /重新复制/, '复制失败提示重新复制');
  const rfFn = js.match(/async function createRefineBatchAndCopy[\s\S]{0,1800}/)[0];
  assert.match(rfFn, /任务已创建、提示词已复制，请在对应项目会话粘贴发送/, '完善创建成功提示');
  assert.match(rfFn, /重新复制/, '复制失败提示重新复制');
});

// ---------- 运行面板：计数、耗时、阶段化占位 ----------

t('K3 运行面板计数为「已处理 / 异常 / 处理中 / 待处理」，当前项显示已用时', () => {
  const h = setupUI();
  h.state.batchData = {
    batch: mkBatch(),
    current: { runId: 'run-1', itemId: 'REQ-20990101-001', title: '当前项', owner: 'w', createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString() },
    counts: { total: 5, reported: 2, failed: 1, blocked: 0, interrupted: 0, remaining: 2 },
    queue: [], records: [], pending: [],
  };
  const html = h.run('renderZcodeBatchPanel()');
  assert.match(html, /已处理\s*<b>2<\/b>/, '已处理计数');
  assert.match(html, /异常\s*<b>1<\/b>/, '异常计数');
  assert.match(html, /处理中\s*<b>1<\/b>/, '处理中计数（当前在途）');
  assert.match(html, /待处理\s*<b>2<\/b>/, '待处理计数');
  assert.match(html, /已用时/, '当前项显示已用时');
  assert.match(js, /function fmtElapsed\(/, '应有耗时格式化助手');
});

t('K4 无当前项按阶段展示；终态不显示「等待领取」，也不显示暂停/恢复控件', () => {
  const h = setupUI();
  // 开发面板：终态（正常结束）
  h.state.batchData = { batch: mkBatch({ status: 'finished' }), current: null, counts: { total: 2, reported: 2, failed: 0, blocked: 0, interrupted: 0, remaining: 0 }, queue: [], records: [], pending: [] };
  const doneHtml = h.run('renderZcodeBatchPanel()');
  assert.doesNotMatch(doneHtml, /等待领取/, '终态不得显示等待领取');
  assert.doesNotMatch(doneHtml, /id="batchPause"/, '终态不得显示暂停/恢复控件');
  assert.match(doneHtml, /本轮已结束|已结束/, '终态显示明确终态');
  assert.match(doneHtml, /启动新一轮/, '终态允许启动新一轮');
  // 开发面板：已暂停（无当前项）
  h.state.batchData = { batch: mkBatch({ status: 'paused', pauseRequested: true }), current: null, counts: { total: 2, reported: 1, failed: 0, blocked: 0, interrupted: 0, remaining: 1 }, queue: [], records: [], pending: [] };
  const pausedHtml = h.run('renderZcodeBatchPanel()');
  assert.match(pausedHtml, /已暂停/, '暂停态显示已暂停');
  assert.match(pausedHtml, /id="batchPause"/, '暂停态保留恢复控件');
  // 开发面板：待启动（prepared，未登记执行）
  h.state.batchData = { batch: mkBatch({ status: 'prepared' }), current: null, counts: { total: 2, reported: 0, failed: 0, blocked: 0, interrupted: 0, remaining: 2 }, queue: [], records: [], pending: [] };
  const prepHtml = h.run('renderZcodeBatchPanel()');
  assert.match(prepHtml, /待启动/, '未登记执行显示待启动');
  assert.match(prepHtml, /粘贴/, '待启动附粘贴指引');
  // 完善面板：终态
  h.state.refine.data = { batch: { ...mkBatch(), batchId: 'RFB-20990101-001', status: 'finished' }, counts: { total: 1, done: 1, failed: 0, skipped: 0, interrupted: 0, remaining: 0 }, records: [], candidates: [] };
  const rfDone = h.run('renderRefinePanel()');
  assert.doesNotMatch(rfDone, /等待领取/, '完善终态不得显示等待领取');
  assert.match(rfDone, /本轮已结束|已结束/, '完善终态显示明确终态');
  // 完善面板：运行中无当前项
  h.state.refine.data = { batch: mkBatch({ batchId: 'RFB-20990101-002' }), counts: { total: 2, done: 0, failed: 0, skipped: 0, interrupted: 0, remaining: 2 }, records: [], candidates: [] };
  const rfRun = h.run('renderRefinePanel()');
  assert.match(rfRun, /等待领取/, '运行中无当前项显示等待领取');
});

// ---------- 最近两条：待处理队列 + 本轮处理记录 ----------

t('K5 待处理队列只显示最近 2 条（最新在前）并标注「最近 X 条 / 共 N 条」；0/1/2/>2 均正确', () => {
  const h = setupUI();
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `REQ-20990101-0${i + 1}`, type: 'requirement', title: `条目${i + 1}` }));
  const render = (n) => h.run(`pendingQueueHtml(${JSON.stringify(mk(n))}, { action: '待完善' })`);
  // 0 条：空态
  assert.match(render(0), /暂无待处理/, '0 条显示空态');
  assert.match(render(0), /共 0 条/, '0 条时总数正确');
  // 1 条
  const one = render(1);
  assert.match(one, /最近 1 条 \/ 共 1 条/, '1 条标注');
  assert.match(one, /REQ-20990101-01/, '展示该条');
  // 2 条：全部展示
  const two = render(2);
  assert.match(two, /最近 2 条 \/ 共 2 条/, '2 条标注');
  assert.ok(two.indexOf('REQ-20990101-02') < two.indexOf('REQ-20990101-01'), '最新在前');
  // 3 条：只展示最近 2 条并说明
  const three = render(3);
  assert.match(three, /最近 2 条 \/ 共 3 条/, '3 条标注总数不截断');
  assert.doesNotMatch(three, /REQ-20990101-01/, '最早一条不展示（仅最近 2 条）');
  assert.match(three, /仅显示最近 2 条/, '超出附展示限制说明');
});

t('K6 本轮处理记录为四列表格且只显示最近 2 次尝试；不出现「加载更多」/「查看批次记录」', () => {
  const h = setupUI();
  const rec = (runId, itemId, result, attempt, extra = {}) => ({ runId, itemId, title: `标题${runId}`, owner: 'w', result, attempt, at: '2026-01-01T00:00:00.000Z', reason: null, ...extra });
  const mk = (n) => Array.from({ length: n }, (_, i) => rec(`run-${i + 1}`, `REQ-20990101-00${(i % 3) + 1}`, 'done', 1));
  const render = (records, total = records.length) => h.run(`runAttemptsHtml(${JSON.stringify(records)}, ${total}, 'develop')`);
  // 表头四列
  const html = render(mk(1));
  for (const col of ['需求 / Bug', '执行状态', '次数', '操作']) assert.match(html, new RegExp(col), `表头含「${col}」`);
  assert.match(html, /最近 1 条 \/ 共 1 条/, '记录数标注');
  // 3 条只展示最近 2 次
  const three = render(mk(3), 3);
  assert.match(three, /最近 2 条 \/ 共 3 条/, '记录标注总数不截断');
  assert.doesNotMatch(three, /run-3/, '最早一次不展示（仅最近 2 次）');
  // 空态
  assert.match(render([]), /暂无执行记录/, '无记录空态');
  // 全量列表与分页入口移除（2 条仅为展示限制；Codex 面板存量分页不在此口径内）
  assert.doesNotMatch(js, /id="batchMoreRecords"|id="refineMoreRecords"/, '记录分页按钮已移除');
  assert.doesNotMatch(js, /function loadBatchRecords|function loadRefineRecords/, '分页加载函数已移除');
  assert.doesNotMatch(js, /查看批次记录|收起批次记录/, '不得再提供批次记录全量入口');
});

t('K7 记录区分需求 / Bug、显示第 N 次与异常原因；异常/已中断行提供「重新执行」，其余为「—」', () => {
  const h = setupUI();
  const records = [
    { runId: 'run-9', itemId: 'BUG-20990101-001', title: '缺陷', owner: 'w', result: 'failed', attempt: 2, at: '2026-01-01T00:00:00.000Z', reason: '执行超时' },
    { runId: 'run-8', itemId: 'REQ-20990101-002', title: '需求', owner: 'w', result: 'reported', attempt: 1, at: '2025-12-31T00:00:00.000Z', reason: null },
  ];
  const html = h.run(`runAttemptsHtml(${JSON.stringify(records)}, 2, 'develop')`);
  assert.match(html, /Bug/, 'Bug 记录带类型标识');
  assert.match(html, /需求(?!\/)/, '需求记录带类型标识');
  assert.match(html, /第 2 次/, '显示执行次数');
  assert.match(html, /执行超时/, '显示异常原因');
  assert.match(html, /data-retry-run="run-9"/, '异常记录提供重新执行');
  assert.doesNotMatch(html, /data-retry-run="run-8"/, '已上报记录不提供重新执行');
  assert.match(html, /—/, '无适用操作显示「—」');
  // interrupted（已中断）同样可重试
  const html2 = h.run(`runAttemptsHtml(${JSON.stringify([{ runId: 'run-7', itemId: 'REQ-20990101-003', title: 't', owner: 'w', result: 'interrupted', attempt: 1, at: '2026-01-01T00:00:00.000Z', reason: '人工终止' }])}, 1, 'refine')`);
  assert.match(html2, /data-retry-run="run-7"/, '已中断记录提供重新执行');
});

t('K8 重试交互：活跃任务走 /api/{batch,refine}/retry；终态任务以 ids 重建新任务并复制提示词', () => {
  assert.match(js, /\/api\/batch\/retry/, '开发重试接口');
  assert.match(js, /\/api\/refine\/retry/, '完善重试接口');
  assert.match(js, /data-retry-run/, '记录行绑定重试');
  const fn = js.match(/async function retryRunFromRecord[\s\S]*?\n\}/);
  assert.ok(fn, '应有统一重试处理函数');
  assert.match(fn[0], /ids: \[/, '终态任务按条目 ids 重建');
  assert.match(fn[0], /copyDispatchText/, '重建后自动复制调度提示词');
  // 服务端路由
  assert.match(srv, /'\/api\/batch\/retry'/, '服务端开发重试路由');
  assert.match(srv, /'\/api\/refine\/retry'/, '服务端完善重试路由');
});

// ---------- 暂停/终止 ----------

t('K9 暂停按钮文案「暂停后续领取」；暂停说明当前项继续执行', () => {
  const h = setupUI();
  h.state.batchData = { batch: mkBatch(), current: { runId: 'run-1', itemId: 'REQ-20990101-001', title: 't', owner: 'w', createdAt: new Date().toISOString() }, counts: { total: 2, reported: 0, failed: 0, blocked: 0, interrupted: 0, remaining: 2 }, queue: [], records: [], pending: [] };
  const html = h.run('renderZcodeBatchPanel()');
  assert.match(html, /暂停后续领取/, '开发面板按钮文案');
  h.state.batchData.batch = mkBatch({ pauseRequested: true, status: 'paused' });
  const paused = h.run('renderZcodeBatchPanel()');
  assert.match(paused, /恢复后续领取/, '已暂停显示恢复后续领取');
  assert.match(js, /暂停后续领取/, '完善面板同文案');
  assert.match(js, /当前项继续执行/, '暂停说明当前项继续执行');
});

// ---------- 任务设置（REQ-20260909-011：去 Agent 化精简） ----------

t('K10 任务设置精简（REQ-20260909-011）：仅通用说明 + 完善流转开关 + 保存；无五列表格与按 Agent 控件', () => {
  const h = setupUI();
  const ts = { version: 1, agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] }, models: { refine: { zcode: { source: 'follow', model: '', level: 'high' }, codex: { source: 'follow', model: '', level: 'high' } }, develop: { zcode: { source: 'follow', model: '', level: 'medium' }, codex: { source: 'follow', model: '', level: 'medium' } } } };
  const html = h.run(`taskSettingsHtml(${JSON.stringify(ts)})`);
  assert.doesNotMatch(html, /<table/, 'REQ-20260909-011：无表格（五列表格已移除）');
  for (const id of ['tsSource-', 'tsModel-', 'tsLevel-', 'tsHidden-']) {
    assert.ok(!html.includes(id), `不得出现 ${id} 控件`);
  }
  assert.match(html, /<h4>批量任务<\/h4>/, '分区标题保留');
  assert.match(html, /子代理模式/, '说明含子代理模式口径');
  assert.match(html, /跟随主调度会话/, '说明含默认跟随语义');
  assert.match(html, /id="tsAutoPlan"/, '完善完成后自动转入计划开关保留');
  assert.match(html, /id="tsSave"/, '保存按钮保留');
  assert.doesNotMatch(html, /执行 Agent/, '不再出现执行 Agent 维度');
});

t('K11 保存载荷精简：仅提交 refine 流转开关（无 agents/models 提交逻辑）', () => {
  const bind = js.match(/const tsSave = view\.querySelector\('#tsSave'\);[\s\S]{0,1200}/)[0];
  assert.match(bind, /refine: \{ autoPlanAfterDone/, '保存仅提交完善流转开关');
  assert.doesNotMatch(bind, /tsHidden-/, '不再读取隐藏复选框（控件已移除）');
  assert.doesNotMatch(bind, /agents\[kind\]/, '不再反算 agents');
});

// ---------- 头部入口与 Demo 残留 ----------

t('K12 任务模块头部不再提供「任务设置」入口；生产界面无 Demo 场景按钮', () => {
  // 口径更新（BUG-20260909-002）：头部「任务设置」按钮删除，设置统一走主导航「设置」页签
  assert.doesNotMatch(js, /taskSettingsGo/, '头部任务设置按钮应删除');
  assert.doesNotMatch(js, /data-scene|场景切换|模拟执行|模拟当前项完成/, '生产界面不得含 Demo 演示控件');
});

t('K13 /api/batch/current 提供 pending 待处理队列与 recordsTotal', () => {
  assert.match(srv, /pending:/, 'current 响应含 pending');
  assert.match(srv, /recordsTotal/, 'current 响应含 recordsTotal');
});

t('K14 最近两条样式存在（队列/记录表/计数行）', () => {
  assert.match(css, /\.task-queue\b/, '待处理队列样式');
  assert.match(css, /\.attempt-table\b/, '本轮处理记录表格样式');
  assert.match(css, /\.ts-table\b/, '任务设置表格样式');
  assert.match(css, /\.task-stats\b/, '计数行样式');
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
