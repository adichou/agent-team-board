#!/usr/bin/env node
// REQ-20260924-004（BUG-20260926-002：完结对核对话框移除，原对话框 ③ 项渲染契约转为移除断言，
// 校对明细呈现由右侧建议栏与决断卡片承载）
// REQ-20260924-004 整体审核界面的 AI 校对逐项增加修改按钮 —— 分层测试。
// L1 纯逻辑（publish-flow：AI 校对提示词回执格式约束——口径 a 每条一行、行号开头）；
// L4 前端静态契约（build.js：splitProofreadIssues / parseIssueLineNo 纯函数；
//    renderFinalizeModal ③ 项逐条渲染 + 「✎ 修改」按钮；BUG-20260925-006 起「✎ 修改」
//    经 editFromProofread 改跳「② 二次编辑」弹窗定位（原 openReview 参数化 + 审查侧
//    focusReviewIssue 编辑态路径随审查去编辑化移除）；弹层让位口径保持）；
// L6 i18n（新增动态键 ◇ · 第 ◇ 行；✎ 修改 词条复用；往返不变形）。
// 用法：node scripts/tests/req-20260924-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function extractFn(source, name) {
  // 参数列表放宽至 [^)]*（本单 editFromProofread(file, line) 双参；其余既有单测为单参口径）
  const m = source.match(new RegExp(`  function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n  \\}`));
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

const L4_CTX = {
  pfOf: (v) => v.pf,
  esc: (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

const SOURCE = () => fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

/* ---------- L1 纯逻辑（publish-flow 提示词） ---------- */

t('L1-1 AI 校对提示词回执格式约束：--issues 每条独立一行、行号开头（口径 a）；清单 / 只读 / 不编造约束保持', () => {
  const p = flow.buildDocProofreadPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260924-004', runId: 'chk-20260924-120000-ab01',
    langs: ['cn', 'en'], customDocs: ['MIGRATION'], atbPath: '/tmp/atb.mjs',
  });
  // 口径 a：格式约束进提示词（每条一行 + 行号开头；无行号条目也独立成行）
  assert.ok(p.includes('独立一行') || p.includes('独立成行'), '提示词应约束每条问题独立成行');
  assert.ok(p.includes('行号开头'), '提示词应约束行号开头');
  assert.ok(/第\s*\d+\s*行/.test(p) || p.includes('第 N 行'), '提示词给出回执行号开头示例');
  // 既有约束不回退
  assert.ok(p.includes('chk-20260924-120000-ab01'), '运行参数区保持');
  for (const f of ['README.md', 'MIGRATION.md']) assert.ok(p.includes(f), `校对清单含 ${f}`);
  assert.ok(p.includes('--issues') && p.includes('docscheck file'), '回执命令保持');
  assert.ok(p.includes('不修改') || p.includes('只读'), '只读不改约束保持');
  assert.ok(p.includes('不编造'), '不编造约束保持');
});

/* ---------- L4 纯函数：拆分与行号解析 ---------- */

t('L4-1 splitProofreadIssues：多行拆逐条（trim + 去空行、保序）；无换行整段作单条不丢内容；空文本空数组', () => {
  const fns = [extractFn(SOURCE(), 'splitProofreadIssues')].join('\n');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const run = (expr) => vm.runInContext(expr, ctx);
  const j = (expr) => JSON.stringify(run(expr)); // vm 跨 realm 数组：序列化比对
  // 多行：逐条 + 去空行 + trim + 保序，内容逐字保留
  const multi = '第 12 行：「部署到生产坏境」→ 建议「部署到生产环境」\n\n  第 37 行：「的的生成」→ 建议「的生成」  \r\n第 40 行：长句建议拆分';
  assert.equal(j(`splitProofreadIssues(${JSON.stringify(multi)})`), JSON.stringify([
    '第 12 行：「部署到生产坏境」→ 建议「部署到生产环境」',
    '第 37 行：「的的生成」→ 建议「的生成」',
    '第 40 行：长句建议拆分',
  ]), '多行按行拆分、去空行、trim、保序');
  // 无换行整段：单条整段（不丢内容）
  const single = '第 3 行：错别字「测式」应为「测试」；第 7 行：长句建议拆分';
  assert.equal(j(`splitProofreadIssues(${JSON.stringify(single)})`), JSON.stringify([single]), '整段无换行作单条');
  // 空文本：空数组
  assert.equal(j('splitProofreadIssues("")'), '[]', '空文本空数组');
  assert.equal(j('splitProofreadIssues(null)'), '[]', 'null 安全');
});

t('L4-2 parseIssueLineNo：第 N 行优先；行首 N. / N、 / N: / L N: 次之；无行号返回 null', () => {
  const fns = [extractFn(SOURCE(), 'parseIssueLineNo')].join('\n');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const p = (s) => vm.runInContext(`parseIssueLineNo(${JSON.stringify(s)})`, ctx);
  assert.equal(p('第 12 行：「坏境」→ 建议「环境」'), 12, '第 N 行');
  assert.equal(p('第3行：测式'), 3, '第 N 行无空格');
  assert.equal(p('第 105 行 标点残缺'), 105, '第 N 行（无冒号）');
  assert.equal(p('1. 第 3 行：序号行内也带第 N 行——以第 N 行为准'), 3, '第 N 行优先于行首序号');
  assert.equal(p('7、句尾缺标点'), 7, '行首 N、');
  assert.equal(p('12: colon 开头'), 12, '行首 N:');
  assert.equal(p('L9: L 前缀'), 9, '行首 L N:');
  assert.equal(p('（无行号）：全文语感建议'), null, '无行号条目 null');
  assert.equal(p('长句建议拆分'), null, '无任何数字 null');
  assert.equal(p(''), null, '空串 null');
});

/* ---------- L4 renderFinalizeModal ③ 项逐条渲染 + 修改按钮 ---------- */

function docsCheckRun(issues, files) {
  return {
    runId: 'chk-20260924-120000-ab01', phase: 'done',
    files: files || { 'README.md': 'pass', 'CHANGELOG.md': 'fail', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass', 'MIGRATION.md': 'fail' },
    issues,
    counts: { pass: 3, fail: 2, pending: 0, total: 5 },
  };
}

function finalizePf(docsCheck, extraChecks = null) {
  return {
    finalize: { open: true, busy: false },
    plan: {
      langs: ['cn', 'en'], customDocs: ['MIGRATION'],
      docsFlow: { files: [], defaultReviewedCount: 5, restReviewedCount: 4, canFinalize: true, finalized: null },
      docsCheck,
    },
    ...(extraChecks ? { checks: extraChecks } : {}),
  };
}

t('L4-3 renderFinalizeModal 随完结对核对话框移除（BUG-20260926-002）；校对明细由建议栏逐条卡片承载', () => {
  const source = SOURCE();
  assert.ok(!/function renderFinalizeModal\(/.test(source), 'renderFinalizeModal 函数已删除');
  for (const gone of ['bld-finalize', 'data-proof-edit', 'data-pf-checks', '确认完结']) {
    assert.ok(!source.includes(gone), `完结对话框残留清理：${gone}`);
  }
  // 逐条拆分纯函数保留：校对建议栏卡片继续按行拆分逐条渲染
  const issues = { 'CHANGELOG.md': '第 12 行：「部署到生产坏境」→ 建议「部署到生产环境」\n第 37 行：「的的生成」→ 建议「的生成」' };
  const fns = [extractFn(source, 'splitProofreadIssues'), extractFn(source, 'parseIssueLineNo')].join('\n');
  const rows = vmRun(fns, {}, `splitProofreadIssues(${JSON.stringify(issues['CHANGELOG.md'])})`);
  assert.equal(rows.length, 2, '两条问题各占一行');
  assert.ok(rows.every((r) => r.includes('建议')), '回执原文逐字保留（不丢、不截断）');
});

t('L4-4 完结对核对话框移除后校对态呈现迁移：running / failed / done 态由右侧建议栏与全局面板承载', () => {
  const source = SOURCE();
  assert.ok(source.includes('校对进行中'), 'running 进度提示（建议栏）保留');
  assert.ok(source.includes('AI 校对中断'), 'failed 中断态（建议栏）保留');
  assert.ok(source.includes('data-chk-retry'), '重试 AI 校对入口保留');
  assert.ok(source.includes('data-pf-proofstep'), '五步 ③ 入口保留');
  assert.ok(!source.includes('data-pf-proofread'), '对话框内 AI 校对按钮随宿主移除（五步 ③ 为唯一入口）');
});

t('L4-8 完结对核对话框移除（BUG-20260926-002）后 ①② 检查项与完结动作不残留（003 契约收口）', () => {
  const source = SOURCE();
  for (const gone of ['各语言内容语义一致（以已审核默认语言为基准）', '所有文档内链接真实可达', '默认语言错别字与行文规范（AI 校对自动上报）']) {
    assert.ok(!source.includes(gone), `检查项随对话框移除：${gone.slice(0, 10)}…`);
  }
  assert.ok(!source.includes('data-pf-finalize-cancel') && !source.includes('data-pf-finalize-confirm'), '取消 / 确认完结按钮随对话框移除');
});

/* ---------- L4 行为：editFromProofread 改跳二次编辑（BUG-20260925-006） ---------- */

function behaviorCtx() {
  const calls = { toast: [], render: 0, load: [], secondary: [] };
  const v = { id: 'BLD-20260924-004', pf: null };
  const ctx = {
    state: { pf: null },
    selVersion: () => v,
    pfOf: (x) => (x === v ? v.pf : null),
    docFilesOf: FLOW_STUB.docFilesOf,
    DEFAULT_DOC_LANGS: FLOW_STUB.DEFAULT_DOC_LANGS,
    esc: L4_CTX.esc,
    toast: (m, e) => calls.toast.push([m, e]),
    render: () => { calls.render += 1; },
    loadReviewPair: (key) => {
      calls.load.push(key);
      return Promise.resolve();
    },
    openSecondaryEdit: (target) => { calls.secondary.push(target); },
    $: () => null,
    getComputedStyle: () => ({ lineHeight: '20px' }),
    setTimeout: (fn) => { fn(); },
    ...FLOW_STUB,
  };
  v.pf = {
    verId: v.id, phase: 'ready', plan: { langs: ['cn', 'en'], customDocs: ['MIGRATION'] },
    review: null, finalize: null,
  };
  ctx.state.pf = v.pf;
  return { ctx, calls, v };
}

function behaviorFns(source) {
  return [
    extractFn(source, 'openReview'),
    // editFromProofread 随 BUG-20260926-002 完结对核对话框删除（L4-6 改为移除断言）
  ].join('\n');
}

t('L4-5 openReview：BUG-20260925-006 起恒 README 页签全栏只读（无参数化跳转、无 modes / pendingFocus）；未就绪 toast 不开', async () => {
  const { ctx, calls, v } = behaviorCtx();
  await vmRun(behaviorFns(SOURCE()), ctx, 'openReview()');
  assert.equal(v.pf.review.key, 'README', '默认 README 页签');
  assert.ok(!('modes' in v.pf.review), '无 modes（审查侧编辑态形态已移除）');
  assert.ok(!('pendingFocus' in v.pf.review), '无 pendingFocus（行定位迁至②二次编辑）');
  assert.equal(Object.keys(v.pf.review.contents).length, 0, 'contents 初始为空');
  assert.deepEqual(calls.load, ['README'], '加载 README 页签');
  // 历史跳转参数不再被消费（落点已迁至②二次编辑弹窗）
  await vmRun(behaviorFns(SOURCE()), ctx, 'openReview({ file: "CHANGELOG.md", line: 12 })');
  assert.equal(v.pf.review.key, 'README', '跳转参数不再切页签');
  // 未就绪：toast 且不开
  v.pf.phase = 'loading';
  v.pf.review = null;
  await vmRun(behaviorFns(SOURCE()), ctx, 'openReview()');
  assert.equal(v.pf.review, null, '未就绪不打开');
  assert.equal(calls.toast.length, 1, '未就绪 toast 提示');
});

t('L4-6 editFromProofread 随完结对核对话框移除（BUG-20260926-002）：函数与落点断言更新', () => {
  const source = SOURCE();
  assert.ok(!/function editFromProofread\(/.test(source), 'editFromProofread 函数随宿主对话框删除');
});

t('L4-7 审查侧行定位随编辑入口移除：focusReviewIssue 无定义、无导出；「✎ 修改」行定位职责由②二次编辑 focusEditIssue 承接（editFromProofread 随 BUG-20260926-002 删除，data-chk-edit 直跳）', () => {
  const source = SOURCE();
  assert.ok(!source.includes('focusReviewIssue'), 'focusReviewIssue 已随 BUG-20260925-006 审查去编辑化移除');
  assert.match(source, /function focusEditIssue\(/, '②二次编辑 focusEditIssue 保留（承接行定位）');
  assert.match(source, /pendingFocus/, '定位链数据保留（openSecondaryEdit { file, line } → focusEditIssue）');
  assert.match(source, /data-chk-edit/, '校对建议栏「✎ 修改」保留（openSecondaryEdit { file, line } 直跳）');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增动态键「◇ · 第 ◇ 行」齐备；「✎ 修改」词条复用；title 摘要英文翻译往返还原', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  assert.ok('◇ · 第 ◇ 行' in EN_DYNAMIC, '动态键 ◇ · 第 ◇ 行 缺失');
  assert.equal(EN_DYNAMIC['◇ · 第 ◇ 行'], '$1 · line $2');
  assert.equal(EN['✎ 修改'], '✎ Edit', '按钮文案复用既有词条');
  I.setLang('en');
  assert.equal(I.t('CHANGELOG.md · 第 12 行'), 'CHANGELOG.md · line 12', 'title 摘要英文翻译');
  assert.equal(I.t('✎ 修改'), '✎ Edit', '按钮文案英文');
  I.setLang('zh');
  assert.equal(I.t('CHANGELOG.md · 第 12 行'), 'CHANGELOG.md · 第 12 行', '中文还原');
  assert.equal(I.t('✎ 修改'), '✎ 修改');
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
