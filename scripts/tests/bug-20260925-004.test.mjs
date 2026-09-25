#!/usr/bin/env node
// BUG-20260925-004 关闭文档编写编辑界面（审查对话框 / ② 二次编辑弹窗）触发整块刷新
// （「正在加载发布流程数据…」占位 + DOM 全量重建 + 滚动回顶）—— 分层测试。
// L4 行为（closeReview / closeEditDialog 只摘弹窗元素不重渲染窗格、改走后台静默同步；
//   loadEditFile 弹窗已关的迟到响应不再重渲染；syncDocsPlanSilently 未就绪回落常规加载 /
//   无变化不重绘 / 有变化更新并保持滚动 / 失败保留内容记 syncErr / 迟到响应丢弃；
//   ensurePublishPlan 成功清除 syncErr；renderPreservingDocsScroll 滚动记忆恢复）；
// L4 渲染（renderDocsPane 失败轻量横幅 + 重试入口，内容保持不进整页 error 态）；
// L4 接线（defaultPf 声明 syncErr；bindCommon 绑定 data-pf-sync-retry）；
// L6 i18n（新增文案中英齐备、动态键往返还原、EN 值不与既有词条冲突）。
// 用法：node scripts/tests/bug-20260925-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function extractFn(source, name) {
  // async 函数允许 async 前缀（本单行为接缝含 async：syncDocsPlanSilently / loadEditFile）
  const m = source.match(new RegExp(`  (?:async )?function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

function vmRun(fns, context, expr) {
  const ctx = vm.createContext(context);
  vm.runInContext(fns, ctx);
  return vm.runInContext(expr, ctx);
}

const FLOW_STUB = {
  DOCS_FLOW_LABEL: {
    unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核',
    untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核', reviewed: '已审核',
    unwritten: '未编写', pending: '待审核',
  },
  DOCS_FLOW_CLS: {
    unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait',
    untranslated: 'st-mute', translating: 'st-run', translated: 'st-wait', reviewed: 'st-ok',
    unwritten: 'st-mute', pending: 'st-wait',
  },
  DOCS_FLOW_ICON: {
    unsummarized: '○', summarizing: '◐', summarized: '●',
    untranslated: '○', translating: '◐', translated: '●', reviewed: '✔',
    unwritten: '○', pending: '●',
  },
  DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
  DOC_SINGLE_KEYS: ['LICENSE'],
  DEFAULT_DOC_LANGS: ['cn', 'en'],
  langNameOf: (l) => String(l),
  docFilesOf: (langs, customDocs) => flow.publishDocFiles(
    Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS, customDocs,
  ),
};

const ESC = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SOURCE = () => fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

/* ---------- 测试桩 ---------- */

function panePlan({ state = 'reviewed' } = {}) {
  const files = flow.publishDocFiles(['cn', 'en'], []).map((f) => ({ ...f, state }));
  return {
    langs: ['cn', 'en'], customDocs: [],
    docsFlow: { files, defaultReviewedCount: 5, restReviewedCount: 5, canFinalize: true, finalized: null, canCommit: true, missing: [], translateMissing: [] },
    summary: null, translate: null, docsCheck: null,
    docs: { overall: 'committed', commitHash: 'a'.repeat(40), reasons: [] },
  };
}

function okJson(data) {
  return { ok: true, status: 200, json: async () => data };
}

function errJson(status, error) {
  return { ok: false, status, json: async () => ({ error }) };
}

const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

/* ---------- L4 行为：关闭路径不整块刷新 ---------- */

t('L4-1 closeReview：只摘审查对话框元素（#bldReviewWrap.remove），不重渲染窗格、不进 loading、改走后台静默同步；草稿回同步先行；不再调用 ensurePublishPlan(true)', () => {
  const source = SOURCE();
  const fn = extractFn(source, 'closeReview');
  const calls = { syncDrafts: 0, silent: 0, removed: 0 };
  const pf = { phase: 'ready', plan: panePlan(), review: { open: true, key: 'README', modes: {}, contents: {}, busy: false } };
  const wrap = { remove() { calls.removed += 1; } };
  const ctx = {
    state: { pf },
    syncReviewDrafts: () => { calls.syncDrafts += 1; },
    $: (sel) => (sel === '#bldReviewWrap' ? wrap : null),
    syncDocsPlanSilently: () => { calls.silent += 1; },
    ensurePublishPlan: () => { throw new Error('closeReview 不应再触发 ensurePublishPlan（整块刷新根因）'); },
    render: () => { throw new Error('closeReview 不应整块重渲染窗格'); },
  };
  vmRun(fn, ctx, 'closeReview()');
  assert.equal(pf.review, null, '审查对话框状态关闭');
  assert.equal(calls.syncDrafts, 1, '关闭前回同步编辑草稿（防丢字）');
  assert.equal(calls.removed, 1, '只摘对话框元素（窗格 DOM 不重建）');
  assert.equal(calls.silent, 1, '关闭后转后台静默同步');
  // 源级回归：关闭路径不再包含强制刷新调用
  assert.ok(!fn.includes('ensurePublishPlan'), 'closeReview 源码不再调用 ensurePublishPlan');
  assert.ok(fn.includes('syncDocsPlanSilently'), 'closeReview 改走静默同步');
});

t('L4-2 closeEditDialog：只摘二次编辑弹窗元素（#bldEditWrap.remove），不重渲染窗格、不进 loading、改走后台静默同步；不再调用 ensurePublishPlan(true)', () => {
  const source = SOURCE();
  const fn = extractFn(source, 'closeEditDialog');
  const calls = { silent: 0, removed: 0 };
  const pf = { phase: 'ready', plan: panePlan(), edit: { open: true, file: 'README.md', mode: 'edit', content: '# x', disk: '# x', busy: false } };
  const wrap = { remove() { calls.removed += 1; } };
  const ctx = {
    state: { pf },
    $: (sel) => (sel === '#bldEditWrap' ? wrap : null),
    syncDocsPlanSilently: () => { calls.silent += 1; },
    ensurePublishPlan: () => { throw new Error('closeEditDialog 不应再触发 ensurePublishPlan（整块刷新根因）'); },
    render: () => { throw new Error('closeEditDialog 不应整块重渲染窗格'); },
  };
  vmRun(fn, ctx, 'closeEditDialog()');
  assert.equal(pf.edit, null, '编辑弹窗状态关闭');
  assert.equal(calls.removed, 1, '只摘弹窗元素（窗格 DOM 不重建）');
  assert.equal(calls.silent, 1, '关闭后转后台静默同步');
  assert.ok(!fn.includes('ensurePublishPlan'), 'closeEditDialog 源码不再调用 ensurePublishPlan');
  assert.ok(fn.includes('syncDocsPlanSilently'), 'closeEditDialog 改走静默同步');
});

t('L4-3 loadEditFile 迟到响应：弹窗已关闭（关闭动作竞态）不再重渲染窗格（内容落点已不存在，渲染只为弹窗服务）', async () => {
  const source = SOURCE();
  const fns = [extractFn(source, 'loadEditFile'), extractFn(source, 'closeEditDialog')].join('\n');
  const calls = { renders: 0, removed: 0 };
  const pf = {
    verId: 'V1', phase: 'ready', plan: panePlan(), seq: 0,
    edit: { open: true, file: 'README.md', mode: 'edit', content: null, disk: null, busy: false, loadErr: null, pending: null, savedNote: null },
  };
  const v = { id: 'V1' };
  let resolveRead;
  const ctx = {
    state: { pf, project: 'proj-x' },
    selVersion: () => v,
    pfOf: (x) => (x === v ? pf : null),
    $: (sel) => (sel === '#bldEditWrap' ? { remove() { calls.removed += 1; } } : null),
    syncDocsPlanSilently: async () => {},
    render: () => { calls.renders += 1; },
    fetch: () => ({ ok: true, json: () => new Promise((res) => { resolveRead = res; }) }),
  };
  // 打开弹窗随即关闭（磁盘读取仍在途）——正是「随即点 ✕ 关闭」的复现路径；
  // 先冲微任务让 fetch + json() 各占的拍推进到「读取在途挂起」态
  vmRun(fns, ctx, 'loadEditFile("README.md")');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(typeof resolveRead, 'function', '读取请求在途挂起');
  vmRun(fns, ctx, 'closeEditDialog()');
  const rendersAfterClose = calls.renders;
  resolveRead({ content: '# 磁盘内容' });
  await flush();
  assert.equal(pf.edit, null, '弹窗保持关闭');
  assert.equal(calls.renders, rendersAfterClose, '迟到读取响应不再重渲染（窗格不动）');
});

t('L4-4 接线：defaultPf 声明 syncErr 会话态；bindCommon 绑定 data-pf-sync-retry 重试入口；关闭函数保持既有入口（Esc / 遮罩 / ✕ 均复用 closeReview / requestEditClose 不变）', () => {
  const source = SOURCE();
  assert.match(source, /syncErr:\s*null/, 'pf 会话态字段 syncErr 声明（初始 null）');
  assert.ok(source.includes("q('[data-pf-sync-retry]')"), 'bindCommon 绑定后台同步重试按钮');
  assert.ok(source.includes('syncDocsPlanSilently()'), '重试入口调用静默同步');
  // 既有关闭入口复用同一函数（Esc / 遮罩点击 / ✕）
  assert.ok(source.includes("if (state.pf?.review?.open) { closeReview(); return; }"), 'Esc 关闭审查对话框复用 closeReview');
  assert.ok(/e\.target\?\.id === 'bldReviewWrap' && !state\.pf\?\.review\?\.busy\) closeReview\(\)/.test(source), '遮罩点击关闭复用 closeReview');
});

/* ---------- L4 行为：后台静默同步 syncDocsPlanSilently ---------- */

function syncCtx({ plan, fetchImpl } = {}) {
  const calls = { renders: 0, silentRenders: 0, seeds: 0, forces: [], gets: [] };
  const v = { id: 'V1' };
  const pf = {
    verId: 'V1', phase: 'ready', plan, seq: 3,
    syncErr: null, edit: null, review: null,
  };
  const ctx = {
    state: { pf, project: 'proj-x' },
    selVersion: () => v,
    pfOf: (x) => (x === v ? pf : null),
    ensurePublishPlan: async (force) => { calls.forces.push(!!force); },
    fetch: async (url) => { calls.gets.push(url); return fetchImpl(url, calls); },
    seedChkDecisions: () => { calls.seeds += 1; },
    renderPreservingDocsScroll: () => { calls.silentRenders += 1; },
    render: () => { calls.renders += 1; },
    esc: ESC,
  };
  return { ctx, calls, pf };
}

function syncFns(source) {
  return extractFn(source, 'syncDocsPlanSilently');
}

t('L4-5 syncDocsPlanSilently 未就绪回落：phase 非 ready / 无 plan 时转常规 ensurePublishPlan(true)（首次进入仍走既有加载占位，不发裸请求）', async () => {
  const source = SOURCE();
  const fns = syncFns(source);
  for (const bad of [{ phase: 'loading', plan: null }, { phase: 'error', plan: null }]) {
    const { ctx, calls } = syncCtx({ plan: null, fetchImpl: () => { throw new Error('未就绪不应发请求'); } });
    ctx.state.pf = { verId: 'V1', ...bad, seq: 0 };
    await vmRun(fns, ctx, 'syncDocsPlanSilently()');
    assert.deepEqual(calls.forces, [true], `回落常规加载（phase=${bad.phase}）`);
    assert.equal(calls.gets.length, 0, '不发裸请求');
  }
});

t('L4-6 成功且数据无变化：不重绘（不重渲染窗格、滚动 / 页签不动）、plan 引用不变、phase 保持 ready、不进 loading 态', async () => {
  const source = SOURCE();
  const fns = syncFns(source);
  const plan = panePlan();
  const { ctx, calls, pf } = syncCtx({ plan, fetchImpl: () => okJson(JSON.parse(JSON.stringify(plan))) });
  await vmRun(fns, ctx, 'syncDocsPlanSilently()');
  await flush();
  assert.equal(calls.silentRenders, 0, '无变化不重绘');
  assert.equal(pf.plan, plan, 'plan 引用不变（未替换）');
  assert.equal(pf.phase, 'ready', 'phase 保持 ready');
  assert.equal(pf.syncErr, null, '无失败记录');
  assert.equal(calls.gets[0].includes('/api/build/publish-plan'), true, '走 publish-plan 只读装配');
});

t('L4-7 成功且数据有变化：替换 plan + 决断重播种 + 保持滚动重绘一次（仅状态徽标 / 门禁等随新数据更新）；全程无 loading 占位', async () => {
  const source = SOURCE();
  const fns = syncFns(source);
  const plan = panePlan({ state: 'reviewed' });
  const changed = JSON.parse(JSON.stringify(plan));
  changed.docsFlow.files[0].state = 'summarized'; // 外部修改 → 四态变化
  const phases = [];
  const { ctx, calls, pf } = syncCtx({ plan, fetchImpl: () => okJson(changed) });
  ctx.renderPreservingDocsScroll = () => { phases.push(pf.phase); calls.silentRenders += 1; };
  await vmRun(fns, ctx, 'syncDocsPlanSilently()');
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(pf.plan)), changed, 'plan 更新为最新磁盘状态');
  assert.equal(pf.plan === plan, false, 'plan 已替换');
  assert.equal(calls.seeds, 1, '决断重播种（BUG-20260925-002 口径不回归）');
  assert.equal(calls.silentRenders, 1, '有变化重绘一次');
  assert.deepEqual(phases, ['ready'], '重绘时 phase 为 ready（无 loading 占位闪烁）');
  assert.equal(pf.syncErr, null, '成功清除失败记录');
});

t('L4-8 失败：保留现有内容（plan / phase 不动，不进整页 error 态）、记录 syncErr 轻量提示并保持滚动重绘一次（横幅可出现）；随后成功同步清除提示（含无变化成功也清除）', async () => {
  const source = SOURCE();
  const fns = syncFns(source);
  // ① 失败：内容保留 + syncErr 记录
  const plan = panePlan();
  const { ctx, calls, pf } = syncCtx({ plan, fetchImpl: () => errJson(500, '服务重启') });
  await vmRun(fns, ctx, 'syncDocsPlanSilently()');
  await flush();
  assert.equal(pf.plan, plan, '失败保留现有内容（plan 不动）');
  assert.equal(pf.phase, 'ready', '不进整页 error 态');
  assert.equal(pf.syncErr, '服务重启', '记录失败原因（轻量横幅数据）');
  assert.equal(calls.silentRenders, 1, '保持滚动重绘一次（横幅出现）');
  // ② 随后成功且数据无变化：清除提示（撤横幅），内容仍不动
  const second = syncCtx({ plan, fetchImpl: () => okJson(JSON.parse(JSON.stringify(plan))) });
  second.pf.syncErr = '服务重启';
  await vmRun(fns, second.ctx, 'syncDocsPlanSilently()');
  await flush();
  assert.equal(second.pf.syncErr, null, '成功后清除失败提示');
  assert.equal(second.calls.silentRenders, 1, '撤横幅重绘一次');
  assert.equal(second.pf.plan, plan, '无变化内容不动');
});

t('L4-9 迟到响应丢弃：切换版本（state.pf 身份变化）后返回的响应不写回（与 ensurePublishPlan 同口径）', async () => {
  const source = SOURCE();
  const fns = syncFns(source);
  const plan = panePlan();
  const changed = JSON.parse(JSON.stringify(plan));
  changed.docsFlow.files[0].state = 'summarized';
  const { ctx, pf } = syncCtx({ plan, fetchImpl: () => okJson(changed) });
  const p = vmRun(fns, ctx, 'syncDocsPlanSilently()');
  ctx.state.pf = { verId: 'OTHER' }; // 请求在途时切换版本
  await p;
  await flush();
  assert.equal(pf.plan, plan, '迟到响应被丢弃（旧 pf 不写回）');
  assert.equal(pf.phase, 'ready', '旧 pf 状态不被打扰');
});

/* ---------- L4 行为：滚动保持与常规加载清除 syncErr ---------- */

t('L4-10 renderPreservingDocsScroll：重渲染前记忆 #buildView 滚动位置、重建后恢复（innerHTML 塌陷 scrollTop 归零场景）；无视图容器仍执行渲染', () => {
  const source = SOURCE();
  const fns = extractFn(source, 'renderPreservingDocsScroll');
  // 有视图：render 模拟 innerHTML 重建（scrollTop 归零）→ 恢复记忆位置
  {
    const view = { scrollTop: 180 };
    const calls = { renders: 0 };
    const ctx = {
      $: (s) => (s === '#buildView' ? view : null),
      render: () => { calls.renders += 1; view.scrollTop = 0; },
    };
    vmRun(fns, ctx, 'renderPreservingDocsScroll()');
    assert.equal(calls.renders, 1, '渲染执行一次');
    assert.equal(view.scrollTop, 180, '滚动位置恢复（不回顶）');
  }
  // 无视图（测试沙箱 / 视图未挂载）：仍执行渲染
  {
    const calls = { renders: 0 };
    const ctx = { $: () => null, render: () => { calls.renders += 1; } };
    vmRun(fns, ctx, 'renderPreservingDocsScroll()');
    assert.equal(calls.renders, 1, '无视图容器不阻断渲染');
  }
});

t('L4-11 ensurePublishPlan 成功路径清除 syncErr（显式「刷新」按钮口径：常规强刷成功即撤后台同步失败横幅）', async () => {
  const source = SOURCE();
  const fns = [
    extractFn(source, 'ensurePublishPlan'),
  ].join('\n');
  const plan = panePlan();
  const v = { id: 'V1' };
  const pf = { verId: 'V1', phase: 'ready', plan, seq: 1, syncErr: '旧失败' };
  const calls = { renders: 0 };
  const ctx = {
    state: { pf, project: 'proj-x' },
    selVersion: () => v,
    pfOf: (x) => (x === v ? pf : null),
    defaultPf: (id) => ({ verId: id, seq: 0 }),
    fetch: async () => okJson(JSON.parse(JSON.stringify(plan))),
    seedChkDecisions: () => {},
    render: () => { calls.renders += 1; },
  };
  await vmRun(fns, ctx, 'ensurePublishPlan(true)');
  await flush();
  assert.equal(pf.phase, 'ready', '常规加载成功');
  assert.equal(pf.syncErr, null, '成功清除 syncErr（撤横幅）');
});

/* ---------- L4 渲染：失败轻量横幅 ---------- */

function paneFns(source) {
  return [
    extractFn(source, 'summaryBtnText'),
    extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'translateBtnHtml'),
    extractFn(source, 'finalizeBtnHtml'),
    extractFn(source, 'commitBtnHtml'),
    extractFn(source, 'docsStageBar'),
    extractFn(source, 'splitProofreadIssues'),
    extractFn(source, 'parseIssueLineNo'),
    extractFn(source, 'parseChkSuggestion'),
    extractFn(source, 'classifyChkIssue'),
    extractFn(source, 'chkPendingCount'),
    extractFn(source, 'renderDocsPane'),
  ].join('\n');
}

t('L4-12 renderDocsPane 失败轻量横幅：syncErr 有值时内容保持（文件列表 / 阶段条 / 门禁条均在）+ 横幅 + 重试入口（data-pf-sync-retry）；无 syncErr 不渲染横幅', () => {
  const fns = paneFns(SOURCE());
  const plan = panePlan({ state: 'reviewed' });
  const ctx = { pfOf: (v) => v.pf, esc: ESC, short: (h) => String(h || '').slice(0, 8), fmtTime: () => 't', ...FLOW_STUB };
  const base = { phase: 'ready', plan };
  // 无 syncErr：无横幅
  const okHtml = vmRun(fns, ctx, `renderDocsPane({ id: 'V', pf: ${JSON.stringify(base)} })`);
  assert.ok(!okHtml.includes('bld-docs-sync-err'), '无失败不渲染横幅');
  assert.ok(!okHtml.includes('data-pf-sync-retry'), '无失败无重试入口');
  // 有 syncErr：横幅 + 重试 + 内容保持
  const errHtml = vmRun(fns, ctx, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ ...base, syncErr: '服务重启' })} })`);
  assert.ok(errHtml.includes('bld-docs-sync-err'), '失败横幅容器');
  assert.ok(errHtml.includes('后台同步失败：服务重启'), '失败原因呈现');
  assert.ok(errHtml.includes('当前内容保持不变'), '口径说明（保留现有内容）');
  assert.ok(errHtml.includes('data-pf-sync-retry'), '重试入口');
  assert.ok(errHtml.includes('重试同步'), '重试按钮文案');
  for (const keep of ['bld-docs-list', 'bld-docs-stages', 'bld-docs-gate', 'role="tabpanel"']) {
    assert.ok(errHtml.includes(keep), `内容保持：${keep}`);
  }
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：失败横幅与重试按钮新增文案中英齐备、动态键往返还原、EN 值不与既有词条冲突', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const zhSentence = '后台同步失败：◇——当前内容保持不变，可重试或点「刷新」全量更新';
  assert.ok('重试同步' in EN, '静态词条：重试同步');
  assert.ok(zhSentence in EN_DYNAMIC, '动态词条：失败横幅句');
  // EN 值不与既有词条冲突（新增两条值唯一）
  const vals = Object.values(EN);
  assert.equal(vals.filter((x) => x === 'Retry sync').length, 1, '静态 EN 值唯一');
  // 动态键往返还原（插值 → 英文 → 中文）
  I.setLang('en');
  const en = I.t('后台同步失败：服务重启——当前内容保持不变，可重试或点「刷新」全量更新');
  assert.ok(en.startsWith('Background sync failed: 服务重启'), `英文形态：${en}`);
  assert.ok(en.includes('current content is unchanged'), '保留现有内容口径翻译');
  assert.ok(en.includes('"Refresh"'), '刷新入口指引翻译');
  assert.equal(I.t('重试同步'), 'Retry sync', '按钮文案英文');
  I.setLang('zh');
  assert.equal(I.t(en), '后台同步失败：服务重启——当前内容保持不变，可重试或点「刷新」全量更新', '动态键往返还原');
  assert.equal(I.t('重试同步'), '重试同步', '中文还原');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✕ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
if (failed) {
  console.error(`\n${failed} 例失败`);
  process.exit(1);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
