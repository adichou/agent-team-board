#!/usr/bin/env node
// BUG-20260921-012 语言集移到文档编写三阶段的右侧对齐 —— 前端布局契约测试。
// 缺陷：renderDocsPane 的 langsField（.bld-docs-langset）拼接在副标题条 .bld-docs-sub 之后
// 独占一行（REQ-20260921-010 引入）；修复后语言集控件并入顶部条（不再独占一行）。
// BUG-20260921-017：标题 / 副标题删除后口径更新——语言集与六按钮同处 .bld-docs-sub 单行。
// L1 渲染结构（vm 提取 renderDocsPane：.bld-docs-sub 单行内 语言集 → 六按钮，
//    语言集不再是 .bld-docs-sub 之后的独立行）；
// L2 交互保持（data-pf-langs / label.for / title / 保存中禁用 / 失败态禁用 / 行内错误 / 草稿回显）；
// L3 CSS 契约（style.css：.bld-docs-sub 单行 flex、.bld-docs-langset 允许内部换行、
//    行内错误整行换行、去旧独立行 padding）；
// L4 i18n（在用词条中英同步保留，BUG-20260912-001 基线；可见辅助说明词条随 BUG-20260921-017 清理）。
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
    pick('commitBtnHtml'), pick('docsStageBar'), pick('renderDocsPane'), // finalizeBtnHtml 随 BUG-20260926-001 删除（入口落阶段条）
  ].join('\n'), context);
  const plan = { langs: ['cn', 'en'], docs: { overall: 'none', reasons: [] } };
  const pf = { phase: 'ready', plan, ...pfOverrides };
  const html = vm.runInContext(`renderDocsPane({ id: 'V', pf: ${JSON.stringify(pf)} })`, context);
  return { html, source, fnSource: pick('renderDocsPane') };
}

/* ---------- L1 渲染结构：语言集并入顶部条（BUG-20260921-017 后为单行：语言集 → 六按钮） ---------- */

t('L1-1 顶部条容器：语言集在 .bld-docs-sub 内、六按钮行之前（同一水平行）', () => {
  const { html } = renderWith({});
  // BUG-20260921-017：删标题 / 副标题后语言集簇与六按钮同处 .bld-docs-sub 单行（语言集在前）
  const idx = {
    sub: html.indexOf('<div class="bld-docs-sub">'),
    langset: html.indexOf('bld-docs-langset'),
    actions: html.indexOf('bld-docs-actions'),
  };
  assert.ok(idx.sub >= 0 && idx.langset > idx.sub, '顶部条与语言集簇存在');
  assert.ok(idx.actions > idx.langset, '六按钮行在语言集之后（同一行内）');
  // 旧缺陷形态（语言集作为 .bld-docs-sub 的兄弟节点独占一行）应消失
  assert.ok(!/\/div>\s*<div class="bld-docs-langset">/.test(html), '语言集不得再以独立行 div 紧跟 .bld-docs-sub 结束标签');
});

t('L1-2 源码契约：langsField 拼进 .bld-docs-sub，旧「subBar 之后拼接」形态清理', () => {
  const { fnSource } = renderWith({});
  assert.ok(fnSource.includes('bld-docs-sub'), 'renderDocsPane 应有顶部条容器');
  assert.ok(!/\$\{actionsHtml\}\s*<\/div>\s*\$\{langsField\}/.test(fnSource), 'langsField 不得再拼接在 .bld-docs-sub 之后');
});

/* ---------- L2 交互保持：移位不弱化（README 期望行为） ---------- */

t('L2-1 语言集输入框契约：label.for / data-pf-langs / title / 草稿回显保留', () => {
  const { html } = renderWith({ langsInput: 'cn,en,fr' });
  assert.match(html, /<label class="field-inline" for="bldDocLangs">语言集<\/label>/, '标签与 for 关联保留');
  assert.match(html, /<input id="bldDocLangs" data-pf-langs type="text" value="cn,en,fr"/, '输入框 id / 选择器钩子 / 草稿优先回显');
  assert.match(html, /title="[^"]*回车或失焦应用"/, 'title 辅助说明保留（悬停口径不变）');
  // BUG-20260921-017：可见辅助说明行删除，口径并入输入框 title 悬浮提示
  assert.ok(!html.includes('bld-docs-langset-hint'), '可见辅助说明节点已随 BUG-20260921-017 删除');
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

t('L3-1 CSS：顶部条单行布局 + 语言集簇内部换行（BUG-20260921-017 后口径）', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  const rule = (sel) => {
    const m = css.match(new RegExp(`\\.?[\\w-]*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`));
    assert.ok(m, `style.css 缺少 ${sel} 规则`);
    return m[0];
  };
  const sub = rule('.bld-docs-sub');
  assert.match(sub, /display:\s*flex/, '.bld-docs-sub 保持 flex');
  assert.ok(!/flex-direction:\s*column/.test(sub), '.bld-docs-sub 不再纵向堆叠（语言集与六按钮同行）');
  assert.match(sub, /flex-wrap:\s*wrap/, '顶部条窄屏换行');
  const langset = rule('.bld-docs-langset');
  assert.ok(!/padding:\s*8px 12px 2px/.test(langset), '.bld-docs-langset 去掉独立行 padding（不再独占一行）');
  assert.match(langset, /flex-wrap:\s*wrap/, '语言集簇允许内部换行');
  const err = rule('.bld-docs-langset-err');
  assert.ok(!/padding:\s*0 12px/.test(err), '.bld-docs-langset-err 去掉独立行 padding');
  assert.match(err, /flex-basis:\s*100%/, '行内错误整行换行保留');
});

/* ---------- L4 i18n：在用词条保留（BUG-20260921-017 删可见辅助说明词条） ---------- */

t('L4-1 i18n：语言集相关在用词条中英同步保留', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  for (const k of ['语言集', '保存中…']) {
    assert.ok(k in EN, `缺少词条：${k}`);
  }
  // BUG-20260921-017：可见辅助说明行删除，词条随界面清理（口径并入输入框 title 词条）
  assert.ok(!('第一个为默认语言（不带后缀），其余为 KEY_lang.md；回车 / 失焦应用' in EN), '可见辅助说明词条应清理');
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
