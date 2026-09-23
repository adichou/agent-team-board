#!/usr/bin/env node
// REQ-20260924-003 整体审查完结弹窗布局精简 —— 分层测试。
// L4 前端静态契约（renderFinalizeModal：清单仅 3 条实际检查项；门禁两条与静态两条
//    不再渲染；自动检查 / AI 校对行为保持；底部提示收敛；取消 / 确认完结保持）；
// L6 i18n（新提示词条中英齐备；被移除词条与动态计数键清理；往返不变形）。
// 用法：node scripts/tests/req-20260924-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function extractFn(source, name) {
  const m = source.match(new RegExp(`  function ${name}\\(([a-zA-Z]*)\\) \\{[\\s\\S]*?\\n  \\}`));
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
  },
  DOCS_FLOW_CLS: {
    unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait',
    untranslated: 'st-mute', translating: 'st-run', translated: 'st-wait', reviewed: 'st-ok',
  },
  DOCS_FLOW_ICON: {
    unsummarized: '○', summarizing: '◐', summarized: '●',
    untranslated: '○', translating: '◐', translated: '●', reviewed: '✔',
  },
  DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
  DOC_SINGLE_KEYS: ['LICENSE'],
  DEFAULT_DOC_LANGS: ['cn', 'en'],
  langNameOf: (l) => String(l),
  docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS),
};

const L4_CTX = {
  pfOf: (v) => v.pf,
  esc: (s) => String(s),
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

function finalizeModalFns(source) {
  // 显式带 normalizeFlowEval（与 req-20260924-001 同口径，不依赖其他用例先注入）
  return [
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'renderFinalizeModal'),
  ].join('\n');
}

const SOURCE = () => fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

/* ---------- L4 前端静态契约 ---------- */

t('L4-1 清单精简为 3 条实际检查项；门禁两条与静态占位两条不再渲染', () => {
  const html = vmRun(finalizeModalFns(SOURCE()), L4_CTX, `renderFinalizeModal({ id: 'BLD-20260924-003', pf: {
    finalize: { open: true, busy: false },
    plan: { langs: ['cn', 'en'], docsFlow: { files: [], defaultReviewedCount: 5, restReviewedCount: 4, canFinalize: true, finalized: null } } } })`);
  assert.match(html, /整体审查完结（BLD-20260924-003）/, '对话框标题保持');
  // 仅含 3 条实际检查项
  for (const item of [
    '各语言内容语义一致（以已审核默认语言为基准）',
    '所有文档内链接真实可达（README 按语言互链：同语言 CHANGELOG 与 FEATURES，链接必须真实可达）',
    '默认语言错别字与行文规范（AI 校对自动上报）',
  ]) {
    assert.ok(html.includes(item), `实际检查项保留：${item.slice(0, 12)}…`);
  }
  // 门禁两条（含计数形态）与静态占位两条不再渲染
  for (const gone of ['默认语言文件已全部审核', '剩余语言文件已全部审核', 'LICENSE 文件与项目实际开源口径一致', '文档内容与本版发布范围一致']) {
    assert.ok(!html.includes(gone), `精简后不应出现：${gone}`);
  }
  // 顶层检查行恰 3 条（item() 顶层形态 = <li><span class="st …">，明细 <li> 是 <li><code 形态）
  const rows = (html.match(/<li><span class="st /g) || []).length;
  assert.equal(rows, 3, `顶层检查行应为 3 条，实际 ${rows}`);
});

t('L4-2 自动检查 / AI 校对行为保持：未运行提示 + 按钮在；✓/✗ 结果态与明细红叉不受精简影响', () => {
  const source = SOURCE();
  const fns = finalizeModalFns(source);
  const pfBase = { finalize: { open: true, busy: false }, plan: { langs: ['cn', 'en'], docsFlow: { files: [], defaultReviewedCount: 5, restReviewedCount: 4 } } };
  // 未运行态：三个未运行提示 + 两按钮
  const html0 = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(pfBase)} })`);
  assert.ok(html0.includes('语言一致自动检查未运行'), '语言一致未运行提示');
  assert.ok(html0.includes('链接可达性自动检查未运行'), '链接可达未运行提示');
  assert.ok(html0.includes('AI 校对未运行'), 'AI 校对未运行提示');
  assert.ok(html0.includes('data-pf-checks') && html0.includes('运行自动检查'), '「运行自动检查」按钮保持');
  assert.ok(html0.includes('data-pf-proofread') && html0.includes('AI 校对'), '「AI 校对」按钮保持');
  // 结果态：语言一致 ✓ + 死链 ✗ 明细仍渲染
  const pf1 = {
    ...pfBase,
    checks: {
      busy: false, error: null,
      lang: { ok: true, files: [{ file: 'README.md', lang: 'cn', ok: true, detail: '' }, { file: 'README_en.md', lang: 'en', ok: true, detail: '' }] },
      links: { ok: false, deadTotal: 1, files: [{ file: 'README.md', total: 3, dead: [{ href: 'MISSING.md', line: 6, reason: '本地文件不存在：MISSING.md' }] }] },
    },
  };
  const html1 = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(pf1)} })`);
  assert.ok(html1.includes('MISSING.md') && html1.includes('本地文件不存在'), '死链明细保持');
  assert.match(html1, /st-fail/, '红叉状态保持');
  assert.match(html1, /st-ok/, '通过状态保持');
  // AI 校对 done + fail 明细仍渲染
  const pf2 = {
    ...pfBase,
    plan: { ...pfBase.plan, docsCheck: {
      runId: 'chk-20260924-120000-ab01', phase: 'done',
      files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass' },
      issues: { 'CHANGELOG.md': '第 3 行：错别字「测式」应为「测试」' },
      counts: { pass: 3, fail: 1, pending: 0, total: 4 },
    } },
  };
  const html2 = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(pf2)} })`);
  assert.ok(html2.includes('第 3 行：错别字') && html2.includes('CHANGELOG.md'), '校对明细保持');
});

t('L4-3 底部提示收敛；取消 / 确认完结按钮保持', () => {
  const html = vmRun(finalizeModalFns(SOURCE()), L4_CTX, `renderFinalizeModal({ id: 'V', pf: {
    finalize: { open: true, busy: false },
    plan: { langs: ['cn', 'en'], docsFlow: { files: [], defaultReviewedCount: 4, restReviewedCount: 4 } } } })`);
  assert.ok(html.includes('提示：完结前请逐项核对；完结后范围变化会使完结失效回退。'), '新收敛提示文案');
  assert.ok(!html.includes('完结后「提交」方可使用'), '旧提示不再渲染');
  assert.ok(html.includes('完结是人工确认动作：请逐项核对后再确认。'), '完结人工确认口径保持');
  assert.ok(html.includes('data-pf-finalize-cancel') && html.includes('data-pf-finalize-confirm'), '取消 / 确认完结按钮保持');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新提示词条齐备；被移除词条与动态计数键清理（不再渲染不残留）', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  // 3 条保留检查项词条仍齐备
  for (const k of [
    '各语言内容语义一致（以已审核默认语言为基准）',
    '所有文档内链接真实可达（README 按语言互链：同语言 CHANGELOG 与 FEATURES，链接必须真实可达）',
    '默认语言错别字与行文规范（AI 校对自动上报）',
  ]) {
    assert.ok(typeof EN[k] === 'string' && EN[k], `保留词条缺失：${k.slice(0, 12)}…`);
  }
  // 新提示词条
  assert.ok(typeof EN['提示：完结前请逐项核对；完结后范围变化会使完结失效回退。'] === 'string' && EN['提示：完结前请逐项核对；完结后范围变化会使完结失效回退。'], '新提示词条缺失');
  // 被移除的静态词条（4 条清单 + 旧提示）清理
  for (const k of [
    'LICENSE 文件与项目实际开源口径一致（许可证类型由人工确认，本单不做自动校验）',
    '文档内容与本版发布范围一致（未纳入本版的功能不得写成已发布）',
    '提示：完结后「提交」方可使用；默认语言文档更新或发布范围变化会使完结失效回退。',
  ]) {
    assert.ok(!(k in EN), `应清理静态词条：${k.slice(0, 12)}…`);
  }
  // 被移除的动态计数键清理
  for (const k of ['默认语言文件已全部审核（◇/◇）', '剩余语言文件已全部审核（◇/◇）']) {
    assert.ok(!(k in EN_DYNAMIC), `应清理动态键：${k.slice(0, 12)}…`);
  }
  // 弹窗标题动态键保留（标题仍渲染版本号）
  assert.ok('整体审查完结（◇）' in EN_DYNAMIC, '标题动态键保留');
});

t('L6-2 i18n 往返不变形：新提示词条中英切换还原', () => {
  const I = globalThis.ATBI18N;
  const k = '提示：完结前请逐项核对；完结后范围变化会使完结失效回退。';
  I.setLang('en');
  assert.equal(typeof I.t(k), 'string');
  assert.notEqual(I.t(k), k, '英文语言下新提示应翻译');
  I.setLang('zh');
  assert.equal(I.t(k), k, '中文还原');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
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
