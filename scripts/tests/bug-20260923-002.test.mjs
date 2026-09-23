#!/usr/bin/env node
// BUG-20260923-002 审查界面预览图片与 mermaid/plantuml 补齐 —— 分层测试。
// L1 vendor 与静态接线（mermaid 懒加载 / md-rich 引入 / licenses.md）；
// L2 relFrom 相对路径拼接纯函数；
// L3 enhance 增强层（vm + 假 DOM + 桩 mermaid：图片改写 / 失败占位 / mermaid 渲染与回退 /
//    plantuml 降级 / 幂等与缓存回填 / 健壮性）；
// L4 四宿主接入源码契约（build.js 审查对话框 / app.js 文件面板与条目文档 / req-disc / oncall）
//    + renderMd 四处逐字同口径零改动；
// L5 样式（图片宽度约束 / 图表容器）；
// L6 i18n 中英同步（静态 + ◇ 动态插值，BUG-20260912-001 基线）。
// 用法：node scripts/tests/bug-20260923-002.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const webUrl = new URL('../web/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, webUrl), 'utf8');
const BUILD = read('build.js');
const APP = read('app.js');
const REQDISC = read('req-disc.js');
const ONCALL = read('oncall.js');
const CSS = read('style.css');
const INDEX = read('index.html');
const MD_RICH_SRC = read('md-rich.js');
const ITEM_DIR = new URL('../../agent-team-board/data/bugs/BUG-20260923-002/', import.meta.url);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- 假 DOM（仅覆盖 md-rich 用到的窄接口） ---------- */

function fakeNode(tag, attrs = {}) {
  const n = {
    tagName: String(tag).toUpperCase(),
    attrs: { ...attrs },
    children: [],
    parentElement: null,
    listeners: {},
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, v) { this.attrs[name] = String(v); },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    fire(ev) { for (const fn of this.listeners[ev] || []) fn(); },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    replaceWith(node) {
      if (this.parentElement) {
        const i = this.parentElement.children.indexOf(this);
        if (i >= 0) this.parentElement.children[i] = node;
        node.parentElement = this.parentElement;
      }
      this.parentElement = null;
    },
    _html: '',
  };
  Object.defineProperty(n, 'innerHTML', {
    get() { return n._html; },
    set(v) { n._html = String(v); n.children = []; },
  });
  return n;
}

function descendants(node, out = []) {
  for (const c of node.children || []) { out.push(c); descendants(c, out); }
  return out;
}

// 仅匹配 md-rich 用到的三种选择器形态：'img' / 'pre > code' / '.md-mermaid[data-pending]'
function matchSelector(node, sel) {
  if (sel === 'img') return node.tagName === 'IMG';
  if (sel === 'pre > code') return node.tagName === 'CODE' && node.parentElement && node.parentElement.tagName === 'PRE';
  if (sel === '.md-mermaid[data-pending]') {
    return String(node.attrs.class || '').split(/\s+/).includes('md-mermaid') && node.getAttribute('data-pending') != null;
  }
  throw new Error(`测试假 DOM 未支持选择器：${sel}`);
}

function fakeContainer(...children) {
  const root = fakeNode('div');
  for (const c of children) root.appendChild(c);
  root.querySelectorAll = (sel) => descendants(root).filter((n) => matchSelector(n, sel));
  return root;
}

function mdRichContext({ mermaid } = {}) {
  const head = fakeNode('head');
  const fakeDoc = {
    head,
    body: fakeNode('body'),
    createElement: (tag) => fakeNode(tag),
    querySelectorAll: () => [],
  };
  const sandbox = {
    console, Promise, Error, String, Object, RegExp, Math, JSON, Number, Array,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    encodeURIComponent, decodeURIComponent,
    document: fakeDoc,
    ATBI18N: globalThis.ATBI18N,
  };
  const context = vm.createContext(sandbox);
  if (mermaid !== undefined) sandbox.mermaid = mermaid;
  vm.runInContext(MD_RICH_SRC, context);
  return { context, sandbox, head };
}

function mermaidStub({ reject = null, svg = '<svg>OK</svg>' } = {}) {
  const calls = { init: [], render: [] };
  return {
    calls,
    initialize(cfg) { calls.init.push(cfg); },
    render(id, src) {
      calls.render.push([id, src]);
      if (reject) return Promise.reject(reject);
      return Promise.resolve({ svg });
    },
  };
}

function fenceNode(lang, src) {
  const code = fakeNode('code', { class: `language-${lang}` });
  code.textContent = src;
  const pre = fakeNode('pre');
  pre.appendChild(code);
  return pre;
}

const countNodes = (root, pred) => descendants(root).concat([root]).filter(pred).length;

/* ---------- L1 vendor 与静态接线 ---------- */

t('L1-1 mermaid vendor 产物：官方 IIFE 构建（全局暴露 + 版本串），licenses.md 记录 11.17.2 / MIT', () => {
  const buf = fs.readFileSync(new URL('../web/mermaid.min.js', webUrl));
  assert.ok(buf.length > 1_000_000, `应为完整 bundle（>1MB），实际 ${buf.length} 字节`);
  const src = buf.toString('utf8');
  assert.match(src, /globalThis\["mermaid"\]/, '官方 IIFE 尾部全局暴露标记');
  assert.match(src, /version:"11\.17\.2"/, '版本串 11.17.2');
  const licenses = fs.readFileSync(new URL('licenses.md', ITEM_DIR), 'utf8');
  assert.match(licenses, /\|\s*mermaid\s*\|\s*11\.17\.2\s*\|/, 'licenses.md 含 mermaid 11.17.2 行');
  assert.match(licenses, /MIT/, 'License 记录为 MIT（白名单）');
});

t('L1-2 懒加载而非静态引入：index.html 引 /md-rich.js 且不新增 mermaid 静态 script；md-rich 动态注入 /mermaid.min.js', () => {
  assert.match(INDEX, /<script src="\/md-rich\.js"><\/script>/, 'index.html 引入 md-rich.js（宿主脚本之前）');
  assert.ok(!/src="\/mermaid\.min\.js"/.test(INDEX), 'mermaid 不得静态引入（懒加载，常规加载零成本）');
  assert.match(MD_RICH_SRC, /\/mermaid\.min\.js/, 'md-rich 以 /mermaid.min.js 为库地址');
  assert.match(MD_RICH_SRC, /createElement\(['"]script['"]\)/, '动态注入 script 标签');
});

/* ---------- L2 relFrom 纯函数 ---------- */

t('L2-1 relFrom：空基归一 / 基目录拼接 / ../ 轻归一且越层原样交端点拒绝', async () => {
  await import('../web/md-rich.js');
  const { relFrom } = globalThis.ATBMdRich;
  assert.equal(relFrom('', './x.png'), 'x.png', '空基 + ./ 归一');
  assert.equal(relFrom('', 'x.png'), 'x.png', '空基直传');
  assert.equal(relFrom('docs', '../img/a.png'), 'img/a.png', '上一级归并');
  assert.equal(relFrom('docs/sub', './b/c.png'), 'docs/sub/b/c.png', '子目录拼接');
  assert.equal(relFrom('docs/', 'a.png'), 'docs/a.png', '基尾斜杠容忍');
  assert.equal(relFrom('', '../x.png'), '../x.png', '空基越层原样保留（端点拒绝 → 占位提示）');
  assert.equal(relFrom('docs', '../../x.png'), '../x.png', '越出基层数保留 ../（端点拒绝）');
});

/* ---------- L3 enhance 增强层 ---------- */

t('L3-1 图片改写：相对 src 经 imgBase 改写（./ 归一 + lazy + 标记）；协议 / 根相对 / 锚点不动；无 imgBase 不改写', () => {
  const { context } = mdRichContext({});
  const seen = [];
  const img = fakeNode('img', { src: './image/README/a.png' });
  const box = fakeContainer(img);
  context.ATBMdRich.enhance(box, { imgBase: (raw) => { seen.push(raw); return `/api/fs/raw?path=${encodeURIComponent(raw)}&project=P`; } });
  assert.deepEqual(seen, ['image/README/a.png'], 'imgBase 收到归一后的相对路径');
  assert.equal(img.src, '/api/fs/raw?path=image%2FREADME%2Fa.png&project=P', 'src 改写为白名单端点 URL');
  assert.equal(img.getAttribute('loading'), 'lazy', '懒加载标记');
  assert.equal(img.getAttribute('data-md-rich'), '1', '幂等标记');

  const ext = fakeNode('img', { src: 'https://e.test/x.png' });
  const rootRel = fakeNode('img', { src: '/api/fs/raw?path=a.png' });
  const anchor = fakeNode('img', { src: '#frag' });
  const data = fakeNode('img', { src: 'data:image/png;base64,xx' });
  const box2 = fakeContainer(ext, rootRel, anchor, data);
  context.ATBMdRich.enhance(box2, { imgBase: (raw) => `/api/fs/raw?path=${encodeURIComponent(raw)}` });
  for (const n of [ext, rootRel, anchor, data]) {
    assert.equal(n.src, undefined, `${n.getAttribute('src')} 不改写`);
    assert.equal(n.getAttribute('data-md-rich'), '1', '不改写也挂失败占位处理');
  }

  const plain = fakeNode('img', { src: 'rel/b.png' });
  const box3 = fakeContainer(plain);
  context.ATBMdRich.enhance(box3, {});
  assert.equal(plain.src, undefined, '无 imgBase（AI 文本宿主）不改写');
});

t('L3-2 图片失败占位：error 后原地替换为可见占位（含原路径 / URL），文案经 i18n 现算（中英往返）', () => {
  const { context } = mdRichContext({});
  const rewrote = fakeNode('img', { src: 'image/none.png' });
  const boxA = fakeContainer(rewrote);
  context.ATBMdRich.enhance(boxA, { imgBase: (raw) => `/api/fs/raw?path=${encodeURIComponent(raw)}` });
  rewrote.fire('error');
  let p = boxA.children[0];
  assert.equal(p.attrs.class, 'md-img-fallback muted small', '占位元素形态');
  assert.match(p.textContent, /image\/none\.png/, '占位含原路径');
  assert.match(p.textContent, /无法加载（不存在、越出项目根或超过 8MB 上限）/, '改写型占位文案（端点拒绝口径）');

  const ext = fakeNode('img', { src: 'https://e.test/x.png' });
  const boxB = fakeContainer(ext);
  context.ATBMdRich.enhance(boxB, {});
  ext.fire('error');
  p = boxB.children[0];
  assert.match(p.textContent, /https:\/\/e\.test\/x\.png/, '占位含外链 URL');
  assert.match(p.textContent, /加载失败（外链不可达、路径不存在或格式不受支持）/, '未改写型占位文案');

  // data-i18n-skip 子树内不会被动翻译 → 插入时经 ATBI18N.t() 自译（界面语言跟随）
  const I = globalThis.ATBI18N;
  I.setLang('en');
  const en = fakeNode('img', { src: 'image/none.png' });
  const boxC = fakeContainer(en);
  context.ATBMdRich.enhance(boxC, { imgBase: (raw) => `/api/fs/raw?path=${encodeURIComponent(raw)}` });
  en.fire('error');
  assert.match(boxC.children[0].textContent, /failed to load/, '英文界面下占位为英文');
  I.setLang('zh');
});

t('L3-3 mermaid 渲染：围栏（含大写）替换为 .md-mermaid 待渲染容器 → 桩渲染成功注入 SVG；strict + startOnLoad:false', async () => {
  const stub = mermaidStub({ svg: '<svg>FLOW</svg>' });
  const { context } = mdRichContext({ mermaid: stub });
  const pre = fenceNode('mermaid', 'graph TD\nA-->B');
  const preUpper = fenceNode('Mermaid', 'graph LR\nC-->D');
  const box = fakeContainer(pre, preUpper);
  context.ATBMdRich.enhance(box, {});
  let [d1, d2] = box.children;
  assert.equal(d1.attrs.class, 'md-mermaid', 'pre 替换为图表容器');
  assert.equal(d1.getAttribute('data-pending'), '1', '渲染前挂待渲染标记');
  assert.equal(d1.getAttribute('data-src'), 'graph TD\nA-->B', '源码入 data-src（缓存回填可重跑）');
  assert.equal(d1.getAttribute('data-i18n-skip'), '', '图表容器豁免界面词典（SVG 文字是文档本体）');
  assert.ok(countNodes(d1, (n) => n.attrs.class === 'muted small md-mermaid-note') === 1, '渲染中占位可见');

  await flush();
  [d1, d2] = box.children;
  assert.equal(d1.innerHTML, '<svg>FLOW</svg>', 'SVG 注入');
  assert.equal(d1.getAttribute('data-pending'), null, '渲染完成清除待渲染标记');
  assert.equal(d2.innerHTML, '<svg>FLOW</svg>', '大写围栏语言同样渲染');
  assert.equal(stub.calls.render.length, 2, '每个围栏渲染一次');
  const cfg = stub.calls.init[0];
  assert.equal(cfg.securityLevel, 'strict', 'strict：转义标签文字');
  assert.equal(cfg.startOnLoad, false, '手动渲染，不自动扫描全页');
  assert.ok(/dark|default/.test(cfg.theme), '主题为深浅色之一（随 prefers-color-scheme）');
});

t('L3-4 mermaid 失败回退：异步拒绝 / 同步抛错 / 库加载失败 → 源码块 + 可见提示，不向调用方抛错', async () => {
  const reject = mermaidStub({ reject: new Error('Parse boom') });
  const c1 = mdRichContext({ mermaid: reject });
  const pre1 = fenceNode('mermaid', 'bad ++ syntax');
  const box1 = fakeContainer(pre1);
  c1.context.ATBMdRich.enhance(box1, {});
  await flush();
  let w = box1.children[0];
  assert.equal(w.attrs.class, 'md-diagram-fallback', '回退容器');
  const errP = w.children.find((n) => n.attrs.class === 'md-diagram-err');
  assert.ok(errP, '可见错误提示条');
  assert.match(errP.textContent, /Mermaid 图表渲染失败（Parse boom）：已回退为源码展示/, '提示含原因');
  const srcPre = w.children.find((n) => n.tagName === 'PRE');
  assert.equal(srcPre.getAttribute('data-md-keep'), '1', '回退源码块标记防二次包裹');
  assert.equal(srcPre.children[0].textContent, 'bad ++ syntax', '源码完整保留');

  const thrower = { initialize() {}, render() { throw new Error('sync boom'); } };
  const c2 = mdRichContext({ mermaid: thrower });
  const box2 = fakeContainer(fenceNode('mermaid', 'x'));
  c2.context.ATBMdRich.enhance(box2, {});
  await flush();
  assert.match(box2.children[0].children.find((n) => n.attrs.class === 'md-diagram-err').textContent, /sync boom/, '同步抛错同口径回退');

  // 库加载失败：沙箱无 mermaid → 动态注入 script → 触发 onerror
  const c3 = mdRichContext({});
  const box3 = fakeContainer(fenceNode('mermaid', 'graph TD\nA-->B'));
  c3.context.ATBMdRich.enhance(box3, {});
  const script = c3.head.children.find((n) => n.tagName === 'SCRIPT');
  assert.ok(script, '懒加载注入 script');
  assert.equal(script.attrs.src, '/mermaid.min.js', '库地址');
  script.fire('error');
  await flush();
  assert.match(box3.children[0].children.find((n) => n.attrs.class === 'md-diagram-err').textContent, /渲染库加载失败/, '库缺失降级提示');
  assert.equal(box3.children[0].children.find((n) => n.tagName === 'PRE').children[0].textContent, 'graph TD\nA-->B', '源码回退');
});

t('L3-5 plantuml 降级：提示条 + 源码（非裸源码），不注入 mermaid 库', () => {
  const { context, head } = mdRichContext({});
  const pre = fenceNode('plantuml', '@startuml\nA -> B\n@enduml');
  const box = fakeContainer(pre);
  context.ATBMdRich.enhance(box, {});
  const w = box.children[0];
  assert.equal(w.attrs.class, 'md-diagram-fallback', '降级容器');
  const note = w.children.find((n) => n.attrs.class === 'md-diagram-note');
  assert.ok(note, '可见降级提示条');
  assert.match(note.textContent, /PlantUML 图表暂不支持本地渲染/, '降级说明（本地优先，未接在线服务）');
  const srcPre = w.children.find((n) => n.tagName === 'PRE');
  assert.equal(srcPre.getAttribute('data-md-keep'), '1', '源码块防二次包裹');
  assert.equal(srcPre.children[0].textContent, '@startuml\nA -> B\n@enduml', '源码完整保留');
  assert.ok(!head.children.some((n) => n.tagName === 'SCRIPT'), 'plantuml 不触发 mermaid 懒加载');
});

t('L3-6 幂等与缓存回填：已渲染不重跑；data-pending 重跑；data-md-keep 源码块不二次包裹', async () => {
  const stub = mermaidStub({});
  const { context } = mdRichContext({ mermaid: stub });
  const box = fakeContainer(fenceNode('mermaid', 'graph TD\nA-->B'));
  context.ATBMdRich.enhance(box, {});
  await flush();
  context.ATBMdRich.enhance(box, {});
  assert.equal(stub.calls.render.length, 1, '已渲染 SVG 再次 enhance 不重跑');

  box.children[0].setAttribute('data-pending', '1'); // 模拟 docCache 回填了「渲染中」占位
  context.ATBMdRich.enhance(box, {});
  await flush();
  assert.equal(stub.calls.render.length, 2, '待渲染容器重跑');
  assert.equal(box.children[0].getAttribute('data-pending'), null, '重跑后清除标记');

  const fail = mermaidStub({ reject: new Error('boom') });
  const c2 = mdRichContext({ mermaid: fail });
  const box2 = fakeContainer(fenceNode('mermaid', 'x'));
  c2.context.ATBMdRich.enhance(box2, {});
  await flush();
  c2.context.ATBMdRich.enhance(box2, {});
  assert.equal(countNodes(box2, (n) => String(n.attrs.class || '').includes('md-diagram-fallback')), 1, '回退块不嵌套二次包裹');
});

t('L3-7 健壮性：容器缺失 / 无 querySelectorAll / 普通代码块均不影响、不抛错', () => {
  const stub = mermaidStub({});
  const { context } = mdRichContext({ mermaid: stub });
  assert.doesNotThrow(() => context.ATBMdRich.enhance(null, {}));
  assert.doesNotThrow(() => context.ATBMdRich.enhance({}, {}));
  const pre = fenceNode('js', 'const a = 1;');
  const box = fakeContainer(pre);
  context.ATBMdRich.enhance(box, {});
  assert.equal(box.children[0], pre, '普通代码块保持 pre>code 形态');
});

/* ---------- L4 四宿主接入（源码契约） ---------- */

t('L4-1 build.js 审查对话框：同步滚动绑定后增强 .bld-review-preview，图片锚点 /api/fs/raw?path=…&project=当前项目', () => {
  assert.match(BUILD, /bindReviewSyncScroll\(reviewWrap\)/, '绑定调用点保留');
  assert.match(BUILD, /reviewWrap\.querySelectorAll\('\.bld-review-preview\.md'\)/, '审查预览容器纳入增强');
  assert.match(BUILD, /window\.ATBMdRich\?\.enhance\(el, \{ imgBase:/, '可选链调用（模块缺失静默跳过）');
  assert.match(BUILD, /\/api\/fs\/raw\?path=\$\{encodeURIComponent\(raw\)\}&project=\$\{encodeURIComponent\(state\.project\)\}/, '发布文档按被管理项目根解析');
});

t('L4-2 app.js File Board：md 渲染视图增强，图片按 md 文件所在目录解析（relFrom）', () => {
  assert.match(APP, /ATBMdRich\?\.enhance\(div, \{ imgBase:/, 'openFile 渲染视图增强（globalThis：vm 测试无 window 亦可静默跳过）');
  assert.match(APP, /ATBMdRich\.relFrom\(/, '锚点 = md 文件目录拼接');
  assert.match(APP, /\/api\/fs\/raw\?path=\$\{encodeURIComponent\(/, '走白名单图片端点');
});

t('L4-3 app.js 条目文档：loadDoc 与页签缓存回填两处增强；attachments 仍走 linkupDocImages（灯箱保留）', () => {
  assert.ok((APP.match(/ATBMdRich\?\.enhance\(view\)/g) || []).length >= 2, 'loadDoc + 缓存回填两处');
  assert.match(APP, /linkupDocImages\(view, state\.drawer\.id\)/, 'attachments 接管保留');
});

t('L4-4 req-disc.js / oncall.js：渲染后增强（图表 + 失败占位，无图片锚点改写）', () => {
  assert.ok((REQDISC.match(/ATBMdRich\?\.enhance\(/g) || []).length >= 2, '阅读器富文本块 + 纪要两处');
  assert.match(ONCALL, /linkupDiscImages\(wrap, d\.id\);[\s\S]{0,300}ATBMdRich\?\.enhance\(wrap\)/, '讨论详情渲染后增强');
});

t('L4-5 renderMd 零改动：四处逐字同口径（消毒 / 回退契约不变）', () => {
  const total = [BUILD, APP, REQDISC, ONCALL]
    .map((s) => (s.match(/function renderMd\(md\) \{/g) || []).length)
    .reduce((a, b) => a + b, 0);
  assert.equal(total, 4, '四处 renderMd(md) 签名保持');
  for (const [name, s] of [['build.js', BUILD], ['app.js', APP], ['req-disc.js', REQDISC], ['oncall.js', ONCALL]]) {
    assert.match(s, /return sanitizeHtml\(window\.marked\.parse\(md \|\| ''\)\);/, `${name} 渲染实现不变`);
    assert.match(s, /\.replace\(\/<script\[\\s\\S\]\*\?<\\\/script>\/gi, ''\)/, `${name} 消毒口径不变`);
  }
});

/* ---------- L5 样式 ---------- */

t('L5-1 图片宽度约束：.md / .rd-rich / .bld-review-preview 的 img max-width:100%', () => {
  assert.match(CSS, /\.md img, \.rd-rich img, \.bld-review-preview img \{\s*max-width: 100%;/, '宽度约束（.file-md img 先例口径）');
});

t('L5-2 图表容器样式：.md-mermaid（SVG 收敛 / 横向滚动）与回退块样式存在', () => {
  assert.match(CSS, /\.md-mermaid \{/, '图表容器');
  assert.match(CSS, /\.md-mermaid svg \{\s*max-width: 100%;/, 'SVG 宽度收敛');
  assert.match(CSS, /\.md-diagram-fallback/, '回退块样式');
});

/* ---------- L6 i18n ---------- */

t('L6-1 新增文案中英齐备：静态词条精确、◇ 动态插值命中并可回译', () => {
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  assert.equal(EN['正在渲染 Mermaid 图表…'], 'Rendering Mermaid diagram…');
  assert.equal(EN['⚠ Mermaid 渲染库加载失败（/mermaid.min.js）：已回退为源码展示'], '⚠ Failed to load the Mermaid renderer (/mermaid.min.js): fallen back to source below');
  assert.match(EN['PlantUML 图表暂不支持本地渲染：为保持「本地优先 · 无外部依赖」未接入在线渲染服务，以下为源码'], /^PlantUML diagrams cannot be rendered locally/);
  assert.ok('⚠ Mermaid 图表渲染失败（◇）：已回退为源码展示' in EN_DYNAMIC, '渲染失败动态词条');
  assert.ok('图片 ◇ 无法加载（不存在、越出项目根或超过 8MB 上限）' in EN_DYNAMIC, '改写型图片占位动态词条');
  assert.ok('图片 ◇ 加载失败（外链不可达、路径不存在或格式不受支持）' in EN_DYNAMIC, '外链图片占位动态词条');

  I.setLang('en');
  assert.equal(I.t('图片 a.png 无法加载（不存在、越出项目根或超过 8MB 上限）'), 'Image a.png failed to load (missing, outside the project root, or over the 8MB limit)');
  assert.equal(I.t('⚠ Mermaid 图表渲染失败（Parse boom）：已回退为源码展示'), '⚠ Mermaid diagram rendering failed (Parse boom): fallen back to source below');
  const en = I.t('图片 https://e/x.png 加载失败（外链不可达、路径不存在或格式不受支持）');
  I.setLang('zh');
  assert.equal(I.t(en), '图片 https://e/x.png 加载失败（外链不可达、路径不存在或格式不受支持）', '中英往返不变形');
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
