#!/usr/bin/env node
// REQ-20260921-011 发布模块的文档预览要支持 Markdown 格式预览 —— 分层测试。
// L1 renderMd 渲染层（vm 加载真实 vendored marked v12.0.2：GFM 常用元素 / 消毒 /
//    渲染器抛错回退 / marked 未加载回退）；
// L2 renderReviewModal 预览态契约（富文本容器 / BUG-20260925-006 起编辑态移除（恒预览） /
//    端到端消毒 / 空文档占位 / 读取中 / data-i18n-skip 口径 / 同步滚动绑定与交互回归）；
// L3 i18n 回归（占位与读取中文案词条中英齐备、往返不变形）。
// 用法：node scripts/tests/req-20260921-011.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const SOURCE = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
// 浏览器同源：加载仓库 vendor 的真实 marked（index.html 已全局引入，验收要求复用而非新依赖）
const MARKED_SRC = fs.readFileSync(new URL('../web/marked.min.js', import.meta.url), 'utf8');
assert.match(MARKED_SRC.slice(0, 200), /marked v12\.0\.2/, 'vendor marked 版本口径 v12.0.2');

function pick(name) {
  const m = SOURCE.match(new RegExp(`  function ${name}\\(([a-zA-Z]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

const escImpl = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// vm 上下文：withMarked=false 模拟 marked 未加载（renderMd 应回退源码展示不抛错）
function mdContext({ withMarked = true, breakParser = false } = {}) {
  const ctx = {
    pfOf: (v) => v.pf,
    esc: escImpl,
    short: (h) => String(h || '').slice(0, 8),
    fmtTime: () => 't',
    DOCS_FLOW_LABEL: flow.DOCS_FLOW_LABEL,
    DOCS_FLOW_CLS: { unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait', reviewed: 'st-ok' },
    DOCS_FLOW_ICON: { unsummarized: '○', summarizing: '◐', summarized: '●', reviewed: '✔' },
    DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
    DOC_SINGLE_KEYS: ['LICENSE'], // REQ-20260922-002 单文件类（审查对话框页签含 LICENSE）
    DEFAULT_DOC_LANGS: ['cn', 'en'],
    langNameOf: flow.langNameOf,
    docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : ['cn', 'en']),
  };
  const context = vm.createContext(ctx);
  vm.runInContext('var window = globalThis;', context);
  if (withMarked) vm.runInContext(MARKED_SRC, context);
  if (breakParser) vm.runInContext('window.marked = { parse: () => { throw new Error("parser boom"); } };', context);
  vm.runInContext([pick('sanitizeHtml'), pick('renderMd'), pick('renderReviewModal')].join('\n'), context);
  return context;
}

const GFM_MD = [
  '# 标题一',
  '',
  '## 标题二',
  '',
  '- 列表甲',
  '- 列表乙',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '| 列 | 值 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '> 引用块',
  '',
  '[链接](https://example.com)',
  '',
  '`行内代码` 与 **粗体** *斜体*',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
].join('\n');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 renderMd 渲染层 ---------- */

t('L1-1 GFM 常用元素：标题/列表/表格/引用/链接/行内代码/围栏代码块/粗斜体', () => {
  const out = vm.runInContext(`renderMd(${JSON.stringify(GFM_MD)})`, mdContext());
  assert.match(out, /<h1[^>]*>标题一<\/h1>/, '一级标题');
  assert.match(out, /<h2[^>]*>标题二<\/h2>/, '二级标题');
  assert.match(out, /<ul>[\s\S]*?<li>列表甲<\/li>/, '无序列表');
  assert.match(out, /<ol>[\s\S]*?<li>有序一<\/li>/, '有序列表');
  assert.match(out, /<table>[\s\S]*?<th[^>]*>列[\s\S]*?<td[^>]*>b<\/td>/, 'GFM 表格');
  assert.match(out, /<blockquote>[\s\S]*?引用块/, '引用块');
  assert.match(out, /<a href="https:\/\/example\.com">链接<\/a>/, '链接');
  assert.match(out, /<code>行内代码<\/code>/, '行内代码');
  assert.match(out, /<pre><code[^>]*>const a = 1;/, '围栏代码块');
  assert.match(out, /<strong>粗体<\/strong>/, '粗体');
  assert.match(out, /<em>斜体<\/em>/, '斜体');
});

t('L1-2 消毒：<script> 块与 on* 内联事件不得进入输出', () => {
  const md = '# t\n\n<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n正文';
  const out = vm.runInContext(`renderMd(${JSON.stringify(md)})`, mdContext());
  assert.ok(!/<script/i.test(out), 'script 块被剥除');
  assert.ok(!/onerror/i.test(out), 'onerror 内联事件被剥除');
  assert.match(out, /<h1[^>]*>t<\/h1>/, '其余内容正常渲染');
  assert.match(out, /正文/, '正文保留');
});

t('L1-3 渲染器抛错回退：marked.parse 抛异常时回退转义源码 <pre>，不向调用方抛错', () => {
  const md = '# 崩 <b>溃</b>';
  const out = vm.runInContext(`renderMd(${JSON.stringify(md)})`, mdContext({ breakParser: true }));
  assert.match(out, /^<pre>/, '回退 pre 展示');
  assert.ok(out.includes(escImpl(md)), '源码经转义后展示');
  assert.ok(!out.includes('<h1'), '不再输出富文本');
});

t('L1-4 marked 未加载回退：window.marked 缺失同样回退源码展示，不白屏', () => {
  const out = vm.runInContext('renderMd("# 缺席")', mdContext({ withMarked: false }));
  assert.match(out, /^<pre># 缺席<\/pre>$/, 'marked 缺失回退源码');
});

/* ---------- L2 renderReviewModal 预览态契约 ---------- */

function planOf(files) {
  return { langs: ['cn', 'en'], docsFlow: { files, reviewedCount: files.filter((f) => f.state === 'reviewed').length } };
}

const README_FILES = [
  { key: 'README', lang: 'cn', file: 'README.md', state: 'reviewed' },
  { key: 'README', lang: 'en', file: 'README_en.md', state: 'unsummarized' },
  { key: 'CHANGELOG', lang: 'cn', file: 'CHANGELOG.md', state: 'unsummarized' },
  { key: 'CHANGELOG', lang: 'en', file: 'CHANGELOG_en.md', state: 'unsummarized' },
  { key: 'FEATURES', lang: 'cn', file: 'FEATURES.md', state: 'unsummarized' },
  { key: 'FEATURES', lang: 'en', file: 'FEATURES_en.md', state: 'unsummarized' },
  { key: 'AGENTS', lang: 'cn', file: 'AGENTS.md', state: 'unsummarized' },
  { key: 'AGENTS', lang: 'en', file: 'AGENTS_en.md', state: 'unsummarized' },
];

function renderModal(ctx, review, plan = planOf(README_FILES)) {
  return vm.runInContext(`renderReviewModal(${JSON.stringify({ id: 'BLD-20260921-011', pf: { review, plan } })})`, ctx);
}

t('L2-1 预览态渲染富文本容器；编辑态已随 BUG-20260925-006 只读化移除（无 textarea）', () => {
  const html = renderModal(mdContext(), {
    open: true, key: 'README',
    contents: { 'README.md': GFM_MD, 'README_en.md': '# EN source' },
  });
  // 预览态：富文本容器（.md 排版口径）+ 渲染结果元素
  assert.match(html, /<div class="bld-review-preview md" data-review-file="README\.md" data-i18n-skip>/, '富文本容器（md 排版 + 豁免）');
  assert.match(html, /<h1[^>]*>标题一<\/h1>/, '标题渲染');
  assert.match(html, /<table>/, '表格渲染');
  // 旧「纯源码 pre 预览」形态不再出现
  assert.ok(!html.includes('<pre class="bld-review-preview"'), '不再以源码 pre 作预览');
  // BUG-20260925-006：编辑态 textarea 随审查去编辑化移除（编辑走②二次编辑弹窗）
  assert.ok(!html.includes('bld-review-editor'), '无编辑态 textarea');
});

t('L2-2 端到端消毒：预览内容含 <script> 时富文本输出无 script 节点', () => {
  const md = '# 安全\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n';
  const html = renderModal(mdContext(), {
    open: true, key: 'README',
    contents: { 'README.md': md, 'README_en.md': 'x' },
  });
  assert.ok(!/<script/i.test(html), 'script 不进入预览 DOM');
  assert.ok(!/onerror/i.test(html), 'onerror 不进入预览 DOM');
  assert.match(html, /<h1[^>]*>安全<\/h1>/, '正常内容仍渲染');
});

t('L2-3 空文档占位与读取中：空串/纯空白显示「（空文档）」；未到达显示读取中', () => {
  const ctx = mdContext();
  const html = renderModal(ctx, {
    open: true, key: 'README',
    contents: { 'README.md': '', 'README_en.md': '  \n\t ' },
  });
  assert.equal((html.match(/（空文档）/g) || []).length, 2, '两栏空文档占位');
  assert.match(html, /<div class="bld-review-preview muted small" data-review-file="README\.md">（空文档）<\/div>/, '占位元素形态');
  assert.ok(!html.includes('bld-review-preview md'), '空文档不渲染富文本区');

  const loading = renderModal(mdContext(), {
    open: true, key: 'README', contents: {},
  });
  assert.ok((loading.match(/正在读取文档内容…/g) || []).length >= 2, '内容未到达显示读取中');
  assert.ok(!loading.includes('（空文档）'), '读取中与空文档不混淆');
});

t('L2-4 data-i18n-skip 口径：富文本容器豁免 / 占位与读取中不豁免（可随界面语言翻译）/ 文件名豁免沿用', () => {
  const html = renderModal(mdContext(), {
    open: true, key: 'README',
    contents: { 'README.md': GFM_MD, 'README_en.md': '# EN' },
  });
  assert.match(html, /class="bld-review-preview md" data-review-file="[^"]*" data-i18n-skip/, '富文本容器豁免：文档本体不进界面词典');
  assert.match(html, /class="bld-doc-fname" data-i18n-skip/, '文件名豁免沿用（BUG-20260921-004）');
  const empty = renderModal(mdContext(), {
    open: true, key: 'README', contents: { 'README.md': '' },
  });
  assert.doesNotMatch(empty, /class="bld-review-preview muted small" data-review-file="[^"]*" data-i18n-skip/, '空文档占位不豁免：可被 i18n 翻译');
});

t('L2-5 同步滚动绑定：预览容器纳入绑定，比例算法与调用点保留', () => {
  const fn = pick('bindReviewSyncScroll');
  assert.match(fn, /bld-review-preview/, '选择器纳入富文本预览容器（恒预览态）');
  assert.ok(!fn.includes('textarea'), 'BUG-20260925-006：编辑态 textarea 已随编辑入口移除');
  assert.match(fn, /scrollHeight/, '按滚动高度比例跟随');
  assert.match(SOURCE, /bindReviewSyncScroll\(reviewWrap\)/, '对话框渲染后仍调用同步滚动绑定');
});

t('L2-6 交互回归：页签 / 通过审核 / 关闭 / 计数均在；BUG-20260925-006 后无编辑·保存控件', () => {
  const html = renderModal(mdContext(), {
    open: true, key: 'README',
    contents: { 'README.md': GFM_MD, 'README_en.md': '# EN' },
  });
  for (const k of ['README', 'CHANGELOG', 'FEATURES', 'AGENTS']) {
    assert.ok(html.includes(`data-review-tab="${k}"`), `类型页签 ${k}`);
  }
  assert.ok(!html.includes('data-review-mode') && !html.includes('data-review-save'), 'BUG-20260925-006：无编辑/预览切换与保存按钮');
  assert.ok(html.includes('data-review-approve'), '通过审核按钮');
  assert.ok(html.includes('data-review-close'), '关闭按钮');
  assert.match(html, /README（1\/2）/, '页签 n/N 计数');
});

/* ---------- L3 i18n 回归 ---------- */

t('L3-1 i18n：占位与读取中文案词条中英齐备、往返不变形', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  assert.equal(EN['（空文档）'], '(empty document)');
  assert.equal(EN['正在读取文档内容…'], 'Reading document content…');
  I.setLang('en');
  assert.equal(I.t('（空文档）'), '(empty document)');
  I.setLang('zh');
  assert.equal(I.t('（空文档）'), '（空文档）');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
