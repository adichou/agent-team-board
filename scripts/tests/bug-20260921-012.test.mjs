#!/usr/bin/env node
// BUG-20260921-012 语言集移到文档编写三阶段的右侧对齐 —— 前端布局契约测试。
// 缺陷：renderDocsPane 的 langsField（.bld-docs-langset）拼接在副标题条 .bld-docs-sub 之后
// 独占一行（REQ-20260921-010 引入）；修复后语言集控件与「文档编写 · 三阶段」标题同行、右侧对齐。
// L1 渲染结构（vm 提取 renderDocsPane：标题行 .bld-docs-titlebar 内 标题 + 语言集，次序
//    标题 → 语言集 → 说明 → 六按钮，语言集不再是 .bld-docs-sub 之后的独立行）；
// L2 交互保持（data-pf-langs / label.for / title / 保存中禁用 / 失败态禁用 / 行内错误 / 草稿回显）；
// L3 CSS 契约（style.css：.bld-docs-sub 纵向布局、.bld-docs-titlebar 右对齐、
//    .bld-docs-langset 去独立行 padding、hint 右对齐换行、行内错误去旧独立行 padding）；
// L4 i18n（词条原样保留中英同步，BUG-20260912-001 基线）。
// 用法：node scripts/tests/bug-20260921-012.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 提取 renderDocsPane（同 req-20260921-010 L4 口径） ---------- */

function renderWith(pfOverrides) {
  const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
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
    DOCS_FLOW_LABEL: { unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核', reviewed: '已审核' },
    DOCS_FLOW_CLS: { unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait', reviewed: 'st-ok' },
    DOCS_FLOW_ICON: { unsummarized: '○', summarizing: '◐', summarized: '●', reviewed: '✔' },
    DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
    DEFAULT_DOC_LANGS: ['cn', 'en'],
    langNameOf: flow.langNameOf,
    docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : ['cn', 'en']),
  };
  const context = vm.createContext(ctx);
  vm.runInContext([
    pick('summaryBtnText'), pick('translateBtnText'), pick('normalizeFlowEval'), pick('translateBtnHtml'),
    pick('finalizeBtnHtml'), pick('commitBtnHtml'), pick('docsStageBar'), pick('renderDocsPane'),
  ].join('\n'), context);
  const plan = { langs: ['cn', 'en'], docs: { overall: 'none', reasons: [] } };
  const pf = { phase: 'ready', plan, ...pfOverrides };
  const html = vm.runInContext(`renderDocsPane({ id: 'V', pf: ${JSON.stringify(pf)} })`, context);
  return { html, source, fnSource: pick('renderDocsPane') };
}

/* ---------- L1 渲染结构：语言集与标题同行、右侧对齐 ---------- */

t('L1-1 标题行容器：语言集在 .bld-docs-titlebar 内紧跟标题（同行右侧），不再是副标题条下独立行', () => {
  const { html } = renderWith({});
  // 标题 + 语言集同容器（标题行）：strong 之后紧邻语言集簇
  assert.match(
    html,
    /<div class="bld-docs-titlebar">\s*<strong>文档编写 · 三阶段<\/strong>\s*<div class="bld-docs-langset">/,
    '语言集应在标题行 .bld-docs-titlebar 内、标题右侧（BUG-20260921-012）',
  );
  // 次序：副标题条 → 标题 → 语言集 → 说明文字 → 六按钮行（语言集不再排在按钮行之后）
  const idx = {
    sub: html.indexOf('<div class="bld-docs-sub">'),
    title: html.indexOf('文档编写 · 三阶段'),
    langset: html.indexOf('bld-docs-langset'),
    desc: html.indexOf('先总结审查默认语言四文档'),
    actions: html.indexOf('bld-docs-actions'),
  };
  assert.ok(idx.sub >= 0 && idx.title > idx.sub, '副标题条与标题存在');
  assert.ok(idx.langset > idx.title, '语言集在标题之后（同一标题行内）');
  assert.ok(idx.desc > idx.langset, '说明文字在语言集之后（语言集不再占按钮行下方一行）');
  assert.ok(idx.actions > idx.desc, '六按钮行在说明文字之后');
  // 旧缺陷形态（语言集作为 .bld-docs-sub 的兄弟节点独占一行）应消失
  assert.ok(!/\/div>\s*<div class="bld-docs-langset">/.test(html), '语言集不得再以独立行 div 紧跟 .bld-docs-sub 结束标签');
});

t('L1-2 源码契约：langsField 拼进标题行，旧「subBar 之后拼接」形态清理', () => {
  const { fnSource } = renderWith({});
  assert.ok(fnSource.includes('bld-docs-titlebar'), 'renderDocsPane 应有标题行容器');
  assert.ok(!/\$\{actionsHtml\}\s*<\/div>\s*\$\{langsField\}/.test(fnSource), 'langsField 不得再拼接在 .bld-docs-sub 之后');
});

/* ---------- L2 交互保持：移位不弱化（README 期望行为） ---------- */

t('L2-1 语言集输入框契约：label.for / data-pf-langs / title / 草稿回显保留', () => {
  const { html } = renderWith({ langsInput: 'cn,en,fr' });
  assert.match(html, /<label class="field-inline" for="bldDocLangs">语言集<\/label>/, '标签与 for 关联保留');
  assert.match(html, /<input id="bldDocLangs" data-pf-langs type="text" value="cn,en,fr"/, '输入框 id / 选择器钩子 / 草稿优先回显');
  assert.match(html, /title="[^"]*回车或失焦应用"/, 'title 辅助说明保留（悬停口径不变）');
  assert.match(html, /第一个为默认语言（不带后缀），其余为 KEY_lang\.md；回车 \/ 失焦应用/, '可见辅助说明文字保留');
});

t('L2-2 保存中与失败态：输入禁用 + 「保存中…」反馈保留', () => {
  const busy = renderWith({ langsBusy: true }).html;
  assert.match(busy, /保存中…/, '保存中提示保留');
  assert.match(busy, /<input id="bldDocLangs" data-pf-langs type="text" value="cn,en"[^>]* disabled/, '保存中输入禁用');
  const failed = renderWith({ phase: 'error', error: 'disk' }).html;
  assert.match(failed, /<input id="bldDocLangs" data-pf-langs type="text" value="cn,en"[^>]* disabled/, '读取失败态输入禁用（phase !== ready 口径）');
  assert.match(failed, /发布流程数据读取失败：disk/, '错误横幅不受移位影响');
  assert.match(failed, /data-pf-retry/, '重试按钮不受移位影响');
});

t('L2-3 行内校验错误：语言集簇内 role=alert 保留', () => {
  const { html } = renderWith({ langsErr: '语言重复：「cn」出现多次' });
  assert.match(html, /<p class="rel-form-err small bld-docs-langset-err" role="alert">语言重复：「cn」出现多次<\/p>/, '行内错误原样渲染');
});

/* ---------- L3 CSS 契约（style.css） ---------- */

t('L3-1 CSS：副标题条纵向布局 + 标题行右对齐 + 语言集去独立行样式', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  const rule = (sel) => {
    const m = css.match(new RegExp(`\\.?[\\w-]*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`));
    assert.ok(m, `style.css 缺少 ${sel} 规则`);
    return m[0];
  };
  const sub = rule('.bld-docs-sub');
  assert.match(sub, /flex-direction:\s*column/, '.bld-docs-sub 改纵向布局（标题行 → 说明 → 按钮行）');
  const titlebar = rule('.bld-docs-titlebar');
  assert.match(titlebar, /justify-content:\s*space-between/, '标题行左右分布（标题左、语言集右）');
  assert.match(titlebar, /flex-wrap:\s*wrap/, '标题行窄屏换行');
  const langset = rule('.bld-docs-langset');
  assert.ok(!/padding:\s*8px 12px 2px/.test(langset), '.bld-docs-langset 去掉独立行 padding（不再是标题条下一行）');
  assert.match(langset, /flex-wrap:\s*wrap/, '语言集簇允许内部换行');
  const hint = rule('.bld-docs-langset-hint');
  assert.match(hint, /text-align:\s*right/, '辅助说明右对齐（换行到输入框下方）');
  const err = rule('.bld-docs-langset-err');
  assert.ok(!/padding:\s*0 12px/.test(err), '.bld-docs-langset-err 去掉独立行 padding');
});

/* ---------- L4 i18n：词条原样保留（中英同步基线 BUG-20260912-001） ---------- */

t('L4-1 i18n：语言集相关词条中英同步保留（移位不改词典）', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  for (const k of ['语言集', '第一个为默认语言（不带后缀），其余为 KEY_lang.md；回车 / 失焦应用', '保存中…']) {
    assert.ok(k in EN, `缺少词条：${k}`);
  }
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
