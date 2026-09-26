#!/usr/bin/env node
// BUG-20260921-017 文档编写页面布局优化，去掉无用的文案提示 —— 前端布局契约测试。
// 缺陷：renderDocsPane 顶部副标题条 .bld-docs-sub 为三行纵向（标题行「文档编写 · 三阶段」+
// 语言集 → 副标题说明行 → 六按钮行，REQ-20260921-012 引入文案、BUG-20260921-012 落位）；
// 修复后删除标题与副标题，语言集与六按钮合并同一水平行，可见辅助说明并入输入框 title。
// L1 渲染结构（vm 提取 renderDocsPane：无标题 / 副标题 / 可见辅助说明节点，
//    .bld-docs-sub 单行内 语言集簇 → 六按钮行，加载 / 失败态六按钮恒渲染）；
// L2 交互保持（data-pf-langs / label.for / title 悬浮提示 / 保存中禁用 / 失败态禁用 /
//    行内错误 / 草稿回显 / 六按钮数据钩子与门禁 title）；
// L3 CSS 契约（style.css：.bld-docs-sub 单行 flex、两簇可收缩换行、
//    旧标题行 / 副标题 / 可见辅助说明规则清理）；
// L4 i18n（三条不再渲染词条清理，邻近在用词条保留，BUG-20260912-001 中英同步基线）。
// 用法：node scripts/tests/bug-20260921-017.test.mjs

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

/* ---------- vm 提取 renderDocsPane（同 bug-20260921-012 L4 口径） ---------- */

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
    DOCS_FLOW_LABEL: { unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核', reviewed: '已审核', translated: '已翻译待审核', untranslated: '未翻译' },
    DOCS_FLOW_CLS: { unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait', reviewed: 'st-ok', translated: 'st-wait', untranslated: 'st-mute' },
    DOCS_FLOW_ICON: { unsummarized: '○', summarizing: '◐', summarized: '●', reviewed: '✔', translated: '●', untranslated: '○' },
    DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
    DEFAULT_DOC_LANGS: ['cn', 'en'],
    langNameOf: flow.langNameOf,
    docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : ['cn', 'en']),
  };
  const context = vm.createContext(ctx);
  vm.runInContext([
    pick('summaryBtnText'), pick('translateBtnText'), pick('normalizeFlowEval'), pick('translateBtnHtml'),
    pick('commitBtnHtml'), pick('docsStageBar'), pick('renderDocsPane'), // finalizeBtnHtml 随 BUG-20260926-001 删除（入口落阶段条）
  ].join('\n'), context);
  const plan = { langs: ['cn', 'en'], docs: { overall: 'none', reasons: [] } };
  const pf = { phase: 'ready', plan, ...pfOverrides };
  const html = vm.runInContext(`renderDocsPane({ id: 'V', pf: ${JSON.stringify(pf)} })`, context);
  return { html, source, fnSource: pick('renderDocsPane') };
}

/* ---------- L1 渲染结构：标题 / 副标题删除，语言集与六按钮同一行 ---------- */

t('L1-1 标题与副标题删除：不再渲染「文档编写 · 三阶段」与说明句', () => {
  const { html } = renderWith({});
  assert.ok(!html.includes('文档编写 · 三阶段'), '标题文本不得再渲染');
  assert.ok(!html.includes('先总结审查默认语言四文档'), '副标题说明句不得再渲染');
  assert.ok(!html.includes('bld-docs-titlebar'), '标题行容器不得再渲染');
  assert.ok(!html.includes('bld-docs-subtitle'), '副标题容器不得再渲染');
});

t('L1-2 同一行结构：.bld-docs-sub 单行内 语言集簇 → 六按钮行', () => {
  const { html } = renderWith({});
  const subStart = html.indexOf('<div class="bld-docs-sub">');
  assert.ok(subStart >= 0, '副标题条容器 .bld-docs-sub 保留（承载单行）');
  const subEnd = html.indexOf('</div>\n', html.indexOf('bld-docs-actions'));
  const sub = html.slice(subStart, subEnd);
  const idx = {
    langset: sub.indexOf('bld-docs-langset'),
    actions: sub.indexOf('bld-docs-actions'),
  };
  assert.ok(idx.langset >= 0, '语言集簇在 .bld-docs-sub 内');
  assert.ok(idx.actions > idx.langset, '六按钮行在语言集之后（同一水平行，语言集在前）');
  // 单行直接子层：.bld-docs-sub 与 .bld-docs-langset / .bld-docs-actions 之间不得再有标题 / 说明层
  assert.ok(!/bld-docs-sub">\s*<div class="bld-docs-subtitle"/.test(html), '.bld-docs-sub 内不得再有副标题层');
});

t('L1-3 可见辅助说明删除：信息并入输入框 title 悬浮提示', () => {
  const { html } = renderWith({});
  assert.ok(!html.includes('bld-docs-langset-hint'), '可见辅助说明节点不得再渲染');
  assert.ok(!/>第一个为默认语言（不带后缀）/.test(html), '可见辅助说明文字不得再作为元素文本渲染');
  assert.match(html, /title="[^"]*第一个语言为默认语言（文件不带后缀）[^"]*回车或失焦应用"/, '输入框 title 悬浮提示保留全量口径');
});

t('L1-4 六按钮恒渲染：加载 / 失败态不隐藏', () => {
  const loading = renderWith({ phase: 'loading', plan: null }).html;
  assert.ok(loading.includes('bld-docs-actions'), '加载态按钮行渲染');
  assert.ok(loading.includes('data-pf-refresh'), '加载态刷新按钮渲染');
  const failed = renderWith({ phase: 'error', error: 'disk' }).html;
  assert.ok(failed.includes('bld-docs-actions'), '失败态按钮行渲染');
  assert.ok(failed.includes('data-pf-retry'), '失败态重试按钮渲染');
});

/* ---------- L2 交互保持：删文案 / 并行不弱化（README 期望行为 4） ---------- */

t('L2-1 语言集输入框契约：label.for / data-pf-langs / title / 草稿回显保留', () => {
  const { html } = renderWith({ langsInput: 'cn,en,fr' });
  assert.match(html, /<label class="field-inline" for="bldDocLangs">语言集<\/label>/, '标签与 for 关联保留');
  assert.match(html, /<input id="bldDocLangs" data-pf-langs type="text" value="cn,en,fr"/, '输入框 id / 选择器钩子 / 草稿优先回显');
  assert.match(html, /title="逗号分隔的语言缩写（2–3 个字母，国际规范）/, 'title 悬浮提示保留');
});

t('L2-2 保存中与失败态：输入禁用 + 「保存中…」反馈保留', () => {
  const busy = renderWith({ langsBusy: true }).html;
  assert.match(busy, /保存中…/, '保存中提示保留');
  assert.match(busy, /<input id="bldDocLangs" data-pf-langs type="text" value="cn,en"[^>]* disabled/, '保存中输入禁用');
  const failed = renderWith({ phase: 'error', error: 'disk' }).html;
  assert.match(failed, /<input id="bldDocLangs" data-pf-langs type="text" value="cn,en"[^>]* disabled/, '读取失败态输入禁用（phase !== ready 口径）');
  assert.match(failed, /发布流程数据读取失败：disk/, '错误横幅不受布局调整影响');
});

t('L2-3 行内校验错误：语言集簇内 role=alert 保留', () => {
  const { html } = renderWith({ langsErr: '语言重复：「cn」出现多次' });
  assert.match(html, /<p class="rel-form-err small bld-docs-langset-err" role="alert">语言重复：「cn」出现多次<\/p>/, '行内错误原样渲染');
});

t('L2-4 六按钮数据钩子与刷新反馈保留', () => {
  const refreshing = renderWith({ refreshing: true }).html;
  assert.match(refreshing, /data-pf-refresh[^>]* disabled/, '刷新运行中禁用');
  assert.ok(refreshing.includes('正在读取…'), '刷新运行中文字反馈');
  const { html } = renderWith({});
  for (const hook of ['data-pf-summary', 'data-pf-translate', 'data-pf-review', 'data-pf-commit']) { // data-pf-finalize 随 BUG-20260926-002 完结阶段移除
    assert.ok(html.includes(hook), `按钮钩子保留：${hook}`);
  }
});

/* ---------- L3 CSS 契约（style.css） ---------- */

t('L3-1 CSS：.bld-docs-sub 单行 flex，语言集 / 按钮两簇可收缩换行', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  const rule = (sel) => {
    const m = css.match(new RegExp(`(?<![\\w-])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`));
    assert.ok(m, `style.css 缺少 ${sel} 规则`);
    return m[0];
  };
  const sub = rule('.bld-docs-sub');
  assert.match(sub, /display:\s*flex/, '.bld-docs-sub 保持 flex');
  assert.ok(!/flex-direction:\s*column/.test(sub), '.bld-docs-sub 不再纵向堆叠（单行布局）');
  assert.match(sub, /align-items:\s*center/, '同行垂直居中');
  assert.match(sub, /flex-wrap:\s*wrap/, '窄屏换行');
  const langset = rule('.bld-docs-langset');
  assert.ok(!/justify-content:\s*flex-end/.test(langset), '.bld-docs-langset 去右对齐独占语义（并入行首）');
  assert.match(langset, /flex-wrap:\s*wrap/, '语言集簇允许内部换行（行内错误换到簇下方）');
  const actions = rule('.bld-docs-actions');
  assert.match(actions, /flex-wrap:\s*wrap/, '按钮行允许内部换行');
  assert.ok(!/flex:\s*none/.test(actions), '按钮行可收缩（窄屏不横向溢出）');
  const err = rule('.bld-docs-langset-err');
  assert.match(err, /flex-basis:\s*100%/, '行内错误整行换行保留');
});

t('L3-2 CSS：旧节点规则清理（标题行 / 副标题 / 可见辅助说明）', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  for (const sel of ['.bld-docs-subtitle', '.bld-docs-titlebar', '.bld-docs-langset-hint']) {
    assert.ok(!css.includes(sel), `已无对应节点，规则应清理：${sel}`);
  }
});

/* ---------- L4 i18n：不再渲染词条清理，邻近在用词条保留 ---------- */

t('L4-1 i18n：标题 / 副标题 / 可见辅助说明三条词条清理', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  for (const k of [
    '文档编写 · 三阶段',
    '第一个为默认语言（不带后缀），其余为 KEY_lang.md；回车 / 失焦应用',
    '先总结审查默认语言四文档，审核完毕后 AI 翻译生成剩余语言文档，逐语言审查，最后整体审查完结后方可提交。',
  ]) {
    assert.ok(!(k in EN), `词条应随界面删除清理：${k.slice(0, 12)}…`);
  }
});

t('L4-2 i18n：语言集与六按钮在用词条保留（title 悬浮提示全量口径）', () => {
  const I = globalThis.ATBI18N;
  const { EN } = I._dict;
  for (const k of [
    '语言集',
    '逗号分隔的语言缩写（2–3 个字母，国际规范）；第一个语言为默认语言（文件不带后缀），其余语言文件为 KEY_lang.md；回车或失焦应用',
    '保存中…', '刷新', 'AI 总结', 'AI 翻译', '审查', '提交', // '整体审查' 词条随 BUG-20260926-001 独立按钮移除清理
  ]) {
    assert.ok(k in EN, `在用词条缺失：${k.slice(0, 12)}…`);
  }
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
