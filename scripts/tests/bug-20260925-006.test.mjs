#!/usr/bin/env node
// BUG-20260925-006 文档编写的审查界面要删除编辑功能 —— 分层回归测试。
// L2 renderReviewModal 静态契约：审查对话框只读核对 + 通过审核（无 编辑/预览 切换、无保存、
//    无 textarea；栏内容恒为预览态：读取中 / 空文档占位 / Markdown 富文本；类型页签、
//    状态徽标、页脚计数、同步滚动说明保留；已审核按钮禁用提示不再宣传「编辑保存」）；
// L4 行为：openReview 恒 README 页签全栏预览（无 modes / pendingFocus）；approveReviewFile
//    直接以磁盘为审核基准（无「先保存草稿再审核」过渡）；editFromProofread 随完结对核
//    对话框去除（BUG-20260926-002）——校对「✎ 修改」改由建议栏 data-chk-edit 直跳二次编辑；
//    closeReview 不再回同步草稿；
//    编辑专属死代码路径（syncReviewDrafts / saveReviewFile / focusReviewIssue）全量移除；
// L5 文案：审查按钮 title 去掉「编辑 / 保存」表述；i18n 中英同步。
// 用法：node scripts/tests/bug-20260925-006.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const SOURCE = () => fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

function extractFn(source, name) {
  // async 函数允许 async 前缀（本单行为接缝含 async：approveReviewFile）
  const m = source.match(new RegExp(`  (?:async )?function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

function vmRun(fns, context, expr) {
  // 单函数沙箱补齐成功发布守卫依赖；本组夹具均为未发布版本。
  const ctx = vm.createContext({ blockPublished: v => !!v?.release?.published, ...context });
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
    Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS,
    Array.isArray(customDocs) ? customDocs : [],
  ),
};

const ESC = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L2 renderReviewModal 只读核对契约 ---------- */

function modalFns(source) {
  return [extractFn(source, 'sanitizeHtml'), extractFn(source, 'renderMd'), extractFn(source, 'renderReviewModal')].join('\n');
}

const FILES = flow.publishDocFiles(['cn', 'en'], []).map((f, i) => ({ ...f, state: i === 0 ? 'reviewed' : 'summarized' }));

function renderModal(review, plan = { langs: ['cn', 'en'], customDocs: [], docsFlow: { files: FILES, reviewedCount: 1 } }) {
  const ctx = {
    pfOf: (v) => v.pf, esc: ESC, short: (h) => String(h || '').slice(0, 8), fmtTime: () => 't',
    ...FLOW_STUB,
  };
  vm.runInContext('var window = globalThis;', vm.createContext(ctx)); // marked 未加载：renderMd 回退 <pre>，不影响类契约断言
  return vmRun(modalFns(SOURCE()), ctx, `renderReviewModal(${JSON.stringify({ id: 'V', pf: { review, plan } })})`);
}

t('L2-1 只读核对：任何栏均无 编辑/预览 切换、无保存按钮、无可输入 textarea；栏头操作仅「通过审核」', () => {
  const html = renderModal({
    open: true, key: 'README',
    contents: { 'README.md': '# 中\n', 'README_en.md': '# EN\n' },
  });
  assert.ok(!html.includes('data-review-mode'), '无 编辑/预览 切换按钮');
  assert.ok(!html.includes('data-review-save'), '无保存按钮');
  assert.ok(!html.includes('bld-review-editor'), '无可输入 textarea');
  assert.ok(!html.includes('>编辑<') && !html.includes('>预览<'), '无编辑 / 预览字样的切换控件');
  assert.ok(!html.includes('aria-label="编辑或预览"'), '无编辑或预览分组');
  // 每栏恰好一个操作按钮：通过审核
  assert.equal((html.match(/data-review-approve=/g) || []).length, 2, '两栏各一个「通过审核」');
});

t('L2-2 栏内容恒为预览态：读取中 / 空文档占位 / Markdown 预览（无编辑态形态）', () => {
  const html = renderModal({
    open: true, key: 'README',
    contents: { 'README.md': '# 中\n', 'README_en.md': '  \n ' },
  });
  assert.match(html, /<div class="bld-review-preview md" data-review-file="README\.md" data-i18n-skip>/, '富文本预览容器（md 排版 + 豁免）');
  assert.match(html, /<div class="bld-review-preview muted small" data-review-file="README_en\.md">（空文档）<\/div>/, '空文档占位');
  const loading = renderModal({ open: true, key: 'README', contents: {} });
  assert.ok((loading.match(/正在读取文档内容…/g) || []).length >= 2, '内容未到达显示读取中');
  // LICENSE 单文件类同构只读
  const lic = renderModal({ open: true, key: 'LICENSE', contents: { 'LICENSE.md': '# MIT\n' } });
  assert.ok(lic.includes('data-review-approve="LICENSE.md"'), 'LICENSE 栏仍可通过审核');
  assert.ok(!lic.includes('data-review-save') && !lic.includes('data-review-mode'), 'LICENSE 栏无编辑 / 保存');
});

t('L2-3 核对能力保留：类型页签（含 LICENSE 不分语言 / 自定义）、状态徽标、页脚计数、同步滚动说明、已审核禁用提示', () => {
  const html = renderModal({
    open: true, key: 'README',
    contents: { 'README.md': '# 中\n', 'README_en.md': '# EN\n' },
  });
  for (const k of ['README', 'CHANGELOG', 'FEATURES', 'AGENTS', 'LICENSE']) {
    assert.ok(html.includes(`data-review-tab="${k}"`), `类型页签 ${k}`);
  }
  assert.match(html, /README（1\/2）/, '页签 n/N 计数');
  assert.ok(html.includes('已总结待审核') && html.includes('已审核'), '状态徽标文案');
  assert.match(html, /全部 1\/9 已审核 · 本页签 1\/2/, '页脚全部 / 本页签计数');
  assert.ok(html.includes('同步滚动'), '同步滚动说明保留');
  // 已审核栏：按钮禁用 + 提示不再宣传「编辑保存」（内容再变化自动回退的检测口径）
  assert.match(html, /data-review-approve="README\.md"[^>]*disabled title="已审核：内容再变化会自动回退待审核"/, '已审核禁用提示改为内容变化口径');
  assert.ok(!html.includes('已审核：编辑保存后才会回退待审核'), '旧「编辑保存」提示文案移除');
});

t('L2-4 同步滚动绑定只覆盖预览容器（编辑态 textarea 已随编辑入口移除），比例跟随口径不变', () => {
  const fn = extractFn(SOURCE(), 'bindReviewSyncScroll');
  assert.ok(fn.includes('bld-review-preview'), '预览容器纳入绑定');
  assert.ok(!fn.includes('textarea'), '编辑态 textarea 不再在绑定选择器内（形态已移除）');
  assert.ok(fn.includes('scrollHeight'), '按滚动高度比例跟随保留');
  assert.match(SOURCE(), /bindReviewSyncScroll\(reviewWrap\)/, '对话框渲染后仍调用同步滚动绑定');
});

/* ---------- L4 行为 ---------- */

t('L4-1 openReview：恒 README 页签、全栏只读（无 modes / pendingFocus）；未就绪 toast 不开', async () => {
  const source = SOURCE();
  const fn = extractFn(source, 'openReview');
  const v = { id: 'V', pf: null };
  const calls = { toast: [], render: 0, load: [] };
  const ctx = {
    state: { pf: null }, selVersion: () => v, pfOf: (x) => (x === v ? v.pf : null),
    docFilesOf: FLOW_STUB.docFilesOf, DEFAULT_DOC_LANGS: FLOW_STUB.DEFAULT_DOC_LANGS,
    esc: ESC, toast: (m, e) => calls.toast.push([m, e]), render: () => { calls.render += 1; },
    loadReviewPair: (key) => { calls.load.push(key); return Promise.resolve(); },
    ...FLOW_STUB,
  };
  v.pf = { verId: 'V', phase: 'ready', plan: { langs: ['cn', 'en'] }, review: null };
  ctx.state.pf = v.pf;
  await vmRun(fn, ctx, 'openReview()');
  assert.equal(v.pf.review.open, true, '打开对话框');
  assert.equal(v.pf.review.key, 'README', '默认 README 页签');
  assert.ok(!('modes' in v.pf.review), 'review 状态无 modes（编辑态形态移除）');
  assert.ok(!('pendingFocus' in v.pf.review), 'review 状态无 pendingFocus（审查侧行定位移除）');
  assert.equal(Object.keys(v.pf.review.contents).length, 0, 'contents 初始为空（加载后填充预览）');
  assert.deepEqual(calls.load, ['README'], '加载 README 页签');
  // 传参调用（历史跳转形态）不再被消费：仍是 README 只读
  await vmRun(fn, ctx, 'openReview({ file: "CHANGELOG.md", line: 12 })');
  assert.equal(v.pf.review.key, 'README', '跳转参数不再切页签（落点已迁至二次编辑弹窗）');
  // 未就绪：toast 且不开
  v.pf.phase = 'loading';
  v.pf.review = null;
  await vmRun(fn, ctx, 'openReview()');
  assert.equal(v.pf.review, null, '未就绪不打开');
  assert.equal(calls.toast.length, 1, '未就绪 toast 提示');
});

t('L4-2 approveReviewFile：直接以磁盘内容为审核基准（无「先保存草稿再审核」的读盘比对与保存过渡），成功反馈计数', async () => {
  const source = SOURCE();
  const fn = extractFn(source, 'approveReviewFile');
  const v = { id: 'V' };
  const fetches = [];
  const toasts = [];
  let renders = 0;
  const files = flow.publishDocFiles(['cn', 'en'], []).map((f) => ({ ...f, state: 'summarized' }));
  const pf = {
    phase: 'ready', seq: 0, review: { open: true, key: 'README', contents: { 'README.md': '# 改后草稿' }, busy: false },
    plan: { langs: ['cn', 'en'], docsFlow: { files, reviewedCount: 0 } },
  };
  const ctx = {
    state: { pf, project: 'proj-x' }, selVersion: () => v, pfOf: (x) => (x === v ? pf : null),
    fetch: async (url, init) => {
      fetches.push([url, init?.method || 'GET']);
      return { ok: true, status: 200, json: async () => ({ docsFlow: { files, reviewedCount: 1 } }) };
    },
    render: () => { renders += 1; }, toast: (m, e) => toasts.push([m, e]),
    docFilesOf: FLOW_STUB.docFilesOf, DEFAULT_DOC_LANGS: FLOW_STUB.DEFAULT_DOC_LANGS, esc: ESC,
    ...FLOW_STUB,
  };
  await vmRun(fn, ctx, 'approveReviewFile("README.md")');
  assert.deepEqual(fetches, [['/api/build/docs/review?project=proj-x', 'POST']], '只发一次审核 POST（无读盘比对、无草稿保存）');
  assert.match(toasts[0][0], /README\.md 已通过审核（1\/9）/, '成功反馈含计数');
  assert.equal(pf.review.busy, false, 'busy 复位');
  assert.equal(pf.plan.docsFlow.reviewedCount, 1, 'docsFlow 已更新');
  assert.ok(renders >= 1, '渲染刷新');
  // 对话框未开：不动作
  fetches.length = 0;
  pf.review = null;
  await vmRun(fn, ctx, 'approveReviewFile("README.md")');
  assert.deepEqual(fetches, [], '对话框未开不动作');
});

t('L4-3 editFromProofread 随完结对核对话框移除（BUG-20260926-002）：函数 / 钩子不再存在，校对「✎ 修改」由建议栏 data-chk-edit 直跳「② 二次编辑」', () => {
  const source = SOURCE();
  assert.ok(!/function editFromProofread\(/.test(source), 'editFromProofread 函数随完结对话框移除');
  assert.ok(!source.includes('data-proof-edit'), '完结对话框专用 data-proof-edit 钩子移除');
  assert.ok(source.includes("data-chk-edit="), '建议栏「✎ 修改」保留 data-chk-edit 钩子');
  assert.match(source, /openSecondaryEdit\(\{ file: el\.dataset\.chkEdit, line: el\.dataset\.chkLine \}\)/, '「✎ 修改」直接跳二次编辑定位（无中转函数）');
});

t('L4-4 closeReview：关闭为轻量本地操作（摘元素 + 静默同步），不再回同步编辑草稿', () => {
  const source = SOURCE();
  const fn = extractFn(source, 'closeReview');
  const calls = { removed: 0, silent: 0 };
  const pf = { phase: 'ready', plan: { langs: ['cn', 'en'] }, review: { open: true, key: 'README', contents: {}, busy: false } };
  const ctx = {
    state: { pf },
    syncReviewDrafts: () => { throw new Error('审查对话框已只读，不应再有草稿回同步'); },
    $: (sel) => (sel === '#bldReviewWrap' ? { remove() { calls.removed += 1; } } : null),
    syncDocsPlanSilently: () => { calls.silent += 1; },
    ensurePublishPlan: () => { throw new Error('不应触发整块刷新'); },
    render: () => { throw new Error('不应整块重渲染'); },
  };
  vmRun(fn, ctx, 'closeReview()');
  assert.equal(pf.review, null, '审查对话框状态关闭');
  assert.equal(calls.removed, 1, '只摘对话框元素');
  assert.equal(calls.silent, 1, '关闭后转后台静默同步');
});

t('L4-5 编辑专属死代码路径全量移除：syncReviewDrafts / saveReviewFile / focusReviewFile 无定义、无调用、无导出；render / 切页签 / 刷新 / 语言集应用不再引用', () => {
  const source = SOURCE();
  for (const name of ['syncReviewDrafts', 'saveReviewFile', 'focusReviewIssue']) {
    assert.ok(!source.includes(name), `${name} 应随 BUG-20260925-006 审查去编辑化全量移除（含定义 / 调用 / 导出）`);
  }
  assert.ok(!source.includes('data-review-mode'), '无 编辑/预览 切换控件绑定');
  assert.ok(!source.includes('data-review-save'), '无保存控件绑定');
  assert.ok(!source.includes('modes:'), 'review 状态不再携带 modes');
  // 行定位职责由②二次编辑弹窗承接（focusEditIssue + pendingFocus 定位链保留）
  assert.match(source, /function focusEditIssue\(/, '二次编辑弹窗行定位保留');
  assert.match(source, /pendingFocus/, '定位链数据保留');
  // 导出接缝不再暴露已移除路径
  assert.ok(!/ATBBuild[\s\S]*?saveReviewFile/.test(source), '接缝不再导出 saveReviewFile');
});

/* ---------- L5 文案与 i18n ---------- */

t('L5-1 审查按钮 title 去掉「编辑 / 保存」表述；i18n 中英同步（新键齐备、旧键不再被源引用）', () => {
  const source = SOURCE();
  assert.ok(!source.includes('逐文件编辑 / 保存 / 通过审核'), '审查按钮 title 不再含编辑 / 保存表述');
  assert.match(source, /data-pf-review[^>]*title="打开审查对话框：[^"]*逐文件通过审核[^"]*"/, 'title 收敛为逐文件通过审核');
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  const newTitle = '打开审查对话框：按文档类型页签（四类 + LICENSE + 自定义）、全语言栏同步滚动对比，逐文件通过审核（只读核对，编辑走「② 二次编辑」）';
  assert.ok(typeof EN[newTitle] === 'string' && EN[newTitle], '新审查按钮 title 词条中英齐备');
  const newDisabled = '已审核：内容再变化会自动回退待审核';
  assert.ok(typeof EN[newDisabled] === 'string' && EN[newDisabled], '已审核禁用提示新词条中英齐备');
  // 往返不变形
  I.setLang('en');
  assert.equal(I.t(newDisabled), EN[newDisabled], '英文翻译可取');
  I.setLang('zh');
  assert.equal(I.t(newDisabled), newDisabled, '中文还原');
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
