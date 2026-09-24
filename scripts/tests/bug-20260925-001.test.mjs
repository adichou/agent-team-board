#!/usr/bin/env node
// BUG-20260925-001 校对建议列表接受 / 拒绝 / 轮询重渲染后滚动位置丢失（跳回第一条）
// —— 分层测试。
// L4 纯函数（build.js：captureChkScroll / restoreChkListScroll / applyChkScrollAfterRender）；
// L4 渲染（renderDocsPane 建议卡片带 data-chk-idx 锚点钩子）；
// L4 行为（acceptChkSuggestion / rejectChkSuggestion 置锚点 pf.chkAnchor）。
// 无新增界面文案，不涉及 i18n。
// 用法：node scripts/tests/bug-20260925-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function extractFn(source, name) {
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

/* ---------- 假 DOM 工具（滚动位置 / 可视区矩形） ---------- */

const mkCard = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) });
// 列表容器：可视区 [top, top + height]，scrollTop 可读写，querySelector 定位锚点卡片
const mkList = ({ top = 0, height = 200, scrollTop = 0, card = null } = {}) => ({
  scrollTop,
  clientHeight: height,
  getBoundingClientRect: () => ({ top, bottom: top + height }),
  querySelector: () => card,
});
const mkView = (list) => ({ querySelector: (sel) => (sel === '.bld-chk-list' ? list : null) });

function scrollFns(source) {
  return [
    extractFn(source, 'captureChkScroll'),
    extractFn(source, 'restoreChkListScroll'),
    extractFn(source, 'applyChkScrollAfterRender'),
  ].join('\n');
}

/* ---------- L4 纯函数：滚动位置记忆 / 恢复 ---------- */

t('L4-1 captureChkScroll：重渲染前抓 .bld-chk-list 滚动位置（scrollTop 210 → {top:210}；scrollTop 0 也返回 {top:0}）；无列表返回 null', () => {
  const fns = scrollFns(SOURCE());
  const ctx = vm.createContext({ captureView: mkView({ scrollTop: 210 }), zeroView: mkView({ scrollTop: 0 }), noneView: mkView(null) });
  vm.runInContext(fns, ctx);
  // 返回对象在 vm realm 内创建（跨 realm 原型不同），按字段断言
  const r210 = vm.runInContext('captureChkScroll(captureView)', ctx);
  assert.ok(r210 && typeof r210.top === 'number', '返回记忆对象');
  assert.equal(r210.top, 210, '记忆滚动位置');
  const r0 = vm.runInContext('captureChkScroll(zeroView)', ctx);
  assert.ok(r0 && r0.top === 0, 'scrollTop 0 也是有效记忆');
  assert.equal(vm.runInContext('captureChkScroll(noneView)', ctx), null, '无列表 → null');
});

t('L4-2 restoreChkListScroll：恢复记忆位置；锚点卡片按 nearest 口径微调（上方露出→上移贴顶 / 下方越界→下移贴底 / 可见→不动）；锚点卡片缺失回落纯恢复；listEl null 安全', () => {
  const fns = scrollFns(SOURCE());
  const run = (listEl, saved, anchor) => {
    const ctx = vm.createContext({ listEl });
    vm.runInContext(fns, ctx);
    vm.runInContext(`restoreChkListScroll(listEl, ${JSON.stringify(saved)}, ${JSON.stringify(anchor)})`, ctx);
    return listEl ? listEl.scrollTop : null;
  };
  // 轮询重渲染：无锚点，纯恢复记忆位置
  assert.equal(run(mkList({ scrollTop: 0 }), { top: 130 }, null), 130, '恢复记忆位置');
  // 锚点卡片在可视区外下方（top 250 bottom 330 > 200）→ 下移贴底：130 + (330-200) = 260
  assert.equal(run(mkList({ scrollTop: 130, card: mkCard(250, 330) }), { top: 130 }, { runId: 'r', file: 'F', idx: 2 }), 260, '下方越界下移贴底');
  // 锚点卡片上方露出（top -30 < 0）→ 上移贴顶：130 - 30 = 100
  assert.equal(run(mkList({ scrollTop: 130, card: mkCard(-30, 50) }), { top: 130 }, { runId: 'r', file: 'F', idx: 0 }), 100, '上方露出上移贴顶');
  // 锚点卡片完全可见（top 20 bottom 90 ∈ [0,200]）→ 不动
  assert.equal(run(mkList({ scrollTop: 130, card: mkCard(20, 90) }), { top: 130 }, { runId: 'r', file: 'F', idx: 1 }), 130, '可见不动（nearest）');
  // 锚点卡片缺失（重渲染后条目不存在）→ 回落纯恢复
  assert.equal(run(mkList({ scrollTop: 0, card: null }), { top: 130 }, { runId: 'r', file: 'F', idx: 9 }), 130, '锚点缺失回落恢复');
  // 无记忆（首渲染）+ 锚点在下方 → 从顶部滚到可见
  assert.equal(run(mkList({ scrollTop: 0, card: mkCard(150, 260) }), null, { runId: 'r', file: 'F', idx: 3 }), 60, '无记忆锚定下方条目');
  // listEl null / saved null 不抛错
  assert.doesNotThrow(() => run(null, { top: 130 }, null), 'listEl null 安全');
  assert.equal(run(mkList({ scrollTop: 42 }), null, null), 42, 'saved null 不动');
});

t('L4-3 applyChkScrollAfterRender：决断渲染消费锚点（清空 pf.chkAnchor 并滚到该条）；busy 中间渲染不消费（锚点保留到决断渲染）；换 run 锚点丢弃；主动换文件 chkScrollReset 从顶部开始且标志复位；无列表安全', () => {
  const fns = scrollFns(SOURCE());
  const mkPf = (extra = {}) => ({
    plan: { docsCheck: { runId: 'chk-9', phase: 'done', files: {}, issues: {} } },
    chkBusy: null, chkAnchor: null, chkScrollReset: false, ...extra,
  });
  const apply = (pf, view, saved) => {
    const ctx = vm.createContext({ state: { pf }, view });
    vm.runInContext(fns, ctx);
    return vm.runInContext(`applyChkScrollAfterRender(view, ${JSON.stringify(saved)})`, ctx);
  };
  // 决断渲染（chkBusy 已清空）：消费锚点 → 清空 + nearest 滚到该条 + 恢复记忆位置
  {
    const pf = mkPf({ chkAnchor: { runId: 'chk-9', file: 'CHANGELOG.md', idx: 2 } });
    const list = mkList({ scrollTop: 0, card: mkCard(250, 330) });
    apply(pf, mkView(list), { top: 130 });
    assert.equal(pf.chkAnchor, null, '锚点一次性消费');
    assert.equal(list.scrollTop, 260, '滚动落到锚定条目');
  }
  // busy 中间渲染：锚点保留（决断渲染再消费），只恢复记忆位置
  {
    const pf = mkPf({ chkBusy: 'chk-9|CHANGELOG.md|2', chkAnchor: { runId: 'chk-9', file: 'CHANGELOG.md', idx: 2 } });
    const list = mkList({ scrollTop: 0, card: mkCard(250, 330) });
    apply(pf, mkView(list), { top: 130 });
    assert.deepEqual(pf.chkAnchor, { runId: 'chk-9', file: 'CHANGELOG.md', idx: 2 }, 'busy 渲染不消费锚点');
    assert.equal(list.scrollTop, 130, 'busy 渲染恢复记忆位置');
  }
  // 换 run（新一轮校对覆盖旧结论）：锚点失效丢弃，仅恢复记忆位置
  {
    const pf = mkPf({ chkAnchor: { runId: 'chk-old', file: 'CHANGELOG.md', idx: 1 } });
    const list = mkList({ scrollTop: 0 });
    apply(pf, mkView(list), { top: 88 });
    assert.equal(pf.chkAnchor, null, '换 run 锚点丢弃');
    assert.equal(list.scrollTop, 88, '仍恢复记忆位置');
  }
  // 主动换文件：从顶部开始（不恢复旧文件偏移），标志复位
  {
    const pf = mkPf({ chkScrollReset: true });
    const list = mkList({ scrollTop: 0 });
    apply(pf, mkView(list), { top: 130 });
    assert.equal(list.scrollTop, 0, '换文件从顶部开始');
    assert.equal(pf.chkScrollReset, false, '复位标志一次性');
  }
  // 无列表（空态 / running 等）：安全，锚点与标志照样清理
  {
    const pf = mkPf({ chkAnchor: { runId: 'chk-9', file: 'F', idx: 0 }, chkScrollReset: true });
    assert.doesNotThrow(() => apply(pf, mkView(null), null), '无列表安全');
    assert.equal(pf.chkAnchor, null, '无列表也清锚点');
    assert.equal(pf.chkScrollReset, false, '无列表也复位');
  }
  // state.pf 缺席（非文档编写步 / 未加载）：安全
  assert.doesNotThrow(() => {
    const ctx = vm.createContext({ state: {}, view: mkView(mkList()) });
    vm.runInContext(fns, ctx);
    vm.runInContext('applyChkScrollAfterRender(view, { top: 5 })', ctx);
  }, 'state.pf 缺席安全');
});

/* ---------- L4 渲染：卡片锚点钩子 ---------- */

function panePlan({ docsCheck = null, langs = ['cn', 'en'], customDocs = [] } = {}) {
  const ls = langs;
  const list = flow.publishDocFiles(ls, customDocs).map((f, i) => ({ ...f, state: i < 6 ? 'reviewed' : (f.lang === ls[0] ? 'summarized' : 'untranslated') }));
  return {
    langs, customDocs,
    docsFlow: {
      files: list,
      defaultReviewedCount: list.filter((f) => f.lang !== ls.slice(1).find((x) => x === f.lang) && f.state === 'reviewed').length,
      restReviewedCount: list.filter((f) => f.lang !== ls[0] && f.state === 'reviewed').length,
      canFinalize: true, finalized: null, canCommit: false, missing: [], translateMissing: [],
    },
    summary: null, translate: null, docsCheck,
    docs: { overall: 'none', reasons: [] },
  };
}

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

t('L4-4 renderDocsPane 建议卡片带 data-chk-idx 锚点钩子（0 基连续；既有 li.bld-chk-issue 结构与接受 / 拒绝钩子不变）', () => {
  const fns = paneFns(SOURCE());
  const issues = ['第 12 行：原文「坏境」→ 建议「环境」', '第 20 行：原文「测式」→ 建议「测试」', '第 37 行：原文「的的生成」→ 建议「的生成」'].join('\n');
  const doneRun = {
    runId: 'chk-9', phase: 'done',
    files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail' },
    issues: { 'CHANGELOG.md': issues },
    counts: { pass: 1, fail: 1, pending: 0, total: 2 },
  };
  const ctx = {
    pfOf: (v) => v.pf,
    esc: ESC, short: (h) => String(h || '').slice(0, 8), fmtTime: () => 't',
    ...FLOW_STUB,
  };
  const html = vmRun(fns, ctx, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan: panePlan({ docsCheck: doneRun }), chkFile: 'CHANGELOG.md' })} })`);
  assert.equal((html.match(/<li class="bld-chk-issue"/g) || []).length, 3, '3 条建议卡片');
  for (let i = 0; i < 3; i += 1) {
    assert.ok(html.includes(`data-chk-idx="${i}"`), `卡片 ${i} 带锚点钩子`);
  }
  // 锚点钩子挂在卡片 li 上（与 data-chk-accept / reject 的 file|idx 口径一致）
  assert.match(html, /<li class="bld-chk-issue" data-chk-idx="1">/, '锚点钩子位于卡片元素');
  assert.ok(html.includes('data-chk-accept="CHANGELOG.md|0"') && html.includes('data-chk-reject="CHANGELOG.md|2"'), '既有接受 / 拒绝钩子不变');
});

/* ---------- L4 行为：接受 / 拒绝置锚点 ---------- */

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function behaviorCtx({ plan, fetchImpl }) {
  const calls = { toast: [], renders: 0, saves: [], gets: [] };
  const v = { id: 'BLD-20260925-001' };
  const pf = {
    verId: v.id, phase: 'ready', busy: false, proofBusy: false, seq: 0,
    plan, edit: null, chkFile: null, chkDecisions: null, chkBusy: null, chkAnchor: null, chkScrollReset: false,
  };
  const ctx = {
    state: { pf, project: 'proj-x', step: 'docs' },
    selVersion: () => v,
    pfOf: (x) => (x === v ? pf : null),
    toast: (m, e) => calls.toast.push([m, e]),
    render: () => { calls.renders += 1; },
    ensurePublishPlan: async () => {},
    fetch: async (url, opts) => fetchImpl(url, opts, calls),
    copyText: async () => true,
    esc: ESC,
    ...FLOW_STUB,
  };
  return { ctx, calls, pf };
}

function chkFns(source) {
  return [
    extractFn(source, 'splitProofreadIssues'),
    extractFn(source, 'parseIssueLineNo'),
    extractFn(source, 'parseChkSuggestion'),
    extractFn(source, 'applyChkSuggestion'),
    extractFn(source, 'alreadyAppliedChk'),
    extractFn(source, 'persistChkDecision'),
    extractFn(source, 'chkPendingCount'),
    extractFn(source, 'acceptChkSuggestion'),
    extractFn(source, 'rejectChkSuggestion'),
    extractFn(source, 'normalizeFlowEval'),
  ].join('\n');
}

const DISK_DOC = '# 说明\n部署到生产坏境\n这是测式文本\n';

// 锚点对象在 vm realm 内创建（跨 realm 原型不同，deepEqual 不可用），逐字段断言
function assertAnchor(anchor, runId, file, idx, msg) {
  assert.ok(anchor, `${msg}（锚点缺失）`);
  assert.equal(anchor.runId, runId, `${msg}（runId）`);
  assert.equal(anchor.file, file, `${msg}（file）`);
  assert.equal(anchor.idx, idx, `${msg}（idx）`);
}

function okJson(data) {
  return { ok: true, status: 200, json: async () => data };
}

function errJson(status, error) {
  return { ok: false, status, json: async () => ({ error }) };
}

t('L4-5 接受 / 拒绝置锚点：pf.chkAnchor = { runId, file, idx }（决断渲染前就位并跨 busy 中间渲染保留）；保存失败同样置锚点（保留在当前条目可重试）；重复决断幂等不置锚点', async () => {
  const source = SOURCE();
  const fns = chkFns(source);
  const doneRun = {
    runId: 'chk-9', phase: 'done',
    files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail' },
    issues: { 'CHANGELOG.md': '第 2 行：原文「坏境」→ 建议「环境」\n第 3 行：原文「测式」→ 建议「测试」' },
    counts: { pass: 1, fail: 1, pending: 0, total: 2 },
  };
  // ① 接受第 1 条（idx 1，模拟滚动到中间 / 靠后条目）：锚点就位
  {
    const { ctx, calls, pf } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: (url, opts, c) => {
        if (url.includes('/api/build/docs/save')) { c.saves.push(JSON.parse(opts.body)); return okJson({ docsFlow: panePlan().docsFlow }); }
        return okJson({ content: DISK_DOC });
      },
    });
    await vmRun(fns, ctx, 'acceptChkSuggestion("CHANGELOG.md", 1)');
    await flush();
    assert.equal(calls.saves.length, 1, '保存一次');
    assert.equal(pf.chkDecisions['chk-9|CHANGELOG.md|1'], 'accepted', '记已接受');
    // 跨 vm realm 对象不比原型，逐字段断言（锚点 = { runId, file, idx }）
    assertAnchor(pf.chkAnchor, 'chk-9', 'CHANGELOG.md', 1, '锚点指向刚接受条目');
    assert.equal(pf.chkBusy, null, 'busy 清空（决断渲染可消费锚点）');
  }
  // ② 拒绝：同步置锚点
  {
    const { ctx, pf } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: () => { throw new Error('不应发请求'); },
    });
    vmRun(fns, ctx, 'rejectChkSuggestion("CHANGELOG.md", 1)');
    assert.equal(pf.chkDecisions['chk-9|CHANGELOG.md|1'], 'rejected', '记已拒绝');
    assertAnchor(pf.chkAnchor, 'chk-9', 'CHANGELOG.md', 1, '拒绝同样锚定当前条目');
  }
  // ③ 保存失败：决断未记，但锚点仍指向该条（视图保留在当前条目可重试）
  {
    const { ctx, pf } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: (url) => (url.includes('/api/build/docs/save') ? errJson(500, '磁盘只读') : okJson({ content: DISK_DOC })),
    });
    await vmRun(fns, ctx, 'acceptChkSuggestion("CHANGELOG.md", 0)');
    await flush();
    assert.equal(pf.chkDecisions['chk-9|CHANGELOG.md|0'], undefined, '失败不误标');
    assertAnchor(pf.chkAnchor, 'chk-9', 'CHANGELOG.md', 0, '失败仍锚定当前条目');
  }
  // ④ 已决断幂等重入：不再置新锚点（不干扰既有位置）
  {
    const { ctx, pf } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: () => { throw new Error('不应发请求'); },
    });
    pf.chkDecisions = { 'chk-9|CHANGELOG.md|0': 'accepted' };
    vmRun(fns, ctx, 'rejectChkSuggestion("CHANGELOG.md", 0)');
    assert.equal(pf.chkAnchor, null, '幂等重入不置锚点');
  }
});

t('L4-6 render() 接线：captureChkScroll 在重建前调用、applyChkScrollAfterRender 在 bindCommon 后调用（渲染主路径接线存在）', () => {
  const source = SOURCE();
  assert.ok(source.includes('captureChkScroll(view)'), 'render 重建前记忆滚动位置');
  assert.ok(source.includes('applyChkScrollAfterRender(view,'), 'render 重建后恢复 / 锚定');
  // defaultPf 声明 chkAnchor / chkScrollReset 会话态（初始 null / false）
  assert.match(source, /chkAnchor:\s*null,\s*chkScrollReset:\s*false/, 'pf 会话态字段声明');
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
