#!/usr/bin/env node
// REQ-20260910-012 app 版布局优化契约 —— 静态断言 index.html / style.css / app.js / oncall.js /
// electron/shell-css.mjs + vm 行为验证（renderBoard 不再向 #dataDir 写路径）。
// 三项布局改动：顶栏去路径行、模块页签上移顶栏、模块内子页签改内容区左缘纵向竖排栏。
// 用法：node scripts/tests/layout-topbar-rail-20260910-012.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(root, 'scripts', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const oncall = fs.readFileSync(path.join(webRoot, 'oncall.js'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'electron', 'shell-css.mjs'), 'utf8');
const demo = fs.readFileSync(
  path.join(root, 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-012', 'ui-demo.html'),
  'utf8',
);

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

// DOM 接缝：控件级 stub（req-filter-removed.test.mjs 同法）
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  seed('#board', element());
  seed('#reqList', element());
  seed('#dataDir', element());
  seed('#reqCount', element());
  seed('#emptyState', element());
  seed('#filterBar', element());
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(js.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; syncAcceptance = () => {}; syncImpl = () => {};');
  return { sandbox, document, state, run, seed };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 行为：有项目时 #dataDir 为空，无项目时仅简短引导且不含路径', () => {
  const h = setup();
  h.state.board = { initialized: true, projectRoot: '/p/a', dataDir: '/p/a/docs/agent-team-board', items: [] };
  h.state.listSig = '';
  h.run('renderBoard()');
  assert.equal(h.document.querySelector('#dataDir').textContent, '', '已初始化项目：顶栏路径行必须为空');
  h.state.board = { initialized: false, noProject: false, projectRoot: '/p/a', dataDir: null, items: [] };
  h.run('renderBoard()');
  assert.equal(h.document.querySelector('#dataDir').textContent, '', '未初始化项目：顶栏也不渲染「项目：<根>」路径行');
  h.state.board = { noProject: true, initialized: false, dataDir: null, projectRoot: null, items: [] };
  h.run('renderBoard()');
  const txt = h.document.querySelector('#dataDir').textContent;
  assert.match(txt, /管理项目/, '无项目时给「管理项目」引导');
  assert.doesNotMatch(txt, /\//, '引导文案不得包含路径');
});

t('T2 静态：空路径行不占位；完整路径承接位在「管理项目」弹窗', () => {
  assert.match(rule('.path:empty'), /display:\s*none/, '.path 空时应隐藏（顶栏不留路径占位）');
  // 承接位现状保留：管理项目弹窗项目列表逐行完整路径、可换行不截断（REQ-20260910-005）
  assert.match(js, /class="proj-path"/, '管理项目列表保留 .proj-path 路径行');
  assert.match(rule('.proj-path'), /overflow-wrap:\s*anywhere/, '路径可换行不被截断');
});

t('T3 静态：模块页签并入顶栏（brand 后、top-actions 前），独立第二行消失', () => {
  const iTop = html.indexOf('<header class="topbar"');
  const iBrand = html.indexOf('<div class="brand">');
  const iNav = html.indexOf('<nav class="module-nav"');
  const iActions = html.indexOf('<div class="top-actions">');
  const iHeadEnd = html.indexOf('</header>', iTop);
  const iPageHead = html.indexOf('<section id="pageHead"');
  assert.ok(iTop !== -1 && iNav !== -1, '应有 topbar / module-nav');
  assert.ok(iTop < iBrand && iBrand < iNav && iNav < iActions && iActions < iHeadEnd,
    '顶栏内顺序应为 brand → module-nav → top-actions');
  assert.ok(iHeadEnd < iPageHead, '顶栏结束后直接进入第三行（原第二行消失）');
  for (const [view, label] of [['status', '需求'], ['runs', '任务'], ['settings', '设置']]) {
    assert.match(html, new RegExp(`class="view-tab[^"]*" data-view="${view}"`), `「${label}」页签保留`);
  }
  // REQ-20260909-013：讨论 / 文件页签暂态隐藏（恢复步骤见条目 design.md）
  assert.doesNotMatch(html, /data-view="oncall"/, '「讨论」页签随 REQ-20260909-013 暂态隐藏');
  assert.doesNotMatch(html, /data-view="files"/, '「文件」页签随 REQ-20260909-013 暂态隐藏');
  // REQ-20260911-002：营销 / 发布页签暂态隐藏（恢复步骤见条目 design.md）
  assert.doesNotMatch(html, /data-view="marketing"/, '「营销」页签随 REQ-20260911-002 暂态隐藏');
  assert.doesNotMatch(html, /data-view="release"/, '「发布」页签随 REQ-20260911-002 暂态隐藏');
  assert.match(js, /querySelectorAll\('\.view-tab'\)/, 'app.js 仍按 .view-tab 绑定/同步激活态');
});

t('T4 静态：顶栏内导航无分隔线、可横滑不裁切，顶栏保持 nowrap', () => {
  const nav = rule('.module-nav');
  assert.doesNotMatch(nav, /border-bottom/, '顶栏内的页签组不再画分隔线（顶栏自带 border-bottom）');
  assert.match(nav, /overflow-x:\s*auto/, '窄窗口页签横滑不裁切');
  assert.match(rule('.topbar'), /flex-wrap:\s*nowrap/, '顶栏不换行（页签与操作区同排）');
});

t('T5 静态：需求六档筛选迁为 #reqView 左缘纵向竖排栏，chips 机制不变', () => {
  const iReqView = html.indexOf('<main id="reqView"');
  const iFilter = html.indexOf('id="filterBar"');
  const iEmpty = html.indexOf('id="emptyState"');
  assert.ok(iReqView !== -1 && iFilter !== -1, '应有 #reqView / #filterBar');
  assert.ok(iReqView < iFilter && iFilter < iEmpty, '#filterBar 应为 #reqView 内首子元素（左缘纵向栏）');
  const bar = rule('.filter-bar');
  assert.match(bar, /flex-direction:\s*column/, '纵向栏自上而下排列');
  assert.match(rule('.filter-bar .filter-chip'), /writing-mode:\s*vertical-rl/, '档文字竖直（从上到下）排布');
  assert.match(rule('.req-view'), /flex-direction:\s*row/, '需求工作区改行向（左纵向栏 + 右内容）');
  // chips 机制不变：六档、计数、事件委托（REQ_FILTERS 派生与委托绑定保留）
  assert.match(js, /const REQ_FILTERS = LANES\.map\(\(lane\) => \(\{ key: lane, label: LANE_LABEL\[lane\] \}\)\);/, '六档来源不变');
  assert.match(js, /\$\('#filterBar'\)\?\.addEventListener\('click'/, '点击事件委托保留');
});

t('T6 静态：讨论两态筛选同步纵向化；无子页签模块不渲染纵向栏', () => {
  const disc = rule('.disc-filters');
  assert.match(disc, /flex-direction:\s*column/, '讨论筛选纵向栏');
  assert.match(rule('.disc-filters .filter-chip'), /writing-mode:\s*vertical-rl/, '讨论档文字竖直排布');
  assert.match(rule('.disc-view'), /flex-direction:\s*row/, '讨论工作区行向（左纵向栏 + 右内容）');
  assert.match(oncall, /oncall-filters disc-filters/, 'oncall.js 筛选容器结构保留');
  // 无子页签模块：#filterBar 显隐仍由 setView/renderBar 的 showStatus 条件控制（仅需求模块显示）
  assert.match(js, /\$\('#filterBar'\)\?\.classList\.toggle\('hidden', !showStatus \|\| !b\?\.initialized\)/, 'setView 保留仅需求模块显示纵向栏');
  const runsView = html.slice(html.indexOf('<section id="runsView"'), html.indexOf('</section>', html.indexOf('<section id="runsView"')));
  assert.doesNotMatch(runsView, /filter-chip|filter-bar/, '任务模块无纵向栏');
  const fileView = html.slice(html.indexOf('<section id="fileView"'), html.indexOf('</section>', html.indexOf('<section id="fileView"')));
  assert.doesNotMatch(fileView, /filter-chip|filter-bar/, '文件模块无纵向栏');
  assert.doesNotMatch(html.slice(html.indexOf('<section id="settingsView"')), /filter-chip/, '设置模块无纵向栏');
});

t('T7 静态：Electron 壳层共存——交通灯让位与拖动区不因页签上移失效', () => {
  assert.match(shellCss, /\.topbar \{ padding-left: 78px !important; \}/, '交通灯让位保持');
  assert.match(shellCss, /\.topbar \.top-actions, \.topbar \.top-actions \* \{ -webkit-app-region: no-drag !important; \}/, '操作区 no-drag 豁免保持');
  assert.match(shellCss, /\.topbar \.module-nav, \.topbar \.module-nav \* \{ -webkit-app-region: no-drag !important; \}/,
    '页签区须 no-drag 豁免（drag 区会吞点击，页签以外的顶栏空白仍可拖动窗口）');
});

t('T8 静态：ui-demo.html 单文件、无外网依赖、覆盖新旧布局与四状态', () => {
  assert.ok(demo.length > 1000, '演示文件应实质存在');
  assert.doesNotMatch(demo, /src="https?:\/\/|href="https?:\/\//, '不得引用外网资源');
  assert.match(demo, /data-layout="old"/, '提供旧布局对照');
  assert.match(demo, /data-layout="new"/, '提供新布局');
  for (const s of ['正常', '空', '加载', '失败']) assert.ok(demo.includes(s), `覆盖「${s}」状态`);
  assert.match(demo, /管理项目/, '覆盖管理项目路径展示');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
