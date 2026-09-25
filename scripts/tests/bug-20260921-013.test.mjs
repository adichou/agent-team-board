#!/usr/bin/env node
// BUG-20260921-013 文档编写界面文件区域语言页签布局 —— TDD 分层测试。
// B1 渲染结构：语言页签行（role=tablist/tab/aria-selected，默认语言恒为第一页签并标
//    「（默认）」+ 该语言审核计数角标 x/4）；每语言一个 tabpanel 仅含该语言 4 文件，
//    非激活面板 hidden；分组标题行（bld-doc-group /「剩余语言（…）」）不再出现；
//    表头全局汇总计数保留。
// B2 激活语言记忆与回落：pf.docLang 记忆激活语言；记忆语言不在语言集时回落默认语言；
//    语言集 N 语言 → N 页签。
// B3 AI 运行中角标：AI 总结 / AI 翻译当前文件在非激活语言页签 → 该页签 ◐ 运行角标 +
//    title 提示；不自动切换页签；当前文件在激活页签时不加角标（行内标注已可见）。
// B4 保留能力回归：七态 chip 全语言在 DOM（含隐藏面板）；激活页签行内 AI 进度标注；
//    门禁条 / 表头计数恒为语言集全局。
// B5 交互静态契约：data-doc-lang 点击绑定 → pf.docLang 赋值 + 重渲染。
// B6 i18n 中英同步：新词条双语；旧组头词条随分组标题行删除清理。
// B7 样式：.bld-doc-lang-tabs / .bld-doc-tab-count 存在；.bld-doc-group 分组样式清理。
// 用法：node scripts/tests/bug-20260921-013.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webDir = path.join(pluginRoot, 'scripts', 'web');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 提取 renderDocsPane（同 req-20260921-012 L4 口径） ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`  function ${name}\\([a-zA-Z]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

function vmRun(fns, context, expr) {
  const c = vm.createContext(context);
  vm.runInContext(fns, c);
  return vm.runInContext(expr, c);
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
  DOC_SINGLE_KEYS: ['LICENSE'], // REQ-20260922-002 单文件类（审查对话框页签含 LICENSE）
  DEFAULT_DOC_LANGS: ['cn', 'en'],
  langNameOf: flow.langNameOf,
  docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS),
};

const CTX = {
  pfOf: (v) => v.pf,
  esc: (s) => String(s),
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

function docsPaneFns(source) {
  return [
    extractFn(source, 'summaryBtnText'), extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'), extractFn(source, 'translateBtnHtml'),
    extractFn(source, 'commitBtnHtml'),
    extractFn(source, 'docsStageBar'), extractFn(source, 'renderDocsPane'),
  ].join('\n');
}

// cn,en 八文件样例（默认 cn 四文件全审 + en 四文件各态；stateOf 可按 key|lang 覆盖状态）。
// REQ-20260922-002：单文件类（LICENSE）不参与本 Bug 的页签口径样例（其行为由
// req-20260922-002.test.mjs 覆盖），样例仍为四类 × 语言集。
function planOf(langs, extra = {}, stateOf = null) {
  const restStates = ['translated', 'translating', 'untranslated', 'untranslated'];
  const files = flow.publishDocFiles(langs).filter((f) => !f.single).map((f) => ({
    ...f,
    isDefault: f.lang === langs[0],
    state: (stateOf && stateOf[`${f.key}|${f.lang}`])
      || (f.lang === langs[0] ? 'reviewed' : restStates[DOC_KEY_INDEX[f.key]]),
  }));
  const defTotal = files.filter((f) => f.isDefault).length;
  const restTotal = files.length - defTotal;
  const defReviewed = files.filter((f) => f.isDefault && f.state === 'reviewed').length;
  const restReviewed = files.filter((f) => !f.isDefault && f.state === 'reviewed').length;
  return {
    langs,
    docsFlow: {
      files, reviewedCount: defReviewed + restReviewed,
      defaultReviewedCount: defReviewed, restReviewedCount: restReviewed,
      canTranslate: true, translateMissing: [], canFinalize: false, finalized: null,
      canCommit: false, baselineShift: [], missing: files.filter((f) => f.state !== 'reviewed').map((f) => ({ file: f.file, state: f.state })),
    },
    summary: null, translate: null,
    docs: { overall: 'none' },
    ...extra,
  };
}
const DOC_KEY_INDEX = { README: 0, CHANGELOG: 1, FEATURES: 2, AGENTS: 3 };

function renderPane(fns, plan, pfExtra = {}) {
  return vmRun(fns, CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan, ...pfExtra })} })`);
}

const panelOf = (html, lang) => {
  const m = html.match(new RegExp(`<ul class="bld-docs-list"[^>]*id="bldDocPanel_${lang}"[^>]*>`));
  assert.ok(m, `语言面板 bldDocPanel_${lang} 应存在`);
  const start = m.index + m[0].length;
  const end = html.indexOf('</ul>', start);
  return html.slice(start, end);
};
const tabOf = (html, lang) => {
  const m = html.match(new RegExp(`<button type="button" class="rel-tab[^"]*" data-doc-lang="${lang}"[^>]*>`));
  assert.ok(m, `语言页签 data-doc-lang="${lang}" 应存在`);
  const start = m.index + m[0].length;
  const end = html.indexOf('</button>', start);
  return m[0] + html.slice(start, end);
};

/* ---------- B1 渲染结构：语言页签行 + 每语言面板 + 无分组标题行 ---------- */

t('B1-1 文件区域语言页签：tablist/tab/aria-selected；默认语言第一页签标「（默认）」+ 计数角标；表头全局汇总保留', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  const fns = docsPaneFns(source);
  const html = renderPane(fns, planOf(['cn', 'en']));
  // 页签行：role=tablist + 每语言一个 tab（与既有页签组件口径一致）
  assert.match(html, /<nav class="rel-tabs bld-doc-lang-tabs" role="tablist" aria-label="文档语言页签">/, '语言页签行 role=tablist');
  assert.equal((html.match(/data-doc-lang="cn"/g) || []).length, 1, 'cn 页签恰一个');
  assert.equal((html.match(/data-doc-lang="en"/g) || []).length, 1, 'en 页签恰一个');
  // 默认语言恒为第一个页签且激活（未记忆激活语言时回落默认语言），标「（默认）」+ 计数角标 4/4
  const cnTab = tabOf(html, 'cn');
  assert.match(cnTab, /class="rel-tab active"/, '默认语言页签激活态');
  assert.match(cnTab, /aria-selected="true"/, '默认语言页签 aria-selected');
  assert.match(cnTab, /role="tab"/, '默认语言页签 role=tab');
  assert.ok(cnTab.includes('（默认）'), '默认语言页签标「（默认）」');
  assert.match(cnTab, /bld-doc-tab-count[^>]*>4\/4</, 'cn 页签计数角标 4/4');
  const enTab = tabOf(html, 'en');
  assert.match(enTab, /aria-selected="false"/, 'en 页签未激活');
  assert.ok(!enTab.includes('（默认）'), '剩余语言页签不带默认标记');
  assert.match(enTab, /bld-doc-tab-count[^>]*>0\/4</, 'en 页签计数角标 0/4');
  assert.ok(cnTab.includes('中文') && enTab.includes('English'), '页签含语言显示名');
  // 表头全局汇总保留（页签化后仍一眼看到全局审核进度）
  assert.match(html, /文件（8 · 默认语言 4\/4 已审核 · 剩余语言 0\/4 已审核）/, '表头全局汇总计数');
});

t('B1-2 每语言一个 tabpanel：激活面板仅该语言四文件、非激活 hidden；tab/panel id 互链', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  const fns = docsPaneFns(source);
  const html = renderPane(fns, planOf(['cn', 'en']));
  const cnPanel = panelOf(html, 'cn');
  const enPanel = panelOf(html, 'en');
  assert.match(html.match(/<ul class="bld-docs-list"[^>]*id="bldDocPanel_cn"[^>]*>/)[0], /role="tabpanel"/, 'cn 面板 role=tabpanel');
  assert.match(html.match(/<ul class="bld-docs-list"[^>]*id="bldDocPanel_cn"[^>]*>/)[0], /aria-labelledby="bldDocTab_cn"/, 'cn 面板与页签互链');
  assert.doesNotMatch(html.match(/<ul class="bld-docs-list"[^>]*id="bldDocPanel_cn"[^>]*>/)[0], /hidden/, '激活面板不隐藏');
  assert.match(html.match(/<ul class="bld-docs-list"[^>]*id="bldDocPanel_en"[^>]*>/)[0], /hidden/, '非激活面板 hidden');
  // 激活面板仅该语言四文件；文件名标识豁免（BUG-20260921-004 口径）
  for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) {
    assert.ok(cnPanel.includes(f), `cn 面板含 ${f}`);
    assert.ok(!enPanel.includes(`>${f}<`), `en 面板不含默认语言文件 ${f}`);
  }
  for (const f of ['README_en.md', 'CHANGELOG_en.md', 'FEATURES_en.md', 'AGENTS_en.md']) {
    assert.ok(enPanel.includes(f), `en 面板含 ${f}`);
    assert.ok(!cnPanel.includes(f), `cn 面板不含 ${f}`);
  }
  assert.match(tabOf(html, 'cn'), /aria-controls="bldDocPanel_cn"/, '页签 aria-controls 指向面板');
});

t('B1-3 平铺分组形态清零：不再出现 bld-doc-group 分组标题行与「剩余语言（…）」组头', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  const fns = docsPaneFns(source);
  const html = renderPane(fns, planOf(['cn', 'en']));
  assert.ok(!html.includes('bld-doc-group'), '分组标题行 bld-doc-group 不再渲染');
  assert.ok(!html.includes('剩余语言（'), '「剩余语言（…）」组头不再渲染');
  assert.ok(!html.includes('，文件不带后缀）'), '「默认语言（…，文件不带后缀）」组头不再渲染（语言集输入框提示文案不受影响）');
});

/* ---------- B2 激活语言记忆与回落 ---------- */

t('B2-1 pf.docLang 记忆激活语言：en 页签激活、cn 面板 hidden；记忆语言不在语言集回落默认语言', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  const fns = docsPaneFns(source);
  // 记忆 en
  const html = renderPane(fns, planOf(['cn', 'en']), { docLang: 'en' });
  assert.match(tabOf(html, 'en'), /aria-selected="true"/, '记忆语言页签激活');
  assert.match(tabOf(html, 'cn'), /aria-selected="false"/, '默认语言页签未激活');
  assert.match(html.match(/<ul class="bld-docs-list"[^>]*id="bldDocPanel_cn"[^>]*>/)[0], /hidden/, '默认语言面板隐藏');
  assert.doesNotMatch(html.match(/<ul class="bld-docs-list"[^>]*id="bldDocPanel_en"[^>]*>/)[0], /hidden/, '记忆语言面板显示');
  // 记忆语言不在语言集（fr 不在 cn,en）：回落默认语言
  const html2 = renderPane(fns, planOf(['cn', 'en']), { docLang: 'fr' });
  assert.match(tabOf(html2, 'cn'), /aria-selected="true"/, '非法记忆回落默认语言页签');
  assert.doesNotMatch(html2.match(/<ul class="bld-docs-list"[^>]*id="bldDocPanel_cn"[^>]*>/)[0], /hidden/, '回落后面板显示');
});

t('B2-2 语言集动态联动：cn,en,fr → 3 个语言页签且默认语言第一页签；面板随语言集重建', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  const fns = docsPaneFns(source);
  const html = renderPane(fns, planOf(['cn', 'en', 'fr']));
  for (const l of ['cn', 'en', 'fr']) {
    assert.equal((html.match(new RegExp(`data-doc-lang="${l}"`, 'g')) || []).length, 1, `${l} 页签存在`);
  }
  // 默认语言 cn 第一页签（页签行内 cn 在 en / fr 之前）
  const nav = html.match(/<nav class="rel-tabs bld-doc-lang-tabs"[\s\S]*?<\/nav>/)[0];
  assert.ok(nav.indexOf('data-doc-lang="cn"') < nav.indexOf('data-doc-lang="en"'), '默认语言页签恒为第一个');
  assert.ok(nav.indexOf('data-doc-lang="en"') < nav.indexOf('data-doc-lang="fr"'), '页签按语言集次序');
  assert.ok(panelOf(html, 'en').includes('README_en.md'), 'en 面板随语言集重建');
  assert.ok(panelOf(html, 'fr').includes('README_fr.md'), 'fr 面板含 fr 文件');
});

/* ---------- B3 AI 运行中角标（不自动切换页签） ---------- */

t('B3-1 AI 翻译当前文件在非激活语言：该页签 ◐ 运行角标 + title 提示；激活页签不自动切换', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  const fns = docsPaneFns(source);
  const html = renderPane(fns, planOf(['cn', 'en'], {
    translate: { phase: 'running', counts: { translated: 1, total: 4 }, currentFile: 'CHANGELOG_en.md' },
  }));
  const enTab = tabOf(html, 'en');
  assert.match(enTab, /class="st st-run"/, '非激活语言页签运行角标');
  assert.match(enTab, /title="AI 翻译进行中：当前文件在该语言页签"/, '角标 title 提示');
  assert.match(tabOf(html, 'cn'), /aria-selected="true"/, '不自动切换页签（仍停在默认语言）');
  assert.ok(!tabOf(html, 'cn').includes('当前文件在该语言页签'), '激活页签不加角标（行内标注已可见）');
});

t('B3-2 AI 总结当前文件在非激活语言：同口径角标；当前文件在激活语言时无角标但行内进度保留', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  const fns = docsPaneFns(source);
  // AI 总结只处理默认语言文件；用 docLang 记忆 en 使默认语言成为非激活页签
  const html = renderPane(fns, planOf(['cn', 'en'], {
    summary: { phase: 'running', counts: { summarized: 2, total: 4 }, currentFile: 'CHANGELOG.md' },
  }), { docLang: 'en' });
  assert.match(tabOf(html, 'cn'), /title="AI 总结进行中：当前文件在该语言页签"/, 'AI 总结角标在默认语言页签');
  assert.match(tabOf(html, 'en'), /aria-selected="true"/, '激活页签不被自动切换');
  // 当前文件在激活语言（docLang 回默认 cn）：无角标，行内进度标注保留
  const html2 = renderPane(fns, planOf(['cn', 'en'], {
    summary: { phase: 'running', counts: { summarized: 2, total: 4 }, currentFile: 'CHANGELOG.md' },
  }));
  assert.ok(!tabOf(html2, 'cn').includes('当前文件在该语言页签'), '激活页签不加角标');
  assert.match(html2, /AI 总结 3\/4/, '激活面板行内 AI 总结进度标注保留');
});

/* ---------- B4 保留能力回归 ---------- */

t('B4-1 七态 chip 全语言保留在 DOM（含隐藏面板）；门禁条计数恒为语言集全局', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  const fns = docsPaneFns(source);
  // 七态全覆盖：默认语言四态 + 剩余语言四态（含 reviewed 共用）
  const sevenStates = {
    'README|cn': 'unsummarized', 'CHANGELOG|cn': 'summarizing', 'FEATURES|cn': 'summarized', 'AGENTS|cn': 'reviewed',
    'README|en': 'untranslated', 'CHANGELOG|en': 'translating', 'FEATURES|en': 'translated', 'AGENTS|en': 'reviewed',
  };
  const htmlSt = renderPane(fns, planOf(['cn', 'en'], {}, sevenStates));
  for (const label of ['未总结', '正在总结', '已总结待审核', '未翻译', '正在翻译', '已翻译待审核', '已审核']) {
    assert.ok(htmlSt.includes(label), `状态文字 ${label}`);
  }
  const html = renderPane(fns, planOf(['cn', 'en']));
  for (const f of ['README.md', 'README_en.md', 'CHANGELOG.md', 'CHANGELOG_en.md', 'FEATURES.md', 'FEATURES_en.md', 'AGENTS.md', 'AGENTS_en.md']) {
    assert.ok(html.includes(f), `文件行 ${f} 在 DOM（隐藏面板保留）`);
  }
  // 阶段条 / 门禁条不受页签切换影响（默认语言 4/4 · 剩余语言 0/4）
  assert.match(html, /① 默认语言先行/, '阶段条保留');
  assert.match(html, /默认语言 4\/4/, '门禁条默认语言全局计数');
  assert.match(html, /剩余语言 0\/4/, '门禁条剩余语言全局计数');
  // AI 翻译运行中：非激活面板行内进度标注也在 DOM（页签角标 + 行内标注双口径）
  const html2 = renderPane(fns, planOf(['cn', 'en'], {
    translate: { phase: 'running', counts: { translated: 1, total: 4 }, currentFile: 'CHANGELOG_en.md' },
  }));
  assert.match(html2, /AI 翻译 2\/4/, '当前文件行内 AI 翻译进度标注保留');
});

/* ---------- B5 交互静态契约（事件绑定 / 回落求值） ---------- */

t('B5-1 语言页签交互：data-doc-lang 点击绑定 → pf.docLang 赋值 + 重渲染；渲染读 pf.docLang 且语言集内校验回落', () => {
  const source = fs.readFileSync(path.join(webDir, 'build.js'), 'utf8');
  assert.match(source, /querySelectorAll\('\[data-doc-lang\]'\)/, 'bindView 绑定语言页签点击');
  assert.match(source, /pf\.docLang = [a-zA-Z]/, '点击写入 pf.docLang');
  const pane = source.match(/  function renderDocsPane\(v\) \{[\s\S]*?\n  \}/)[0];
  assert.match(pane, /pf\.docLang/, 'renderDocsPane 读 pf.docLang');
  assert.match(pane, /langs\.includes\(pf\.docLang\)/, '记忆语言不在语言集时回落默认语言');
});

/* ---------- B6 i18n 中英同步 ---------- */

t('B6-1 i18n：页签新词条中英同步；旧组头词条随分组标题行删除清理', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['（默认）', '文档语言页签', 'AI 总结进行中：当前文件在该语言页签', 'AI 翻译进行中：当前文件在该语言页签']) {
    assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k}`);
  }
  for (const k of ['默认语言（◇，文件不带后缀）', '剩余语言（◇ · AI 翻译）']) {
    assert.ok(!(k in EN_DYNAMIC), `旧组头词条应清理：${k}`);
  }
  I.setLang('en');
  assert.equal(I.t('（默认）'), ' (default)');
  assert.equal(I.t('文档语言页签'), 'Document language tabs');
  I.setLang('zh');
});

/* ---------- B7 样式 ---------- */

t('B7-1 样式：语言页签行 / 计数角标样式存在，窄屏沿用 rel-tabs 换行；分组标题行样式清理', () => {
  const css = fs.readFileSync(path.join(webDir, 'style.css'), 'utf8');
  assert.ok(css.includes('.bld-doc-lang-tabs'), '语言页签行样式存在');
  assert.ok(css.includes('.bld-doc-tab-count'), '计数角标样式存在');
  assert.ok(!css.includes('.bld-doc-group'), '分组标题行样式清理');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`);
  }
}
console.log(failed ? `\n${failed}/${cases.length} 失败` : `\n全部 ${cases.length} 组通过`);
process.exit(failed ? 1 : 0);
