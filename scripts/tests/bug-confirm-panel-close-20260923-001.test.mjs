#!/usr/bin/env node
// BUG-20260923-001 挂起确认面板 busy 期间三个关闭入口（✕ / 底部「关闭」/ Esc）静默失效，
// 只能刷新关闭 —— 修复回归。
// 用法：node scripts/tests/bug-confirm-panel-close-20260923-001.test.mjs
// 覆盖（README 验收说明）：
//   · A 组 静态契约：三入口解除 busy 门控；closeConfirmPanel 仅操作 UI（不触网不中断任务）
//     且复位本地忙标志；
//   · P 组 面板核心（vm 片段）：busy 期间 closeConfirmPanel 立即关闭并复位 busy；重开同样
//     复位；关闭后迟到详情不回写（既有行为保持）；
//   · F 组 入口绑定（vm 片段）：busy=true 时点底部「关闭」仍调用 closeConfirmPanel；
//   · W 组 watchConfirmTask：停止谓词（面板已关 / 切换）触发即停止观察；默认路径不回归；
//   · B 组 动作生命周期（vm 片段）：开发侧确认观察期关面板 → 任务结论不写已关面板、
//     全局刷新保留、busy 不滞留；动作请求带 60 秒超时（signal 接线）；超时错误归一人话；
//     旧动作迟到 finally 不复位重开面板上新动作的 busy；
//   · C 组 中英同步：「请求超时（◇ 秒无响应）」进 EN_DYNAMIC。
// 模式对齐 bug-confirm-panel-open-20260915-001 / bug-20260920-003（真实 app.js 片段 + vm）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const appSource = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const frag = (start, end) => {
  const s = appSource.indexOf(start);
  const e = appSource.indexOf(end);
  assert.ok(s > 0 && e > s, `app.js 应包含片段 ${start.slice(0, 40)}…`);
  return appSource.slice(s, e);
};
const flushUntil = async (cond, label) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), `等待条件超时：${label}`);
};

/* ---------- 公共：vm 装载与节点桩 ---------- */

function element(id, extra = {}) {
  const classes = new Set();
  return {
    id, textContent: '', value: '', disabled: false, listeners: {}, focused: false,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    isConnected: true,
    focus() { this.focused = true; },
    ...extra,
  };
}

// 面板核心片段（setConfirmPanelView → renderConfirmForm）：与 bug-confirm-panel-open-20260915-001 同口径
const PANEL_FRAG = frag('function setConfirmPanelView(', 'function renderConfirmForm(');
// 动作片段（confirmContinueAction → 已计划列）：与 bug-20260920-003 同口径
const ACTION_FRAG = frag('async function confirmContinueAction(', '/* ---------- 已计划列多选');
// keep/draft 片段（confirmKeepAction → confirmContinueAction）
const KEEP_FRAG = frag('async function confirmKeepAction(', 'async function confirmContinueAction(');
// 绑定片段（bindConfirmFormActions → confirmKeepAction）
const BIND_FRAG = frag('function bindConfirmFormActions(', 'async function confirmKeepAction(');
// 任务观察片段（watchConfirmTask 独立）
const WATCH_FRAG = frag('async function watchConfirmTask(', '/* ---------- 挂起确认侧拉面板');

function panelNodes(nodes) {
  for (const id of ['confirmPanel', 'confirmPanelLoading', 'confirmPanelError', 'confirmPanelErrorText', 'confirmForm']) {
    nodes.set(`#${id}`, element(id));
  }
}

/* ---------- A 组：静态契约 ---------- */

t('A1 三个关闭入口均不再被 busy 门控（✕ / 底部关闭 / Esc 链）', () => {
  assert.equal(
    [...appSource.matchAll(/if \(!confirmSide\.busy\) closeConfirmPanel\(\)/g)].length,
    0,
    '不得存在「可点击但静默无响应」的 busy 门控',
  );
  assert.ok(html.includes('id="confirmPanelClose"'), '头部 ✕ 节点存在（index.html）');
  assert.ok(appSource.includes('id="confirmPanelCancel"'), '底部「关闭」按钮由 renderConfirmForm 动态渲染');
  assert.ok(
    appSource.includes("$('#confirmPanelClose')?.addEventListener('click', () => closeConfirmPanel());"),
    '头部 ✕ 无条件关闭',
  );
  assert.match(
    appSource,
    /form\.querySelector\('#confirmPanelCancel'\)\?\.addEventListener\('click', \(\) => closeConfirmPanel\(\)\);/,
    '底部「关闭」无条件关闭',
  );
  assert.match(
    appSource,
    /if \(confirmPanelOpen\(\)\) \{[^\n]*\n\s*closeConfirmPanel\(\);\s*\n\s*return;\s*\n\s*\}/,
    'Esc 链挂起确认面板层无条件关闭（层级顺序不变）',
  );
});

t('A2 closeConfirmPanel 仅操作 UI：不触网、不中断服务端任务，并复位本地忙标志', () => {
  const body = frag('function closeConfirmPanel(', 'async function loadConfirmDetail(');
  assert.ok(!/\bapi\(/.test(body), '关闭不发起任何请求');
  assert.ok(!/abort/i.test(body), '关闭不携带中断语义');
  assert.match(body, /confirmSide\.busy = false/, '关闭复位本地忙标志');
});

t('A3 openConfirmPanel 重开复位本地忙标志（重开面板忙态由服务端任务状态推导）', () => {
  const body = frag('async function openConfirmPanel(', 'function closeConfirmPanel(');
  assert.match(body, /confirmSide\.busy = false/, '打开时复位忙标志');
});

/* ---------- P 组：面板核心（busy 期间可关 / 复位 / 迟到详情不回写） ---------- */

function setupPanel(apiImpl) {
  const nodes = new Map();
  panelNodes(nodes);
  const calls = { api: [] };
  const ctx = vm.createContext({
    $: (sel) => nodes.get(sel) || null,
    document: { activeElement: null },
    confirmSide: { open: true, busy: false, id: 'BUG-1', seq: 2, detail: null, attr: new Map(), needsReverify: false, opener: null },
    state: { confirms: { detail: new Map() } },
    api: async (url) => { calls.api.push(String(url)); return apiImpl(String(url)); },
    renderConfirmForm: () => {},
  });
  vm.runInContext(PANEL_FRAG, ctx, { filename: 'app-frag-panel-core.js' });
  return { ctx, nodes, calls, run: (code) => vm.runInContext(code, ctx), hidden: (id) => nodes.get(`#${id}`).classList.contains('hidden') };
}

t('P1 busy（正在核验提交与测试…）期间 closeConfirmPanel 立即隐藏面板并复位忙标志', () => {
  const h = setupPanel(() => ({ itemId: 'BUG-1' }));
  h.ctx.confirmSide.busy = true;
  h.run('closeConfirmPanel()');
  assert.equal(h.hidden('confirmPanel'), true, '面板立即隐藏');
  assert.equal(h.ctx.confirmSide.open, false);
  assert.equal(h.ctx.confirmSide.busy, false, '本地忙标志随关闭复位');
});

t('P2 重新打开面板同样复位残留忙标志', async () => {
  const h = setupPanel(() => ({ itemId: 'BUG-1' }));
  h.ctx.confirmSide.busy = true;
  await h.run('openConfirmPanel("BUG-1")');
  assert.equal(h.hidden('confirmPanel'), false);
  assert.equal(h.ctx.confirmSide.busy, false, '重开复位忙标志（运行态改由服务端任务状态推导）');
});

t('P3 关闭后的迟到详情仍不回写面板（既有迟到丢弃行为保持）', async () => {
  let resolve;
  const h = setupPanel(() => new Promise((r) => { resolve = r; }));
  const pending = h.run('openConfirmPanel("BUG-1")');
  h.run('closeConfirmPanel()');
  resolve({ itemId: 'BUG-1' });
  await pending;
  assert.equal(h.hidden('confirmPanel'), true);
  assert.equal(h.ctx.state.confirms.detail.size, 0);
});

/* ---------- F 组：入口绑定（busy=true 点击仍关闭） ---------- */

t('F1 busy=true 时点底部「关闭」按钮仍调用 closeConfirmPanel', () => {
  const nodes = new Map();
  panelNodes(nodes);
  const cancel = element('confirmPanelCancel');
  const form = nodes.get('#confirmForm');
  form.querySelector = (sel) => (sel === '#confirmPanelCancel' ? cancel : null);
  form.querySelectorAll = () => [];
  const closeCalls = [];
  const ctx = vm.createContext({
    $: (sel) => nodes.get(sel) || null,
    esc: (s) => String(s ?? ''),
    confirmSide: { open: true, busy: true, id: 'BUG-1', seq: 1, attr: new Map(), needsReverify: false },
    closeConfirmPanel: () => closeCalls.push(1),
    confirmKeepAction: async () => {},
    verifyConfirmItem: async () => {},
    confirmDraftAction: async () => {},
    confirmContinueAction: async () => {},
    loadConfirmDiff: async () => {},
    updateConfirmScopeSummary: () => {},
    toast: () => {},
  });
  vm.runInContext(BIND_FRAG, ctx, { filename: 'app-frag-bind.js' });
  vm.runInContext('bindConfirmFormActions({ itemId: "BUG-1", kind: "develop", files: [] })', ctx);
  cancel.listeners.click();
  assert.equal(closeCalls.length, 1, 'busy 期间点击「关闭」应立即关闭（不再静默吞掉）');
});

/* ---------- W 组：watchConfirmTask 停止谓词 ---------- */

function setupWatch(apiImpl, shouldStop) {
  const calls = { api: [] };
  const ctx = vm.createContext({
    api: async (url) => { calls.api.push(String(url)); return apiImpl(String(url)); },
    setTimeout,
  });
  vm.runInContext(WATCH_FRAG, ctx, { filename: 'app-frag-watch.js' });
  return { ctx, calls, run: (code) => vm.runInContext(code, ctx) };
}

t('W1 面板已关 / 已切换（停止谓词为真）即停止观察：只观察一轮，不再空转轮询', async () => {
  const h = setupWatch(() => ({ task: { status: 'running' } }));
  // 第 1 次检查放行一轮，第 2 次为真 → 停止（谓词在 vm 内自包含）
  const r = await h.run(`(() => { let checks = 0; return watchConfirmTask('BUG-1', 2500, () => ++checks >= 2); })()`);
  assert.equal(r, null, '停止谓词触发 → 返回 null（交还主轮询接管呈现）');
  assert.equal(h.calls.api.length, 1, '停止前仅观察一轮，不继续空转');
});

t('W2 无停止谓词的默认路径不回归：轮询至终态返回任务', async () => {
  const h = setupWatch(() => ({ task: { status: 'done', result: { ok: true } } }));
  const r = await h.run(`watchConfirmTask('BUG-1', 5000)`);
  assert.equal(r.status, 'done');
  assert.equal(r.result.ok, true);
});

/* ---------- B 组：动作生命周期（观察期关闭 / 超时接线 / 迟到隔离） ---------- */

function actionCtx({ confirmSide, apiImpl, watchImpl }) {
  const nodes = new Map();
  panelNodes(nodes);
  for (const id of ['confirmContinueBtn', 'confirmKeepBtn', 'confirmVerifyBtn', 'confirmDraftBtn']) {
    const el = element(id);
    el.textContent = id === 'confirmContinueBtn' ? '确认并继续' : '';
    nodes.set(`#${id}`, el);
  }
  const calls = { api: [], msgs: [], toasts: [], refresh: 0, watch: [] };
  const ctx = vm.createContext({
    $: (sel) => nodes.get(sel) || null,
    document: { activeElement: null },
    confirmSide,
    state: { confirms: { detail: new Map(), busyId: null }, project: '/tmp/proj-x' },
    // AbortSignal 桩：验证 60 秒超时接线，不产生真实定时器
    AbortSignal: { timeout: (ms) => ({ aborted: false, __stub: true, __ms: ms }) },
    api: async (url, opts) => { calls.api.push({ url: String(url), opts }); return apiImpl(String(url), opts); },
    renderConfirmForm: () => {},
    esc: (s) => String(s ?? ''),
    toast: (text) => calls.toasts.push(String(text)),
    refreshConfirms: async () => { calls.refresh += 1; },
    poll: async () => {},
    collectAnalysisAnswers: () => [{ q: 'Q1', text: '按推荐执行' }],
    watchConfirmTask: async (...args) => { calls.watch.push(args); return watchImpl(...args); },
    fetchAndCopyResumePrompt: async () => {},
  });
  vm.runInContext(PANEL_FRAG, ctx, { filename: 'app-frag-panel-core.js' });
  vm.runInContext(ACTION_FRAG, ctx, { filename: 'app-frag-action.js' });
  // 片段内的真实 confirmPanelMsg 会因消息节点不存在而静默返回——覆盖回记录桩
  ctx.confirmPanelMsg = (text) => calls.msgs.push(String(text));
  return { ctx, nodes, calls, run: (code) => vm.runInContext(code, ctx), hidden: (id) => nodes.get(`#${id}`).classList.contains('hidden') };
}

const devDetail = {
  itemId: 'BUG-1', kind: 'develop', state: 'waiting', fingerprint: 'fp-1', files: [],
};

t('B1 开发侧确认观察期（busy）关面板：立即关闭；结论不写已关面板；全局刷新保留；busy 不滞留', async () => {
  let releaseWatch;
  const watchGate = new Promise((r) => { releaseWatch = r; });
  const h = actionCtx({
    confirmSide: { open: true, busy: false, id: 'BUG-1', seq: 3, detail: null, attr: new Map(), needsReverify: false, opener: null },
    apiImpl: (url) => {
      if (url.includes('/api/confirms/BUG-1/continue')) return { accepted: true, task: { timeoutMs: 1000 } };
      throw new Error(`未预期的请求：${url}`);
    },
    watchImpl: () => watchGate,
  });
  const pending = h.run(`confirmContinueAction(${JSON.stringify(devDetail)})`);
  await flushUntil(() => h.ctx.confirmSide.busy === true && h.calls.watch.length === 1, '进入运行态并开始观察');
  assert.equal(h.nodes.get('#confirmContinueBtn').textContent, '正在核验提交与测试…', '按钮进入运行文案');
  // 观察窗口仍随任务超时口径（BUG-20260918-004）：timeoutMs + 20s
  assert.equal(h.calls.watch[0][0], 'BUG-1');
  assert.equal(h.calls.watch[0][1], 21_000);
  const shouldStop = h.calls.watch[0][2];
  assert.equal(typeof shouldStop, 'function', '观察带停止谓词（面板关闭 / 切换即停）');
  assert.equal(shouldStop(), false, '面板打开期间不停止');
  // busy 期间关闭面板（真实 closeConfirmPanel：隐藏 + 复位 busy）
  h.run('closeConfirmPanel()');
  assert.equal(h.hidden('confirmPanel'), true, 'busy（正在核验）期间可立即关闭');
  assert.equal(h.ctx.confirmSide.busy, false, '关闭复位本地忙标志');
  assert.equal(shouldStop(), true, '面板已关 → 停止观察（服务端任务不受影响）');
  const refreshAtClose = h.calls.refresh;
  releaseWatch({ status: 'done', result: { ok: true, supplementCommits: [] } });
  await pending;
  assert.equal(h.ctx.confirmSide.busy, false, '迟到终态不把 busy 滞留为 true');
  assert.ok(!h.calls.msgs.some((m) => /已确认恢复/.test(m)), '结论不写已关面板（下次打开按实际状态呈现）');
  assert.ok(!h.calls.toasts.some((m) => /已确认恢复/.test(m)), '已关面板不补发确认成功 toast');
  assert.ok(h.calls.refresh >= refreshAtClose, '任务页卡片的全局刷新保留');
});

t('B2 面板动作请求带 60 秒客户端超时（keep / answer / continue 全量接线），超时错误归一人话且 busy 复位', async () => {
  const timeoutErr = () => {
    const e = new Error('signal timed out');
    e.name = 'TimeoutError';
    return e;
  };
  const h = actionCtx({
    confirmSide: { open: true, busy: false, id: 'REQ-1', seq: 0, detail: null, attr: new Map(), needsReverify: false, opener: null },
    apiImpl: (url) => {
      if (url.includes('/answer')) return { ok: true, ready: true };
      if (url.includes('/continue')) throw timeoutErr();
      throw new Error(`未预期的请求：${url}`);
    },
    watchImpl: () => null,
  });
  await h.run(`confirmContinueAction(${JSON.stringify({
    itemId: 'REQ-1', kind: 'analyze', state: 'waiting', questionsVersion: 'v1', batchId: 'batch-9',
    questions: [{ id: 'Q1', text: '方案取舍？', required: true }],
  })})`);
  const answer = h.calls.api.find((c) => c.url.includes('/answer'));
  const cont = h.calls.api.find((c) => c.url.includes('/continue'));
  assert.ok(answer?.opts?.signal?.__stub && answer.opts.signal.__ms === 60_000, '作答保存请求带 60 秒超时');
  assert.ok(cont?.opts?.signal?.__stub && cont.opts.signal.__ms === 60_000, '确认请求带 60 秒超时');
  assert.ok(h.calls.msgs.some((m) => /确认失败：请求超时（60 秒无响应）（可重试）/.test(m)), '超时按人话可重试错误呈现');
  assert.equal(h.ctx.confirmSide.busy, false, '超时后 busy 复位（不永久滞留「进行中」）');
  assert.equal(h.nodes.get('#confirmContinueBtn').disabled, false, '确认按钮恢复可重试');
});

t('B3 旧动作迟到 finally 不复位重开面板上新动作的 busy（面板代隔离）', async () => {
  let releaseKeep;
  let releaseAnswer;
  const keepGate = new Promise((r) => { releaseKeep = r; });
  const answerGate = new Promise((r) => { releaseAnswer = r; });
  const nodes = new Map();
  panelNodes(nodes);
  for (const id of ['confirmContinueBtn', 'confirmKeepBtn', 'confirmVerifyBtn', 'confirmDraftBtn']) {
    const el = element(id);
    el.textContent = id === 'confirmContinueBtn' ? '确认并继续' : '';
    nodes.set(`#${id}`, el);
  }
  // 表单桩：collectAnalysisAnswers（keep 片段内的真实实现）从 textarea 收集到一条作答
  const ta = element('ta');
  ta.dataset = { cq: 'Q1' };
  ta.value = '按推荐执行';
  const form = nodes.get('#confirmForm');
  form.querySelectorAll = (sel) => (sel === 'textarea[data-cq]' ? [ta] : []);
  form.querySelector = () => null;
  const calls = { api: [], msgs: [], toasts: [], refresh: 0 };
  const ctx = vm.createContext({
    $: (sel) => nodes.get(sel) || null,
    document: { activeElement: null },
    confirmSide: { open: true, busy: false, id: 'BUG-1', seq: 0, detail: null, attr: new Map(), needsReverify: false, opener: null },
    state: { confirms: { detail: new Map(), busyId: null } },
    CSS: { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    AbortSignal: { timeout: (ms) => ({ aborted: false, __stub: true, __ms: ms }) },
    api: async (url, opts) => {
      calls.api.push({ url: String(url), opts });
      if (url.includes('/keep')) return keepGate;
      if (url.includes('/answer')) return answerGate;
      if (url.includes('/api/confirms/BUG-1')) return { itemId: 'BUG-1', kind: 'develop', files: [] };
      throw new Error(`未预期的请求：${url}`);
    },
    renderConfirmForm: () => {},
    toast: (text) => calls.toasts.push(String(text)),
    refreshConfirms: async () => { calls.refresh += 1; },
    poll: async () => {},
    watchConfirmTask: async () => null,
  });
  vm.runInContext(PANEL_FRAG, ctx, { filename: 'app-frag-panel-core.js' });
  vm.runInContext(KEEP_FRAG, ctx, { filename: 'app-frag-keep.js' });
  vm.runInContext(ACTION_FRAG, ctx, { filename: 'app-frag-action.js' });
  ctx.confirmPanelMsg = (text) => calls.msgs.push(String(text)); // 同 actionCtx：覆盖真实实现为记录桩
  const run = (code) => vm.runInContext(code, ctx);

  // 1) 旧动作：保持挂起请求悬挂期间关闭面板
  const keepP = run(`confirmKeepAction(${JSON.stringify(devDetail)})`);
  await flushUntil(() => ctx.confirmSide.busy === true, '保持挂起进入 busy');
  const keepCall = calls.api.find((c) => c.url.includes('/keep'));
  assert.ok(keepCall?.opts?.signal?.__stub && keepCall.opts.signal.__ms === 60_000, '保持挂起请求同样带 60 秒超时');
  run('closeConfirmPanel()');
  assert.equal(ctx.confirmSide.busy, false, '关闭复位 busy');
  // 2) 重开面板并启动新动作（保存草稿）
  await run('openConfirmPanel("BUG-1")');
  const draftP = run(`confirmDraftAction(${JSON.stringify({ itemId: 'BUG-1', kind: 'analyze', state: 'waiting' })})`);
  await flushUntil(() => ctx.confirmSide.busy === true, '保存草稿进入 busy');
  // 3) 旧动作迟到收尾：不得复位新动作的 busy，也不向新面板写旧消息
  releaseKeep();
  await keepP;
  assert.equal(ctx.confirmSide.busy, true, '旧动作迟到 finally 不复位新面板的 busy');
  assert.ok(!calls.msgs.some((m) => /已保持挂起/.test(m)), '旧动作消息不写重开后的面板');
  // 4) 新动作正常收尾：busy 复位、消息写入
  releaseAnswer({ ok: true, ready: true });
  await draftP;
  assert.equal(ctx.confirmSide.busy, false, '新动作收尾正常复位 busy');
  assert.ok(calls.msgs.some((m) => /草稿已保存/.test(m)), '新动作消息正常写入');
});

/* ---------- C 组：中英同步 ---------- */

t('C1 新增超时文案进 EN_DYNAMIC（中英同步，值无中文）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN_DYNAMIC } = I._dict;
  const v = EN_DYNAMIC['请求超时（◇ 秒无响应）'];
  assert.ok(v, 'EN_DYNAMIC 应含「请求超时（◇ 秒无响应）」');
  assert.ok(!/[\u4e00-\u9fff]/.test(v), 'EN 值不含中文');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); }
}
console.log(`\n共 ${cases.length} 例，${failed ? `${failed} 例失败` : '全部通过'}`);
process.exitCode = failed ? 1 : 0;
