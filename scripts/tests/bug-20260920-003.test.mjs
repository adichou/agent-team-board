#!/usr/bin/env node
// BUG-20260920-003 AI 分析人工确认续跑闭环：确认成功自动复制一次当前分析批次的续跑提示词，
// 面板常驻「去 AI Agent 粘贴发送」引导卡；复制失败 / 获取失败 / 空提示词如实分态反馈。
// —— F 组：vm 片段（confirmContinueAction + 续跑提示词卡状态机）驱动真实源码；
//   S 组：静态契约（面板挂载点 / 草稿与保持挂起不触发 / 样式）；
//   I 组：中英文词典同步与死键清理。
// 用法：node scripts/tests/bug-20260920-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const appSource = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 公共：vm 片段装载（confirmContinueAction → 续跑提示词整段） ---------- */

const FRAG_START = 'async function confirmContinueAction(';
const FRAG_END = '/* ---------- 已计划列多选';

function element(id) {
  const qs = new Map();
  return {
    id, innerHTML: '', textContent: '', disabled: false,
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    querySelector(sel) { return qs.get(sel) || null; },
    _qs: qs,
  };
}

function escFn(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 续跑提示词卡按钮（重新复制 / 重新获取 / 显式复制）挂在卡容器内
function cardButtons() {
  const recopy = element('confirmResumeRecopy');
  const refetch = element('confirmResumeRefetch');
  const copy = element('confirmResumeCopy');
  const box = element('confirmResumeCard');
  box._qs.set('#confirmResumeRecopy', recopy);
  box._qs.set('#confirmResumeRefetch', refetch);
  box._qs.set('#confirmResumeCopy', copy);
  return { box, recopy, refetch, copy };
}

function setup() {
  const nodes = new Map();
  for (const id of ['confirmContinueBtn', 'confirmKeepBtn', 'confirmVerifyBtn', 'confirmDraftBtn']) {
    nodes.set(`#${id}`, element(id));
  }
  const btns = cardButtons();
  nodes.set('#confirmForm #confirmResumeCard', btns.box);
  const calls = { api: [], copies: [], toasts: [], msgs: [] };
  const h = {
    continueResult: { ok: true, itemId: 'REQ-1', runId: 'run-1', batchId: 'batch-9' },
    refineResult: { batch: { prompt: 'REFINE-PROMPT-MAIN' } },
    copyResult: true,
    answerResult: { ok: true, ready: true },
    answers: [{ q: 'Q1', text: '按推荐执行' }],
  };
  const ctx = {
    $: (sel) => nodes.get(sel) || null,
    esc: escFn,
    confirmSide: { open: true, busy: false, id: 'REQ-1', needsReverify: false },
    state: { confirms: { busyId: null, resume: new Map() }, project: '/tmp/proj-x' },
    api: async (url, opts) => {
      calls.api.push({ url: String(url), opts });
      if (String(url).includes('/api/confirms/REQ-1/answer')) return h.answerResult;
      if (String(url).includes('/api/confirms/REQ-1/continue')) return h.continueResult;
      if (String(url).includes('/api/refine/current')) {
        if (typeof h.refineResult === 'function') return h.refineResult(String(url));
        return h.refineResult;
      }
      throw new Error(`未预期的请求：${url}`);
    },
    copyDispatchText: async (text) => { calls.copies.push(text); return h.copyResult; },
    collectAnalysisAnswers: () => h.answers,
    refreshConfirms: async () => {},
    loadConfirmDetail: async () => {},
    poll: async () => {},
    toast: (text) => calls.toasts.push(String(text)),
    confirmPanelMsg: (text) => calls.msgs.push(String(text)),
    watchConfirmTask: async () => null,
  };
  vm.createContext(ctx);
  const start = appSource.indexOf(FRAG_START);
  const end = appSource.indexOf(FRAG_END);
  assert.ok(start > 0 && end > start, 'app.js 应包含确认继续 + 续跑提示词片段');
  vm.runInContext(appSource.slice(start, end), ctx, { filename: 'app-frag-bug-20260920-003.js' });
  return {
    h, ctx, calls, btns,
    resume: () => ctx.state.confirms.resume.get('REQ-1') || null,
    run: (code) => vm.runInContext(code, ctx),
  };
}

function analyzeDetail(over = {}) {
  return {
    itemId: 'REQ-1',
    kind: 'analyze',
    state: 'waiting',
    questionsVersion: 'v1',
    batchId: 'batch-9',
    questions: [{ id: 'Q1', text: '方案取舍？', required: true }],
    ...over,
  };
}

async function flushUntil(cond, label) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), `等待条件超时：${label}`);
}

const confirmCalls = (h) => h.calls.api.filter((c) => c.url.includes('/continue'));
const refineCalls = (h) => h.calls.api.filter((c) => c.url.includes('/api/refine/current'));

/* ---------- F 组：确认成功自动复制一次 + 状态机分态 ---------- */

t('F1 确认且排队成功 → 自动复制一次当前分析批次提示词，卡内常驻粘贴发送引导（含条目与项目）', async () => {
  const h = setup();
  await h.run(`confirmContinueAction(${JSON.stringify(analyzeDetail())})`);
  await flushUntil(() => h.resume() && h.resume().status !== 'fetching', '自动复制完成');
  assert.equal(h.calls.copies.length, 1, '仅自动复制一次');
  assert.equal(h.calls.copies[0], 'REFINE-PROMPT-MAIN', '复制的是当前分析批次完整提示词');
  assert.equal(refineCalls(h).length, 1, '提示词按批次获取一次');
  assert.ok(refineCalls(h)[0].url.includes('batchId=batch-9'), '获取携带确认返回的批次号（当前分析批次）');
  assert.equal(h.resume().status, 'copied');
  const html = h.btns.box.innerHTML;
  assert.match(html, /已确认并加入续跑队列。续跑提示词已复制，请到当前项目的 AI Agent 调度会话粘贴并发送/, '成功口径含粘贴发送引导');
  assert.match(html, /条目 REQ-1 · 项目 \/tmp\/proj-x/, '反馈含条目编号与项目路径');
  assert.match(html, /不等于 Agent 已开始执行/, '区分排队与 Agent 执行');
  assert.match(html, /id="confirmResumeRecopy"/, '提供显式重新复制入口');
  assert.match(html, />REFINE-PROMPT-MAIN</, '完整提示词文本可选中手动复制');
  assert.ok(h.calls.msgs.some((m) => /已确认并加入续跑队列/.test(m)), '确认反馈不再宣称自动执行');
});

t('F2 复制失败 → 排队结果保留、明确失败原因、完整文本与重新复制入口（不重复确认）', async () => {
  const h = setup();
  h.h.copyResult = false;
  await h.run(`confirmContinueAction(${JSON.stringify(analyzeDetail())})`);
  await flushUntil(() => h.resume() && h.resume().status === 'copy-failed', '复制失败落账');
  assert.equal(h.calls.copies.length, 1, '尝试过一次复制');
  assert.equal(confirmCalls(h).length, 1, '未重复提交确认');
  const html = h.btns.box.innerHTML;
  assert.match(html, /续跑提示词复制失败/, '明确复制失败');
  assert.match(html, /已确认并加入续跑队列/, '已确认与排队结果保留');
  assert.match(html, />REFINE-PROMPT-MAIN</, '完整提示词仍可选中文本');
  assert.match(html, /id="confirmResumeRecopy"/, '重新复制入口');
});

t('F3 获取失败 → 不复制、不显示复制成功；显示原因与重新获取（排队结果保留）', async () => {
  const h = setup();
  h.h.refineResult = () => { throw new Error('服务不可用'); };
  await h.run(`confirmContinueAction(${JSON.stringify(analyzeDetail())})`);
  await flushUntil(() => h.resume() && h.resume().status === 'fetch-failed', '获取失败落账');
  assert.equal(h.calls.copies.length, 0, '获取失败不触发复制');
  assert.equal(h.resume().error, '服务不可用', '失败原因如实记录');
  const html = h.btns.box.innerHTML;
  assert.match(html, /续跑提示词获取失败：服务不可用/, '显示获取失败原因');
  assert.match(html, /id="confirmResumeRefetch"/, '重新获取入口');
  assert.ok(!/续跑提示词已复制/.test(html), '不显示复制成功');
  assert.ok(!/>REFINE-PROMPT-MAIN</.test(h.btns.box.innerHTML), '未获取到不渲染提示词文本');
});

t('F4 提示词为空 → 不复制空文本、不显示复制成功；提供重新获取', async () => {
  const h = setup();
  h.h.refineResult = { batch: { prompt: '   ' } };
  await h.run(`confirmContinueAction(${JSON.stringify(analyzeDetail())})`);
  await flushUntil(() => h.resume() && h.resume().status === 'empty', '空态落账');
  assert.equal(h.calls.copies.length, 0, '不复制空文本');
  const html = h.btns.box.innerHTML;
  assert.match(html, /提示词为空/, '空态说明');
  assert.match(html, /id="confirmResumeRefetch"/, '重新获取入口');
  assert.ok(!/续跑提示词已复制/.test(html), '不显示复制成功');
});

t('F5 重开已确认面板 → 不自动覆盖剪贴板，仅显式复制入口；点击后按批次获取并复制（不重复确认）', async () => {
  const h = setup();
  const d = analyzeDetail({ state: 'confirmed' });
  h.run(`renderConfirmResumeCard(${JSON.stringify(d)})`);
  const html = h.btns.box.innerHTML;
  assert.match(html, /重开面板不会自动复制/, '说明重开不自动复制');
  assert.match(html, /id="confirmResumeCopy"/, '显式复制入口');
  assert.equal(h.calls.copies.length, 0, '渲染本身不触发剪贴板');
  assert.equal(refineCalls(h).length, 0, '渲染本身不发起获取');
  await h.btns.copy.listeners.click();
  await flushUntil(() => h.resume() && h.resume().status === 'copied', '显式复制完成');
  assert.deepEqual(h.calls.copies, ['REFINE-PROMPT-MAIN']);
  assert.ok(refineCalls(h)[0].url.includes('batchId=batch-9'), '按条目批次获取');
  assert.equal(confirmCalls(h).length, 0, '显式复制不重复确认');
});

t('F6 复制失败后重新复制 → 同一份提示词再试，不产生新的确认或批次请求', async () => {
  const h = setup();
  h.h.copyResult = false;
  await h.run(`confirmContinueAction(${JSON.stringify(analyzeDetail())})`);
  await flushUntil(() => h.resume() && h.resume().status === 'copy-failed', '复制失败落账');
  h.h.copyResult = true;
  await h.btns.recopy.listeners.click();
  await flushUntil(() => h.resume().status === 'copied', '重新复制成功');
  assert.deepEqual(h.calls.copies, ['REFINE-PROMPT-MAIN', 'REFINE-PROMPT-MAIN'], '复制同一份提示词');
  assert.equal(confirmCalls(h).length, 1, '不重复确认');
  assert.equal(refineCalls(h).length, 1, '重试复制不重新获取、不新建批次');
});

t('F7 确认失败（未答齐 / 版本过期 / 排队失败）→ 不触发提示词获取与复制，展示服务端原因', async () => {
  const h = setup();
  h.h.continueResult = { ok: false, itemId: 'REQ-1', reasons: ['必答问题未答齐（缺 Q1）：完成作答后才能确认并继续'] };
  await h.run(`confirmContinueAction(${JSON.stringify(analyzeDetail())})`);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.calls.copies.length, 0, '确认失败不复制');
  assert.equal(refineCalls(h).length, 0, '确认失败不获取提示词');
  assert.equal(h.resume(), null, '无续跑提示词状态');
  assert.ok(h.calls.msgs.some((m) => /必答问题未答齐/.test(m) && /确认未通过/.test(m)), '展示服务端原因');
});

t('F8 获取 / 复制进行中防重复触发：在途点击直接忽略（单次请求）', async () => {
  const h = setup();
  let release;
  const gate = new Promise((r) => { release = r; });
  h.h.refineResult = () => gate.then(() => ({ batch: { prompt: 'PROMPT-GATED' } }));
  const d = analyzeDetail();
  const p1 = h.run(`fetchAndCopyResumePrompt(${JSON.stringify(d)}, 'batch-9')`);
  await flushUntil(() => h.resume() && h.resume().status === 'fetching', '进入获取中');
  await h.run(`fetchAndCopyResumePrompt(${JSON.stringify(d)}, 'batch-9')`);
  assert.equal(refineCalls(h).length, 1, '在途重复触发被忽略');
  release();
  await p1;
  await flushUntil(() => h.resume().status === 'copied', '完成后落账');
  assert.equal(h.calls.copies.length, 1);
});

/* ---------- S 组：静态契约 ---------- */

t('S1 分析确认面板挂载续跑提示词卡容器并渲染（开发确认不受影响）', () => {
  assert.ok(appSource.includes('<div id="confirmResumeCard"></div>'), '分析确认表单应含 #confirmResumeCard 挂载点');
  assert.match(appSource, /bindConfirmFormActions\(d\);\s*\r?\n\s*renderConfirmResumeCard\(d\);/, '表单渲染后回填续跑提示词卡');
});

t('S2 保存草稿 / 保持挂起不触发续跑复制：相关函数不含续跑复制调用', () => {
  const start = appSource.indexOf('async function confirmKeepAction(');
  const end = appSource.indexOf('async function confirmContinueAction(');
  assert.ok(start > 0 && end > start, '应包含草稿 / 保持挂起片段');
  const frag = appSource.slice(start, end);
  assert.ok(!frag.includes('fetchAndCopyResumePrompt'), '草稿与保持挂起不得触发续跑提示词复制');
  assert.ok(!frag.includes('copyDispatchText'), '草稿与保持挂起不得触碰剪贴板');
});

t('S3 自动复制仅由确认成功分支触发一次（队列 / 轮询刷新链路无自动复制）', () => {
  const trigger = appSource.match(/void fetchAndCopyResumePrompt\(d, r\.batchId \|\| d\.batchId \|\| null\)/);
  assert.ok(trigger, '确认成功分支应触发一次自动复制（携带批次号）');
  const occurrences = [...appSource.matchAll(/fetchAndCopyResumePrompt\(/g)].length;
  assert.ok(occurrences >= 1, '函数存在');
  // 调用点 = 定义 1 + 自动复制 1 + 卡内按钮（重新获取 / 显式复制）2；refreshConfirms / loadConfirmDetail 片段不含触发
  const refreshFrag = appSource.slice(appSource.indexOf('async function refreshConfirms('), appSource.indexOf('function confirmKindChip('));
  assert.ok(!refreshFrag.includes('fetchAndCopyResumePrompt'), '清单刷新不自动复制');
});

t('S4 样式：续跑提示词卡（排队 / 复制结果分态）与提示词文本区样式存在', () => {
  assert.match(css, /\.confirm-resume\b/, '续跑提示词卡容器样式');
  assert.match(css, /\.confirm-resume \.cr-line\.ok/, '复制成功态样式');
  assert.match(css, /\.confirm-resume \.cr-line\.bad/, '失败态样式');
  assert.match(css, /\.confirm-resume \.cr-meta/, '条目 / 项目元信息样式');
  assert.match(css, /\.confirm-resume \.batch-prompt/, '完整提示词文本区（可滚动选中）');
});

/* ---------- I 组：中英文同步 ---------- */

t('I1 新增文案进 EN / EN_DYNAMIC：值无中文、动态键有 ASCII 锚点、静态值唯一', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  const staticKeys = [
    '✓ 已确认并加入续跑队列。续跑提示词已复制，请到当前项目的 AI Agent 调度会话粘贴并发送，继续当前条目分析。',
    '已确认并加入续跑队列，但续跑提示词复制失败：请手动选中下方提示词复制，或点「重新复制」（不会重复确认、不回滚答案、不新建任务）',
    '已确认并加入续跑队列，正在获取并自动复制续跑提示词…（仅本次确认自动复制一次；轮询 / 刷新不会覆盖剪贴板）',
    '已确认并加入续跑队列。续跑提示词需人工复制：重开面板不会自动复制。',
    '「已进入续跑队列」不等于 Agent 已开始执行：提示词需人工到 AI Agent 会话粘贴发送后，续跑才继续。',
    '续跑提示词（当前分析任务，完整文本可选中手动复制）：',
    '当前分析任务的提示词为空：不复制空文本、不显示复制成功。已确认与排队结果保留，可点「重新获取」。',
    '已确认并加入续跑队列：正在自动复制续跑提示词，请按下方引导到 AI Agent 会话粘贴发送',
    '重新获取',
    '复制续跑提示词',
    '复制当前分析任务的续跑提示词（不新建任务、不重复确认）：需人工到 AI Agent 会话粘贴发送',
    '重试复制同一份续跑提示词：不会重复确认、不创建新任务、不丢失答案',
    '重新获取当前分析任务提示词并尝试复制：不会重复确认、不新建任务',
  ];
  for (const k of staticKeys) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  const dynamicKeys = [
    '条目 ◇ · 项目 ◇',
    '续跑提示词获取失败：◇。已确认与排队结果保留（不会重复确认），可点「重新获取」。',
  ];
  for (const k of dynamicKeys) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
    assert.ok(/[A-Za-z]/.test(EN_DYNAMIC[k]), `动态英文模板须有 ASCII 锚点（防反向自匹配）：${k}`);
  }
  const values = Object.values(EN);
  for (const k of staticKeys) {
    assert.equal(values.filter((v) => v === EN[k]).length, 1, `EN 值唯一：${k}`);
  }
});

t('I2 误导口径死键清理：旧「正在继续当前条目分析」词条随文案更新移除', async () => {
  await import('../web/i18n.js');
  const { EN } = globalThis.ATBI18N._dict;
  assert.ok(!('已确认，正在继续当前条目分析（完成后才处理下条）' in EN), '旧口径词条应移除（不再宣称自动继续）');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${String(e && e.message ? e.message : e).split('\n').join('\n  ')}`);
  }
}
console.log(`\n${cases.length} 用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
