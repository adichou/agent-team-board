#!/usr/bin/env node
// REQ-20260924-003 整体审查完结弹窗布局精简 —— 分层测试（BUG-20260926-002 起完结对核
// 对话框随整体审查阶段整体移除，本测试转为「移除回归」契约：对话框与词条不残留、
// 校对能力由五步 ③ 与右侧建议栏承载不回退）。
// L4 前端静态契约（renderFinalizeModal / 钩子 / 核对项不残留；校对入口保留）；
// L6 i18n（完结对话框静态与动态词条全量清理；校对词条往返不变形）。
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
  // 显式带 normalizeFlowEval（与 req-20260924-001 同口径，不依赖其他用例先注入）；
  // REQ-20260924-004 起 ③ 项明细经 splitProofreadIssues / parseIssueLineNo 逐条渲染，一并注入
  return [
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'splitProofreadIssues'),
    extractFn(source, 'parseIssueLineNo'),
    extractFn(source, 'renderFinalizeModal'),
  ].join('\n');
}

const SOURCE = () => fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

/* ---------- L4 前端静态契约（BUG-20260926-002：完结对核对话框整体移除，
   本测试由「清单精简契约」转为「移除回归」契约，历史词条清理口径一并收口） ---------- */

t('L4-1 完结对核对话框整体移除：函数 / 按钮钩子 / 核对项文案不残留（含 REQ-20260924-003 已精简与保留的条目）', () => {
  const source = SOURCE();
  assert.ok(!/function renderFinalizeModal\(/.test(source), 'renderFinalizeModal 函数已删除');
  for (const gone of ['data-pf-finalize', 'data-pf-checks', '运行自动检查', '确认完结',
    '各语言内容语义一致（以已审核默认语言为基准）',
    '所有文档内链接真实可达（README 按语言互链：同语言 CHANGELOG 与 FEATURES，链接必须真实可达）',
    '默认语言错别字与行文规范（AI 校对自动上报）',
    '默认语言文件已全部审核', '剩余语言文件已全部审核',
    'LICENSE 文件与项目实际开源口径一致', '文档内容与本版发布范围一致']) {
    assert.ok(!source.includes(gone), `完结对话框残留清理：${gone.slice(0, 16)}…`);
  }
});

t('L4-2 校对能力不随对话框移除：五步 ③ 入口与右侧建议栏保留（docscheck 结果唯一呈现位）', () => {
  const source = SOURCE();
  for (const k of ['data-pf-proofstep', 'bld-docs-chk', 'data-chk-accept', 'data-chk-reject']) { // data-pf-proofread 为对话框内按钮，随宿主移除
    assert.ok(source.includes(k), `校对能力保留：${k}`);
  }
});

/* ---------- L6 i18n（BUG-20260926-002：完结对话框词条全量清理） ---------- */

t('L6-1 i18n：完结对核对话框静态与动态词条全量清理（REQ-20260924-003 保留口径一并收口）', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of [
    '各语言内容语义一致（以已审核默认语言为基准）',
    '所有文档内链接真实可达（README 按语言互链：同语言 CHANGELOG 与 FEATURES，链接必须真实可达）',
    '默认语言错别字与行文规范（AI 校对自动上报）',
    '提示：完结前请逐项核对；完结后范围变化会使完结失效回退。',
    '完结是人工确认动作：请逐项核对后再确认。',
    '确认完结',
    'LICENSE 文件与项目实际开源口径一致（许可证类型由人工确认，本单不做自动校验）',
    '文档内容与本版发布范围一致（未纳入本版的功能不得写成已发布）',
    '提示：完结后「提交」方可使用；默认语言文档更新或发布范围变化会使完结失效回退。',
  ]) {
    assert.ok(!(k in EN), `应清理静态词条：${k.slice(0, 12)}…`);
  }
  for (const k of ['默认语言文件已全部审核（◇/◇）', '剩余语言文件已全部审核（◇/◇）', '整体审查完结（◇）']) {
    assert.ok(!(k in EN_DYNAMIC), `应清理动态键：${k.slice(0, 12)}…`);
  }
});

t('L6-2 i18n 往返不变形：五步校对词条中英切换还原（能力迁移后回归）', () => {
  const I = globalThis.ATBI18N;
  I.setLang('en');
  assert.equal(I.t('AI 校对'), 'AI proofread');
  I.setLang('zh');
  assert.equal(I.t('AI 校对'), 'AI 校对');
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
