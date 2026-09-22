#!/usr/bin/env node
// BUG-20260921-004：构建 → 版本计划 → 文档编写步「类型」下拉在中文界面把 README 显示成「说明」。
// 根因：i18n 反向词典（en→zh 往返）由 EN 词条 '说明': 'README'（条目详情抽屉文档页签）生成
// 精确逆映射 README → 说明；renderDocsPane 类型下拉 option 文本用裸键 README，MutationObserver
// 触发 translateTree 后中文模式 t('README') 命中逆映射被误译成「说明」。CHANGELOG / FEATURES /
// AGENTS 不是任何 EN 词条的值故不受影响；英文界面走 EN 分支（键为中文不命中）原样显示故正常。
// 修复：option 文本显示完整文件名 README.md / CHANGELOG.md / FEATURES.md / AGENTS.md
//（报告人口径，与底部文档 chips 的完整文件名口径一致；value 保持裸键供保存逻辑拼文件名），
// 并对类型下拉声明 data-i18n-skip——文件名是标识不是文案，不进翻译管线。
// 本文件回归：
// B1 词典层：四个带 .md 文件名在 zh 反复重翻下不变形（反向词典不得命中标识）；
// B2 渲染层（REQ-20260921-008 起口径）：文档编写页八文件列表与审查对话框的文件名标识一律
//     data-i18n-skip 豁免（原类型下拉随旧编辑区移除，豁免口径迁移到文件名展示处）；
// B3 根因锁定与豁免：未豁免时 zh 反向翻译确会把 README 译成「说明」；声明 data-i18n-skip
//     的子树 translateTree 不改写其中文本；
// B4 词条回归：条目详情抽屉「说明」页签词条与中英往返不受修复影响。
// 用法：node scripts/tests/bug-20260921-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../web/i18n.js';

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');

// ---- 最小假 DOM（与 bug-toast-i18n-selfmatch-20260912-004.test.mjs 同构，补 getAttribute） ----
function text(v) { return { nodeType: 3, nodeValue: v, childNodes: [] }; }
function el(tagName, { children = [], attrs = {} } = {}) {
  return {
    nodeType: 1, tagName: String(tagName).toUpperCase(), childNodes: children,
    getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
    setAttribute: () => {},
  };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('B1 词典层：四个 .md 文件名 zh 反复重翻不变形（反向词典不得命中标识）', () => {
  I.setLang('zh');
  for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) {
    let cur = f;
    for (let i = 0; i < 6; i++) cur = I.t(cur); // 模拟轮询/语言往返整页重翻
    assert.equal(cur, f, `文件名标识不应被翻译（实际：${cur}）`);
  }
  I.setLang('en');
  assert.equal(I.t('README.md'), 'README.md', 'en 模式文件名原样（非中文键不命中）');
  I.setLang('zh');
});

t('B2 渲染层：文档编写页文件名标识声明 data-i18n-skip（列表行 + 审查对话框双栏）', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const pick = (name) => {
    const m = source.match(new RegExp(`  function ${name}\\(([a-zA-Z]*)\\) \\{[\\s\\S]*?\\n  \\}`));
    assert.ok(m, `build.js 中应存在 ${name} 函数`);
    return m[0];
  };
  const ctx = {
    pfOf: (v) => v.pf,
    esc: (s) => String(s),
    short: (h) => String(h || '').slice(0, 8),
    fmtTime: () => 't',
    DOCS_FLOW_LABEL: { unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核', untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核', reviewed: '已审核' },
    DOCS_FLOW_CLS: { unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait', untranslated: 'st-mute', translating: 'st-run', translated: 'st-wait', reviewed: 'st-ok' },
    DOCS_FLOW_ICON: { unsummarized: '○', summarizing: '◐', summarized: '●', untranslated: '○', translating: '◐', translated: '●', reviewed: '✔' },
    DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
    DOC_SINGLE_KEYS: ['LICENSE'], // REQ-20260922-002 单文件类（审查对话框页签含 LICENSE）
    // REQ-20260921-010 起文档清单按语言集动态展开（原模块级 DOC_FILES 常量下线）
    DEFAULT_DOC_LANGS: ['cn', 'en'],
    langNameOf: (l) => String(l),
    docFilesOf: (langs) => ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'].flatMap((key) => [
      { key, lang: 'zh', file: `${key}.md` },
      { key, lang: 'en', file: `${key}.en.md` },
    ]).slice(0, Array.isArray(langs) && langs.length ? langs.length * 4 : 8),
  };
  const context = vm.createContext(ctx);
  // REQ-20260921-012：renderDocsPane 新增依赖（阶段条 / AI 翻译 / 整体审查 / 分组求值兜底）
  vm.runInContext([pick('summaryBtnText'), pick('translateBtnText'), pick('normalizeFlowEval'), pick('translateBtnHtml'), pick('finalizeBtnHtml'), pick('commitBtnHtml'), pick('docsStageBar'), pick('renderDocsPane'), pick('renderReviewModal')].join('\n'), context);
  const html = vm.runInContext(`renderDocsPane({
    id: 'V',
    pf: {
      phase: 'ready',
      plan: {
        langs: ['zh', 'en'],
        docsFlow: { files: [
          { file: 'README.md', lang: 'zh', state: 'unsummarized' },
          { file: 'README.en.md', lang: 'en', state: 'unsummarized' },
        ], reviewedCount: 0, canCommit: false, missing: [{ file: 'README.md', state: 'unsummarized' }] },
        docs: { overall: 'none' },
      },
    },
  }) + renderReviewModal({
    id: 'V',
    pf: {
      review: { open: true, key: 'README', modes: { 'README.md': 'preview', 'README.en.md': 'preview' },
        contents: { 'README.md': '# zh', 'README.en.md': '# en' } },
      plan: { langs: ['zh', 'en'], docsFlow: { files: [
        { file: 'README.md', lang: 'zh', state: 'unsummarized' },
        { file: 'README.en.md', lang: 'en', state: 'unsummarized' },
      ], reviewedCount: 0 } },
    },
  })`, context);
  // 文件名标识（列表行 fname / 审查对话框栏头）声明 data-i18n-skip：文件名是标识不是文案
  const names = [...html.matchAll(/<span class="bld-doc-fname" data-i18n-skip>([^<]+)</g)].map((m) => m[1]);
  assert.ok(names.some((n) => n.startsWith('README.md')), '文件列表行文件名带豁免');
  assert.ok(names.some((n) => n.startsWith('README.en.md')), '审查对话框双栏文件名带豁免');
  // 未豁免的裸键形态不得再出现（旧类型下拉已移除）
  assert.doesNotMatch(html, /<select class="bld-doc-key"/, '旧类型下拉随编辑区移除');
});

t('B3 根因锁定与豁免：未豁免时 zh 反向翻译确会把 README 译成「说明」；豁免子树不改写', () => {
  I.setLang('zh');
  // 根因锁定：反向词典的精确逆映射来自抽屉「说明」页签词条（该词条须保留，见 B4）
  assert.equal(I.t('README'), '说明', '根因形态：zh 模式 t(README) 命中逆映射');
  // 声明 data-i18n-skip 的 select 子树：translateTree 不改写其中 option 文本
  const opt = text('README.md');
  const sel = el('select', { children: [opt], attrs: { 'data-i18n-skip': '' } });
  I.translateTree(el('div', { children: [sel] }));
  assert.equal(opt.nodeValue, 'README.md', `豁免子树不应被翻译（实际：${opt.nodeValue}）`);
});

t('B4 词条回归：抽屉「说明」页签词条与中英往返不受修复影响', () => {
  I.setLang('en');
  assert.equal(I.t('说明'), 'README', '抽屉页签词条保留：en 界面「说明」页签显示 README');
  I.setLang('zh');
  assert.equal(I.t('README'), '说明', '往返：已译英文 README 切回中文还原「说明」');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
