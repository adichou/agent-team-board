#!/usr/bin/env node
// REQ-20260923-003 md-rich mermaid 图表配色随看板深浅色外观自适应 —— 分层测试。
// L1 md-rich.js initialize 的 themeVariables 深浅两套（vm + 假 DOM + 桩 mermaid，参照
//    BUG-20260923-002 测试模式）：深色分支注入 sandbox.matchMedia = matches:true，
//    浅色分支用缺省沙箱（无 matchMedia → darkMode()=false）；
// L2 外观判定每次渲染时读取：同上下文翻转 matchMedia 结果后重渲染，两次 init 取值切换；
// L3 发布文档契约：根 README.md / DESIGN.md 移除全部 %%{init}%% 写死配色指令
//    （看板随外观自适应；GitHub 等外部渲染走 mermaid 默认主题）。
// 用法：node scripts/tests/req-20260923-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
const MD_RICH_SRC = fs.readFileSync(new URL('../web/md-rich.js', import.meta.url), 'utf8');
const README = fs.readFileSync(new URL('README.md', ROOT), 'utf8');
const DESIGN = fs.readFileSync(new URL('DESIGN.md', ROOT), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- 假 DOM（仅覆盖 md-rich 用到的窄接口，同 BUG-20260923-002） ---------- */

function fakeNode(tag, attrs = {}) {
  const n = {
    tagName: String(tag).toUpperCase(),
    attrs: { ...attrs },
    children: [],
    parentElement: null,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, v) { this.attrs[name] = String(v); },
    removeAttribute(name) { delete this.attrs[name]; },
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

function matchSelector(node, sel) {
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

function fenceNode(lang, src) {
  const code = fakeNode('code', { class: `language-${lang}` });
  code.textContent = src;
  const pre = fakeNode('pre');
  pre.appendChild(code);
  return pre;
}

// matchMedia 注入形态：{ dark } 可变状态驱动每次渲染时的外观判定；省略 matchMedia 即浅色缺省
function mdRichContext({ mermaid, matchMedia } = {}) {
  const fakeDoc = {
    head: fakeNode('head'),
    body: fakeNode('body'),
    createElement: (tag) => fakeNode(tag),
    querySelectorAll: () => [],
  };
  const sandbox = {
    console, Promise, Error, String, Object, RegExp, Math, JSON, Number, Array,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    document: fakeDoc,
  };
  if (mermaid !== undefined) sandbox.mermaid = mermaid;
  if (matchMedia !== undefined) sandbox.matchMedia = matchMedia;
  const context = vm.createContext(sandbox);
  vm.runInContext(MD_RICH_SRC, context);
  return { context, sandbox };
}

function mermaidStub() {
  const calls = { init: [], render: [] };
  return {
    calls,
    initialize(cfg) { calls.init.push(cfg); },
    render(id, src) { calls.render.push([id, src]); return Promise.resolve({ svg: '<svg>OK</svg>' }); },
  };
}

/* ---------- L1 themeVariables 深浅两套 ---------- */

t('L1-1 深色套：matchMedia matches:true → theme=dark，themeVariables 取深色档（亮字 / 靛蓝边框 / 透明底）', async () => {
  const stub = mermaidStub();
  const { context } = mdRichContext({ mermaid: stub, matchMedia: () => ({ matches: true }) });
  const box = fakeContainer(fenceNode('mermaid', 'graph TD\nA-->B'));
  context.ATBMdRich.enhance(box, {});
  await flush();
  assert.equal(stub.calls.init.length, 1, '渲染时 initialize');
  const cfg = stub.calls.init[0];
  assert.equal(cfg.theme, 'dark', '深色主题');
  assert.ok(cfg.themeVariables && typeof cfg.themeVariables === 'object', 'initialize 带 themeVariables');
  assert.equal(cfg.themeVariables.primaryTextColor, '#d1d5db', '深色文字亮档');
  assert.equal(cfg.themeVariables.primaryBorderColor, '#a5b4fc', '深色边框亮档（靛蓝系）');
  assert.equal(cfg.themeVariables.primaryColor, 'transparent', '节点透明底（无底色要求）');
});

t('L1-2 浅色套：缺省沙箱（无 matchMedia）→ theme=default，themeVariables 取浅色档', async () => {
  const stub = mermaidStub();
  const { context } = mdRichContext({ mermaid: stub });
  const box = fakeContainer(fenceNode('mermaid', 'graph TD\nA-->B'));
  context.ATBMdRich.enhance(box, {});
  await flush();
  const cfg = stub.calls.init[0];
  assert.equal(cfg.theme, 'default', '浅色主题');
  assert.ok(cfg.themeVariables && typeof cfg.themeVariables === 'object', 'initialize 带 themeVariables');
  assert.equal(cfg.themeVariables.primaryTextColor, '#475569', '浅色文字深档');
  assert.equal(cfg.themeVariables.primaryBorderColor, '#818cf8', '浅色边框深档（靛蓝系）');
  assert.equal(cfg.themeVariables.primaryColor, 'transparent', '节点透明底');
});

t('L1-3 两套全量对照：透明项共有；连线 / 子图描边 / 标题按外观分档', async () => {
  const dark = mermaidStub();
  const cDark = mdRichContext({ mermaid: dark, matchMedia: () => ({ matches: true }) });
  cDark.context.ATBMdRich.enhance(fakeContainer(fenceNode('mermaid', 'x')), {});
  const light = mermaidStub();
  const cLight = mdRichContext({ mermaid: light });
  cLight.context.ATBMdRich.enhance(fakeContainer(fenceNode('mermaid', 'x')), {});
  await flush();
  const dv = dark.calls.init[0].themeVariables;
  const lv = light.calls.init[0].themeVariables;
  assert.equal(dv.clusterBkg, 'transparent', '深色子图底透明');
  assert.equal(lv.clusterBkg, 'transparent', '浅色子图底透明');
  assert.equal(dv.edgeLabelBackground, 'transparent', '深色连线标签底透明');
  assert.equal(lv.edgeLabelBackground, 'transparent', '浅色连线标签底透明');
  assert.equal(dv.lineColor, '#94a3b8', '深色连线亮档');
  assert.equal(lv.lineColor, '#9ca3af', '浅色连线灰档');
  assert.equal(dv.clusterBorder, '#374151', '深色子图描边');
  assert.equal(lv.clusterBorder, '#e2e8f0', '浅色子图描边');
  assert.equal(dv.titleColor, '#e5e7eb', '深色标题亮档');
  assert.equal(lv.titleColor, '#334155', '浅色标题深档');
});

/* ---------- L2 外观判定每次渲染时读取 ---------- */

t('L2-1 外观判定每次渲染时读取：同上下文翻转 matchMedia 后重渲染，两次 initialize 取值切换', async () => {
  const state = { dark: true };
  const stub = mermaidStub();
  const { context } = mdRichContext({ mermaid: stub, matchMedia: () => ({ matches: state.dark }) });
  const box = fakeContainer(fenceNode('mermaid', 'graph TD\nA-->B'));
  context.ATBMdRich.enhance(box, {});
  await flush();
  assert.equal(stub.calls.init[0].theme, 'dark', '首渲深色');
  assert.equal(stub.calls.init[0].themeVariables.primaryTextColor, '#d1d5db', '首渲深色套');

  state.dark = false; // 系统切到浅色，重渲染走 docCache 回填路径（data-pending 复挂）
  box.children[0].setAttribute('data-pending', '1');
  context.ATBMdRich.enhance(box, {});
  await flush();
  assert.equal(stub.calls.init.length, 2, '重渲染再次 initialize');
  assert.equal(stub.calls.init[1].theme, 'default', '重渲浅色（渲染时现读外观，非初始化缓存）');
  assert.equal(stub.calls.init[1].themeVariables.primaryTextColor, '#475569', '重渲浅色套');
});

/* ---------- L3 发布文档契约 ---------- */

t('L3-1 发布文档无写死配色：根 README.md / DESIGN.md 不含 %%{init}%% 指令（外部渲染走 mermaid 默认主题）', () => {
  assert.doesNotMatch(README, /%%\{init/, 'README.md 移除全部写死配色指令');
  assert.doesNotMatch(DESIGN, /%%\{init/, 'DESIGN.md 移除全部写死配色指令');
  assert.match(README, /```mermaid/, 'README.md 保留 mermaid 围栏（图本体不删）');
  assert.match(DESIGN, /```mermaid/, 'DESIGN.md 保留 mermaid 围栏');
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
