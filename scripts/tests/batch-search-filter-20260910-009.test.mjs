#!/usr/bin/env node
// BUG-20260910-009 任务模块搜索不过滤批量完善/批量开发面板 —— 静态契约 + vm 全源码渲染测试
// （参照 tasks-panel-26 / search-module-20260910-009 风格；覆盖 test-cases.md F1–F4 / L1–L3 / C1–C3）。
// 用法：node scripts/tests/batch-search-filter-20260910-009.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(root, 'scripts', 'web', 'app.js'), 'utf8');

let failed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
};

// ---------- vm 沙箱（加载事件绑定之前的全部渲染代码，真实 state 可用；同 tasks-panel-26） ----------

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
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    navigator: { clipboard: { writeText: async () => true } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(js.split('\nboot();')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/p';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; uiConfirm = async () => true;');
  return { sandbox, state, run };
}

// 取函数体（从 `function name(` 起到下一个顶层 `\n}` 止）
const fnBody = (src, name) => {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `未找到函数 ${name}`);
  return m[1];
};

const refineBatch = (extra = {}) => ({
  batchId: 'RFB-20990101-001', mode: 'subagent', agent: 'subagent', status: 'running',
  abortRequested: false, aborted: false, pauseRequested: false, developer: '张三',
  createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:10:00.000Z',
  candidates: [], prompt: '调度提示词', ...extra,
});
const devBatch = (extra = {}) => ({
  batchId: 'batch-20990101-001', mode: 'zcode', agent: 'zcode', status: 'running',
  abortRequested: false, aborted: false, pauseRequested: false, developer: null,
  createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:10:00.000Z',
  candidates: [], prompt: '调度提示词', ...extra,
});

// ---------- F 接线与面板消费 ----------

t('F1 两面板保持空参签名并消费 state.search?.q；renderBatchDrawer 仍传 renderCodexPanel(q)；runSearch runs 分支清签名重渲染', () => {
  const refine = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/);
  assert.ok(refine, 'renderRefinePanel 应保持空参签名（既有契约测试按空参正则提取）');
  assert.match(refine[0], /state\.search\?\.q/, 'renderRefinePanel 需消费 state.search?.q（可选链兼容最小桩 state）');
  const dev = js.match(/function renderZcodeBatchPanel\(\)[\s\S]*?\n\}/);
  assert.ok(dev, 'renderZcodeBatchPanel 应保持空参签名');
  assert.match(dev[0], /state\.search\?\.q/, 'renderZcodeBatchPanel 需消费 state.search?.q');
  const drawer = fnBody(js, 'renderBatchDrawer');
  assert.match(drawer, /renderCodexPanel\(q\)/, 'Codex 深链面板传参保留（不回退）');
  const run = fnBody(js, 'runSearch');
  assert.match(run, /state\.batchSig = ''; renderBatchDrawer\(\)/, 'runSearch runs 分支仍走清签名 + 重渲染');
});

t('F2 批量完善：启动态候选队列与运行态待完善队列按关键词收窄、大小写不敏感、清空恢复全量', () => {
  const h = setupUI();
  const cands = [
    { id: 'REQ-20990101-001', type: 'requirement', title: '搜索模块优化', reasons: [] },
    { id: 'BUG-20990101-002', type: 'bug', title: '任务面板不过滤', reasons: [] },
    { id: 'REQ-20990101-003', type: 'requirement', title: '其他需求', reasons: [] },
  ];
  h.state.refine.data = { batch: null, candidates: cands };
  h.state.search.q = '';
  const full = h.run('renderRefinePanel()');
  assert.match(full, /REQ-20990101-003/, '全量含最近 2 条中的条目 3');
  assert.match(full, /BUG-20990101-002/, '全量含最近 2 条中的条目 2');
  // 关键词命中条目编号（大小写不敏感）：只留条目 1，标注被过滤条数
  h.state.search.q = 'req-20990101-001';
  const hitId = h.run('renderRefinePanel()');
  assert.match(hitId, /REQ-20990101-001/, '命中编号的条目保留');
  assert.ok(!hitId.includes('BUG-20990101-002'), '未命中的条目应被过滤');
  assert.match(hitId, /（2 条被搜索过滤）/, '标注被过滤条数');
  // 关键词命中标题
  h.state.search.q = '任务面板';
  const hitTitle = h.run('renderRefinePanel()');
  assert.match(hitTitle, /BUG-20990101-002/, '命中标题的条目保留');
  assert.ok(!hitTitle.includes('REQ-20990101-001'), '未命中条目应被过滤');
  // 无匹配：显示无匹配空态，不误显「暂无」
  h.state.search.q = '不存在的关键词';
  const miss = h.run('renderRefinePanel()');
  assert.match(miss, /没有匹配的待处理条目，清空搜索恢复。/, '无匹配空态文案');
  assert.ok(!miss.includes('暂无待处理条目'), '不得误显「暂无待处理条目」');
  // 清空恢复全量
  h.state.search.q = '';
  const restored = h.run('renderRefinePanel()');
  assert.match(restored, /BUG-20990101-002/, '清空后恢复全量');
  assert.ok(!restored.includes('被搜索过滤'), '清空后无过滤标注');
  // 运行态「队列」页签的待完善队列同口径
  h.state.refine.data = {
    batch: refineBatch({ candidates: cands }),
    counts: { total: 3, done: 0, failed: 0, skipped: 0, interrupted: 0, remaining: 3 },
    current: null, records: [], candidates: cands,
  };
  h.state.search.q = 'REQ-20990101-003';
  const runHtml = h.run('renderRefinePanel()');
  assert.match(runHtml, /REQ-20990101-003/, '运行态待完善队列命中条目保留');
  assert.ok(!runHtml.includes('BUG-20990101-002</span>'), '运行态待完善队列未命中条目被过滤');
});

t('F3 批量开发：启动态待开发队列与运行态待处理队列按关键词收窄并恢复', () => {
  const h = setupUI();
  const planned = [
    { id: 'REQ-20990101-101', title: '队列甲', status: 'planned', createdAt: '2026-01-01T00:00:01.000Z' },
    { id: 'REQ-20990101-102', title: '队列乙', status: 'planned', createdAt: '2026-01-01T00:00:02.000Z' },
  ];
  h.run(`plannedQueue = () => ${JSON.stringify(planned.map(({ id, title }) => ({ id, title })))};`);
  h.state.batchData = { batch: null, stats: { candidates: 2, blocked: 0 } };
  h.state.search.q = '队列乙';
  const start = h.run('renderZcodeBatchPanel()');
  assert.match(start, /REQ-20990101-102/, '启动态待开发队列命中条目保留');
  assert.ok(!start.includes('REQ-20990101-101'), '启动态未命中条目被过滤');
  h.state.search.q = '';
  const startFull = h.run('renderZcodeBatchPanel()');
  assert.match(startFull, /REQ-20990101-101/, '清空后启动态恢复全量');
  // 运行态待处理队列（queue 页签，pending 数据源）
  h.state.batchData = {
    batch: devBatch(),
    counts: { total: 2, reported: 0, failed: 0, blockedRuns: 0, interrupted: 0, remaining: 2 },
    current: null, records: [], recordsTotal: 0,
    pending: [{ id: 'REQ-20990101-201', title: '开发甲' }, { id: 'REQ-20990101-202', title: '开发乙' }],
    queue: [], stats: { candidates: 2, blocked: 0 },
  };
  h.state.search.q = 'REQ-20990101-202';
  const runHtml = h.run('renderZcodeBatchPanel()');
  assert.match(runHtml, /REQ-20990101-202/, '运行态待处理队列命中条目保留');
  assert.ok(!runHtml.includes('REQ-20990101-201</span>'), '运行态待处理队列未命中条目被过滤');
});

t('F4 概况与启动区保持全量口径：候选统计与启动按钮资格不随关键词收窄', () => {
  const h = setupUI();
  h.state.refine.data = {
    batch: null,
    candidates: [
      { id: 'REQ-20990101-001', type: 'requirement', title: '搜索模块优化', reasons: [] },
      { id: 'BUG-20990101-002', type: 'bug', title: '任务面板不过滤', reasons: [] },
    ],
  };
  h.state.search.q = '完全不能命中的词';
  const html = h.run('renderRefinePanel()');
  assert.match(html, /已接受未完善 <b>2<\/b> 项/, '候选统计保持全量计数（不随关键词收窄）');
  assert.match(html, /id="refineCreate"[^>]*>\s*启动\s*</, '有全量候选时启动按钮仍可用');
  assert.ok(!/id="refineCreate"[^>]*disabled/.test(html), '启动资格不得因关键词无匹配被禁用');
});

// ---------- L 列表过滤（共用函数 / 排队批次） ----------

t('L1 pendingQueueHtml 按 id/title 过滤：标注被过滤条数、命中计数收窄、无匹配与全量空两空态不混淆、不传 q 零回归', () => {
  const h = setupUI();
  const items = [
    { id: 'REQ-20990101-001', title: '搜索甲' },
    { id: 'REQ-20990101-002', title: '搜索乙' },
    { id: 'REQ-20990101-003', title: '其他' },
  ];
  const render = (q) => h.run(`pendingQueueHtml(${JSON.stringify(items)}, { action: '待完善'${q === undefined ? '' : `, q: ${JSON.stringify(q)}`} })`);
  // 不传 q 与传空串输出一致（零回归）
  assert.equal(render(), render(''), '不传 q 与 q=\'\' 输出必须一致');
  const base = render();
  assert.match(base, /最近 2 条 \/ 共 3 条/, '基线计数口径不变');
  assert.ok(!base.includes('被搜索过滤'), '无关键词时不得出现过滤标注');
  // 命中 1 条：收窄 + 标注 2 条被过滤
  const hit = render('搜索乙');
  assert.match(hit, /REQ-20990101-002/, '命中条目保留');
  assert.ok(!hit.includes('REQ-20990101-003'), '未命中条目被过滤');
  assert.match(hit, /（2 条被搜索过滤）/, '标注被过滤条数');
  assert.match(hit, /最近 1 条 \/ 共 1 条/, '命中计数随过滤收窄');
  // 无匹配：无匹配空态，不误显「暂无」
  const miss = render('zzz-不存在');
  assert.match(miss, /没有匹配的待处理条目，清空搜索恢复。/, '无匹配空态文案');
  assert.ok(!miss.includes('暂无待处理条目'), '不得误显「暂无待处理条目」');
  // 全量即空：仍显示「暂无」
  const empty = h.run(`pendingQueueHtml([], { action: '待完善', q: '任意词' })`);
  assert.match(empty, /暂无待处理条目。/, '全量即空仍显示「暂无待处理条目」');
  assert.ok(!empty.includes('没有匹配'), '全量空不得显示「没有匹配」');
});

t('L2 runAttemptsHtml 按 runId/itemId/title/owner 过滤：账面「共 N 条」不收窄、标注、无匹配空态、不传 q 零回归', () => {
  const h = setupUI();
  const recs = [
    { runId: 'run-20990101-101', itemId: 'REQ-20990101-001', title: '标题甲', owner: 'zcode-batch-1', result: 'reported', attempt: 1, at: '2026-01-01T00:00:00.000Z' },
    { runId: 'run-20990101-102', itemId: 'REQ-20990101-002', title: '标题乙', owner: 'zcode-batch-2', result: 'failed', reason: 'x', attempt: 1, at: '2026-01-01T00:01:00.000Z' },
    { runId: 'run-20990101-103', itemId: 'REQ-20990101-003', title: '标题丙', owner: 'zcode-batch-3', result: 'reported', attempt: 2, at: '2026-01-01T00:02:00.000Z' },
  ];
  const render = (q) => h.run(`runAttemptsHtml(${JSON.stringify(recs)}, 7, 'develop'${q === undefined ? '' : `, ${JSON.stringify(q)}`})`);
  assert.equal(render(), render(''), '不传 q 与 q=\'\' 输出必须一致');
  const base = render();
  assert.match(base, /最近 2 条 \/ 共 7 条/, '基线计数口径不变（账面 7）');
  // 执行器匹配（大小写不敏感）
  const byOwner = render('ZCODE-BATCH-2');
  assert.match(byOwner, /run-20990101-102/, '按执行器（owner）命中记录');
  assert.ok(!byOwner.includes('run-20990101-101'), '未命中记录被过滤');
  assert.match(byOwner, /（2 条被搜索过滤）/, '标注被过滤条数（仅计已加载）');
  assert.match(byOwner, /共 7 条/, '「共 N 条」保持全量账面不收窄');
  // 执行编号 / 标题匹配
  assert.match(render('run-20990101-103'), /REQ-20990101-003/, '按执行编号命中');
  assert.match(render('标题丙'), /REQ-20990101-003/, '按标题命中');
  // 无匹配：空态区分
  const miss = render('zzz-不存在');
  assert.match(miss, /没有匹配的处理记录，清空搜索恢复。/, '无匹配空态文案');
  assert.ok(!miss.includes('暂无执行记录'), '有记录但无命中不得显示「暂无执行记录」');
  const empty = h.run(`runAttemptsHtml([], 0, 'develop', '任意词')`);
  assert.match(empty, /暂无执行记录/, '全量即空仍显示「暂无执行记录」');
});

t('L3 排队批次按批次号过滤：收窄、标注、无匹配空态；无排队批次整节不显示（REQ-20260910-027 起不再按开发人员匹配）', () => {
  const h = setupUI();
  const mkData = (queue) => ({
    batch: devBatch(),
    counts: { total: 1, reported: 0, failed: 0, blockedRuns: 0, interrupted: 0, remaining: 1 },
    current: null, records: [], recordsTotal: 0, pending: [],
    queue,
    stats: { candidates: 0, blocked: 0 },
  });
  const queue = [
    { batchId: 'batch-20990101-002', status: 'prepared', queuePosition: 2, total: 3, createdAt: '2026-01-01T00:00:00.000Z', developer: '张三' },
    { batchId: 'batch-20990101-003', status: 'prepared', queuePosition: 3, total: 2, createdAt: '2026-01-01T00:01:00.000Z', developer: '李四' },
  ];
  h.state.batchData = mkData(queue);
  h.state.search.q = '';
  const full = h.run('renderZcodeBatchPanel()');
  assert.match(full, /batch-20990101-002/, '全量含排队批次 2');
  assert.match(full, /batch-20990101-003/, '全量含排队批次 3');
  assert.ok(!full.includes('开发人员'), '排队批次行不再展示开发人员');
  // 按批次号过滤
  h.state.search.q = 'batch-20990101-003';
  const byId = h.run('renderZcodeBatchPanel()');
  assert.match(byId, /batch-20990101-003/, '命中批次号的排队批次保留');
  assert.ok(!byId.includes('batch-20990101-002</span>'), '未命中排队批次被过滤');
  assert.match(byId, /（1 条被搜索过滤）/, '标注被过滤的排队批次数');
  // REQ-20260910-027：开发人员不再是匹配字段——按开发人员姓名搜索不命中排队批次
  h.state.search.q = '李四';
  const byDev = h.run('renderZcodeBatchPanel()');
  assert.match(byDev, /没有匹配的排队批次，清空搜索恢复。/, '按开发人员搜索应无命中（字段已移除）');
  // 无匹配空态；清空恢复
  h.state.search.q = 'zzz-不存在';
  const miss = h.run('renderZcodeBatchPanel()');
  assert.match(miss, /没有匹配的排队批次，清空搜索恢复。/, '无匹配排队批次空态');
  h.state.search.q = '';
  const restored = h.run('renderZcodeBatchPanel()');
  assert.match(restored, /batch-20990101-002/, '清空后恢复全量排队批次');
  // 无排队批次：整节不显示（现状保留）
  h.state.batchData = mkData([]);
  const none = h.run('renderZcodeBatchPanel()');
  assert.ok(!none.includes('排队批次'), '无排队批次时整节不显示');
});

// ---------- C 一致性与不回退 ----------

t('C1 反馈条 runs 分支文案与真实过滤口径一致（含执行器与批次号说明，仍声明不发请求）', () => {
  const feed = fnBody(js, 'renderSearchFeedback');
  assert.ok(
    js.includes('关键词在下方面板内前端过滤（编号 / 标题 / 执行器；排队批次含批次号），不发请求'),
    'runs 分支文案需与实际过滤字段一致',
  );
  assert.match(feed, /前端过滤/, '反馈条保留前端过滤口径说明');
});

t('C2 Codex 深链过滤零改动（renderCodexPanel(q) / renderCxRuns 既有行为不回退）', () => {
  assert.ok(js.includes('renderCodexPanel(q)'), 'renderBatchDrawer 仍向 Codex 面板传 q');
  const runs = fnBody(js, 'renderCxRuns');
  assert.match(runs, /没有匹配的执行记录，清空搜索恢复。/, 'renderCxRuns 无匹配空态保留');
  assert.match(runs, /条被搜索过滤/, 'renderCxRuns 过滤标注保留');
});

t('C3 过滤纯前端：两面板与列表渲染函数内不出现任何 /api/ 请求调用', () => {
  for (const name of ['renderRefinePanel', 'renderZcodeBatchPanel', 'pendingQueueHtml', 'runAttemptsHtml']) {
    assert.doesNotMatch(fnBody(js, name), /\/api\//, `${name} 不得发起请求`);
  }
});

if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log('\n全部通过');
