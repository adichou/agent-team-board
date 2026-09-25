#!/usr/bin/env node
// BUG-20260925-005 二次编辑界面的编辑和预览功能要和审查界面保持一致 —— 分层测试。
// L1 源码契约（build.js：#bldEditWrap 预览接入 ATBMdRich.enhance，与审查对话框同口径）；
// L2 行为（focusEditIssue：选区 + 聚焦 + 滚动 + 落点闪烁 2 秒移除；无行号 / 空内容兜底不闪烁）；
// L3 样式（style.css：编辑框等宽同口径 / 预览排版去 .md 外框同口径 / 闪烁选择器覆盖弹窗编辑框）；
// L4 渲染回归（renderSecondaryEditModal 预览容器类名命中增强选择器；职责边界不回退）；
// L5 i18n（弹窗增强路径复用 md-rich 既有词条，中英齐备不新增文案）。
// 用法：node scripts/tests/bug-20260925-005.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const webUrl = new URL('../web/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, webUrl), 'utf8');
const BUILD = read('build.js');
const CSS = read('style.css');
const SOURCE = () => read('build.js');

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

const L4_CTX = {
  pfOf: (v) => v.pf,
  esc: ESC,
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

/* ---------- L1 源码契约：二次编辑预览接入富媒体增强 ---------- */

t('L1-1 #bldEditWrap 预览容器纳入 ATBMdRich.enhance：选择器与审查对话框同口径（.bld-review-preview.md），可选链调用静默降级', () => {
  assert.match(BUILD, /const editWrap = q\('#bldEditWrap'\);/, '弹窗元素绑定段存在');
  // 二次编辑弹窗的增强调用：editWrap 容器内 .bld-review-preview.md 逐个 enhance
  assert.match(BUILD, /editWrap\.querySelectorAll\('\.bld-review-preview\.md'\)/, '弹窗预览容器纳入增强选择器');
  const editEnhance = BUILD.match(/if \(editWrap\) \{\s*\n\s*for \(const el of editWrap\.querySelectorAll\('\.bld-review-preview\.md'\)\) \{\s*\n\s*window\.ATBMdRich\?\.enhance\(el, \{ imgBase: state\.project \? \(raw\) => `\/api\/fs\/raw\?path=\$\{encodeURIComponent\(raw\)\}&project=\$\{encodeURIComponent\(state\.project\)\}` : null \}\);\s*\n\s*\}\s*\n\s*\}/);
  assert.ok(editEnhance, '增强调用为 if (editWrap) 守卫 + 可选链 + 白名单端点 imgBase（与审查对话框逐字同口径）');
  // 审查对话框既有增强不回退
  assert.match(BUILD, /reviewWrap\.querySelectorAll\('\.bld-review-preview\.md'\)/, '审查对话框增强保留');
  const endpointCount = (BUILD.match(/\/api\/fs\/raw\?path=\$\{encodeURIComponent\(raw\)\}&project=\$\{encodeURIComponent\(state\.project\)\}/g) || []).length;
  assert.ok(endpointCount >= 2, `白名单端点锚点至少两处（审查 + 二次编辑），实际 ${endpointCount}`);
});

t('L1-2 bindCommon 内弹窗增强位于既有编辑弹窗绑定段（遮罩点击绑定之后）：render 重建后随 bindCommon 重跑', () => {
  const editWrapIdx = BUILD.indexOf("const editWrap = q('#bldEditWrap')");
  const enhanceIdx = BUILD.indexOf("editWrap.querySelectorAll('.bld-review-preview.md')");
  assert.ok(editWrapIdx > 0 && enhanceIdx > editWrapIdx, '增强调用在弹窗元素获取之后（同一绑定段内）');
});

/* ---------- L2 行为：focusEditIssue 落点闪烁对齐 focusReviewIssue ---------- */

function fakeBox(value) {
  const box = {
    value,
    focusCalls: 0, scrollTop: 0, clientHeight: 40,
    selection: null, added: [], removed: [],
    focus() { box.focusCalls += 1; },
    setSelectionRange(a, b) { box.selection = [a, b]; },
    classList: {
      add(...cls) { box.added.push(...cls); },
      remove(...cls) { box.removed.push(...cls); },
    },
  };
  return box;
}

function focusCtx(box) {
  const timers = [];
  return {
    timers,
    ctx: {
      state: { pf: { edit: { open: true, pendingFocus: { line: 3 } } } },
      $: (sel) => (sel === '.bld-edit-editor' ? box : null),
      getComputedStyle: () => ({ lineHeight: '20px' }),
      setTimeout: (fn, delay) => { timers.push([fn, delay]); return timers.length; },
    },
  };
}

const FOCUS_FNS = () => extractFn(SOURCE(), 'focusEditIssue');

t('L2-1 定位行：选区 + 聚焦 + 滚动 + 描边闪烁（bld-review-focus-flash，2 秒移除）；pendingFocus 一次性消费', () => {
  const box = fakeBox('l1\nl2\nl3-content\nl4');
  const { ctx, timers } = focusCtx(box);
  vmRun(FOCUS_FNS(), ctx, 'focusEditIssue()');
  assert.equal(box.focusCalls, 1, '聚焦编辑框');
  assert.deepEqual(box.selection, [6, 16], '第 3 行选区（首尾偏移）');
  assert.ok(box.scrollTop > 0, '滚动定位到该行附近');
  assert.ok(box.added.includes('bld-review-focus-flash'), '加落点闪烁类（与 focusReviewIssue 同口径）');
  assert.equal(ctx.state.pf.edit.pendingFocus, null, 'pendingFocus 一次性消费');
  assert.equal(timers.length, 1, '挂一个移除定时器');
  assert.equal(timers[0][1], 2000, '2 秒后移除');
  timers[0][0]();
  assert.ok(box.removed.includes('bld-review-focus-flash'), '定时器到期移除闪烁类');
});

t('L2-2 行号超界收敛末行仍闪烁；无行号 / 空内容保持既有兜底（仅编辑态，不选区不闪烁不报错）', () => {
  // 超界：收敛末行并闪烁
  const over = fakeBox('a\nb');
  const c1 = focusCtx(over);
  c1.ctx.state.pf.edit.pendingFocus = { line: 99 };
  vmRun(FOCUS_FNS(), c1.ctx, 'focusEditIssue()');
  assert.deepEqual(over.selection, [2, 3], '收敛末行选区');
  assert.ok(over.added.includes('bld-review-focus-flash'), '超界收敛末行仍闪烁（审查口径）');

  // 无行号：仅聚焦编辑态
  const noLine = fakeBox('a\nb');
  const c2 = focusCtx(noLine);
  c2.ctx.state.pf.edit.pendingFocus = { line: null };
  vmRun(FOCUS_FNS(), c2.ctx, 'focusEditIssue()');
  assert.equal(noLine.focusCalls, 1, '仍聚焦');
  assert.equal(noLine.selection, null, '不选区');
  assert.deepEqual(noLine.added, [], '不闪烁（无落点）');

  // 空内容：同兜底
  const empty = fakeBox('');
  const c3 = focusCtx(empty);
  c3.ctx.state.pf.edit.pendingFocus = { line: 2 };
  vmRun(FOCUS_FNS(), c3.ctx, 'focusEditIssue()');
  assert.equal(empty.selection, null, '空内容不定位');
  assert.deepEqual(empty.added, [], '空内容不闪烁');
});

/* ---------- L3 样式：编辑框 / 预览排版 / 闪烁选择器 ---------- */

t('L3-1 编辑框等宽：.bld-edit-body .bld-edit-editor 与审查编辑框同口径（12.5px/1.65 ui-monospace 系）', () => {
  assert.match(CSS, /\.bld-edit-body \.bld-edit-editor \{\s*width: 100%;\s*font: 12\.5px\/1\.65 ui-monospace, Menlo, Consolas, monospace;\s*\}/, '弹窗编辑框等宽字体（与 .bld-review-col-body textarea 同口径）');
  assert.ok(!/\.bld-edit-body \.bld-edit-editor \{[^}]*font: inherit/.test(CSS), '不再 font: inherit');
  assert.match(CSS, /\.bld-review-col-body textarea \{\s*\n[\s\S]*?font: 12\.5px\/1\.65 ui-monospace, Menlo, Consolas, monospace;/, '审查编辑框口径保留（对齐基准）');
});

t('L3-2 预览排版口径：.bld-edit-body .bld-review-preview 去 .md 外框（无边框/圆角/底色）+ 13px/1.7 + 围栏代码等宽收敛换行', () => {
  assert.match(CSS, /\.bld-edit-body \.bld-review-preview \{[^}]*border: none;[^}]*font-size: 13px;[^}]*line-height: 1\.7;/, '预览容器去外框 + 审查同口径字号行高');
  assert.match(CSS, /\.bld-edit-body \.bld-review-preview pre \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;[^}]*ui-monospace, Menlo, Consolas, monospace;/, '围栏代码等宽收敛换行（与审查 pre 规则同口径）');
});

t('L3-3 落点闪烁选择器覆盖弹窗编辑框：.bld-edit-editor.bld-review-focus-flash 复用既有 keyframes', () => {
  assert.match(CSS, /\.bld-edit-editor\.bld-review-focus-flash[^{]*\{[^}]*animation: bldReviewFocusFlash/, '弹窗编辑框命中闪烁动画');
  assert.match(CSS, /@keyframes bldReviewFocusFlash/, 'keyframes 保留（复用不复制）');
});

/* ---------- L4 渲染回归：预览容器命中增强选择器 + 职责边界不回退 ---------- */

function editModalFns(source) {
  return [
    extractFn(source, 'sanitizeHtml'),
    extractFn(source, 'renderMd'),
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'renderSecondaryEditModal'),
  ].join('\n');
}

t('L4-1 renderSecondaryEditModal 预览态输出 .bld-review-preview.md（data-i18n-skip）：与 L1-1 增强选择器逐字命中；编辑态输出 .bld-edit-editor', () => {
  const source = SOURCE();
  const fns = editModalFns(source);
  const markedStub = { parse: (md) => `<p>${md}</p>` };
  const ctx = { ...L4_CTX, window: { marked: markedStub } };
  const pf = {
    phase: 'ready',
    plan: {
      langs: ['cn', 'en'], customDocs: [],
      docsFlow: { files: flow.publishDocFiles(['cn', 'en'], []).map((f) => ({ ...f, state: 'summarized' })) },
    },
    edit: { open: true, file: 'README.md', mode: 'preview', content: '# Hi\n\n![图](image/a.png)\n\n```mermaid\ngraph TD\nA-->B\n```\n', disk: null, busy: false, loadErr: null, pending: null, savedNote: null },
  };
  const html = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(pf)} })`);
  assert.match(html, /class="bld-review-preview md" data-i18n-skip/, '预览容器类名 + 词典豁免（增强选择器 .bld-review-preview.md 命中）');
  assert.ok(!html.includes('bld-edit-editor'), '预览态无编辑框');
  // 编辑态
  const pfEdit = { ...pf, edit: { ...pf.edit, mode: 'edit', disk: pf.edit.content } };
  const htmlEdit = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(pfEdit)} })`);
  assert.match(htmlEdit, /class="bld-edit-editor"/, '编辑态输出编辑框');
  // 职责边界不回退：无「通过审核」、无其他语种对照列
  assert.ok(!html.includes('data-review-approve'), '弹窗不出现「通过审核」（审核门禁仍在审查流程）');
  assert.ok(!html.includes('README_en.md') && !html.includes('bld-review-cols'), '无其他语种对照列');
});

t('L4-2 空文档 / 读取失败 / 挂起三动作既有形态不回退', () => {
  const source = SOURCE();
  const fns = editModalFns(source);
  const ctx = { ...L4_CTX, window: { marked: { parse: (md) => `<p>${md}</p>` } } };
  const pf = {
    phase: 'ready',
    plan: {
      langs: ['cn'], customDocs: [],
      docsFlow: { files: flow.publishDocFiles(['cn'], []).map((f) => ({ ...f, state: 'summarized' })) },
    },
    edit: { open: true, file: 'README.md', mode: 'preview', content: '   ', disk: '   ', busy: false, loadErr: null, pending: null, savedNote: null },
  };
  const htmlEmpty = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(pf)} })`);
  assert.ok(htmlEmpty.includes('（空文档）'), '空文档占位保留');
  const pfPend = { ...pf, edit: { ...pf.edit, content: '# x!', pending: { kind: 'refresh' } } };
  const htmlPend = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(pfPend)} })`);
  for (const s of ['保存并继续', '放弃修改并继续', '留在本文件']) assert.ok(htmlPend.includes(s), `挂起三动作：${s}`);
});

/* ---------- L5 i18n：增强路径复用 md-rich 既有词条，中英齐备 ---------- */

t('L5-1 弹窗增强路径无新增文案：md-rich 图片占位 / mermaid / plantuml 词条中英齐备（弹窗预览与审查共用，文案口径一致）', () => {
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  assert.ok('图片 ◇ 无法加载（不存在、越出项目根或超过 8MB 上限）' in EN_DYNAMIC, '改写型占位动态词条');
  assert.ok('⚠ Mermaid 图表渲染失败（◇）：已回退为源码展示' in EN_DYNAMIC, 'mermaid 失败动态词条');
  assert.equal(EN['正在渲染 Mermaid 图表…'], 'Rendering Mermaid diagram…', '渲染中词条');
  assert.match(EN['PlantUML 图表暂不支持本地渲染：为保持「本地优先 · 无外部依赖」未接入在线渲染服务，以下为源码'], /^PlantUML diagrams cannot be rendered locally/, 'plantuml 降级词条');
  // 本单不新增界面文案：二次编辑段不引入新的硬编码中文提示（增强提示全部来自 md-rich 插入时自译）
  const modal = BUILD.slice(BUILD.indexOf('function renderSecondaryEditModal'), BUILD.indexOf('function renderFinalizeModal'));
  assert.ok(!/md-img-fallback|md-diagram/.test(modal), '渲染函数不内联增强 DOM（增强由 md-rich 统一处理）');
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
