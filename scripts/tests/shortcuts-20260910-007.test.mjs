#!/usr/bin/env node
// REQ-20260910-007 支持快捷键 —— vm 行为测试 + 静态契约（参照 refresh-restore-20260910-001 的
// vm 全量加载 app.js 模式与 global-search-ui.test.mjs 的静态断言风格）。
// 行为组（K3–K8）：派发合成 keydown 到 document 级监听，断言聚焦 / 帮助开关 / 焦点圈定 /
// 方向键守卫 / Esc 分层 / 零业务请求；静态组（K1/K2/K9/K10）断言 index.html / style.css / app.js。
// 用法：node scripts/tests/shortcuts-20260910-007.test.mjs
// K11（ui-demo.html 离线人工验收）不在自动化范围。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = new URL('../web/', import.meta.url);
const app = fs.readFileSync(new URL('app.js', webRoot), 'utf8');
const bannerJs = fs.readFileSync(new URL('banner.js', webRoot), 'utf8');
const html = fs.readFileSync(new URL('index.html', webRoot), 'utf8');
const css = fs.readFileSync(new URL('style.css', webRoot), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const item = (id, extra = {}) => ({
  id, type: id.startsWith('BUG') ? 'bug' : 'requirement', status: 'done', title: `标题 ${id}`,
  docs: ['README.md', 'design.md', 'test-cases.md'],
  createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z', ...extra,
});

function defaultBoard() {
  return {
    initialized: true, projectRoot: '/project/a', dataDir: '/project/a/docs/agent-team-board',
    items: [
      item('REQ-20990101-001'), item('REQ-20990101-003'), item('REQ-20990101-005'),
      item('BUG-20990101-002', { status: 'submitted' }),
    ],
  };
}

// DOM 接缝：与 index.html 初始态一致；focus 记录到共享 focusState（document.activeElement）。
const focusState = { active: null };
function element(tag = 'DIV') {
  const nodes = new Map();
  const classes = new Set();
  const el = {
    tagName: tag, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false,
    checked: false, children: [], listeners: {}, isConnected: true, focusCount: 0,
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => (on ? classes.add(v) : classes.delete(v)),
    },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    removeEventListener() {},
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    closest: () => null,
    focus() { focusState.active = this; this.focusCount++; },
    blur() { if (focusState.active === this) focusState.active = null; },
  };
  return el;
}

// index.html 初始 hidden 的容器（REQ-20260910-007 起 #shortcutHelpWrap 同列；
// BUG-20260910-004 起全局总览为右侧面板 #globalPanel，不再是主视图 #globalView；
// REQ-20260910-017 起新建截图预览层 #shotPreview 同列——Esc 链会检查其开合；
// REQ-20260911-001 起待接受编辑侧拉面板 #editModalWrap 同列）
const INITIALLY_HIDDEN = [
  '#reqView', '#board', '#emptyState', '#filterBar', '#docHits', '#fileView', '#oncallView',
  '#oncallLightbox', '#runsView', '#globalPanel', '#settingsView', '#modalWrap', '#projModalWrap',
  '#shortcutHelpWrap', '#mask', '#shotPreview', '#editModalWrap',,
  '#holdPanel',
];

function setup({ board = defaultBoard() } = {}) {
  const document = element('HTML');
  document.createElement = element;
  Object.defineProperty(document, 'activeElement', { get: () => focusState.active });
  // 动态弹层（uiConfirm 的 .confirm-wrap）：默认不存在，安装即「有弹窗」
  const dynamicOverlays = new Map();
  const baseQs = document.querySelector;
  document.querySelector = (sel) => {
    if (sel === '.confirm-wrap') return dynamicOverlays.get(sel) || null;
    return baseQs.call(document, sel);
  };
  for (const sel of INITIALLY_HIDDEN) document.querySelector(sel).classList.add('hidden');
  const requests = [];
  const sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sandbox = {
    document, URLSearchParams, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage,
    addEventListener() {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    marked: { parse: (s) => String(s || '') },
    hljs: { highlightElement() {} },
    fetch: async (url) => {
      const u = String(url);
      const up = new URL(u, 'http://local');
      requests.push(u);
      if (u.includes('/api/health')) return { ok: true, json: async () => ({ projects: ['/project/a'], defaultProject: '/project/a' }) };
      if (u.includes('/api/board')) return { ok: true, json: async () => JSON.parse(JSON.stringify(board)) };
      if (u.includes('/api/dispatch/pending')) return { ok: true, json: async () => ({ count: 0, items: [] }) };
      if (u.includes('/api/search')) return { ok: true, json: async () => ({ items: [], docs: [], files: [] }) };
      if (up.pathname === '/api/fs') return { ok: true, json: async () => ({ entries: [] }) };
      if (up.pathname === '/api/fs/file') return { ok: true, json: async () => ({ content: '# 内容', path: '' }) };
      if (up.pathname.startsWith('/api/item/')) {
        const id = decodeURIComponent(up.pathname.split('/api/item/')[1]);
        const it = board.items.find((x) => x.id === id);
        if (it) return { ok: true, json: async () => JSON.parse(JSON.stringify(it)) };
        return { ok: false, status: 404, json: async () => ({ error: '条目不存在' }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bannerJs, sandbox, { filename: 'banner.js' });
  vm.runInContext(app, sandbox, { filename: 'app.js' }); // 模块求值即 boot()
  const run = (code) => vm.runInContext(code, sandbox);
  const dom = (sel) => document.querySelector(sel);
  // 合成 keydown：派发到 document 级监听（app.js 全页唯一注册点）
  const key = (over = {}) => {
    const ev = {
      key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      repeat: false, isComposing: false, defaultPrevented: false,
      target: element('BODY'),
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...over,
    };
    const fn = document.listeners.keydown;
    assert.ok(typeof fn === 'function', 'document 级 keydown 监听应已注册');
    return fn(ev);
  };
  const openDrawerAt = async (id, navIds) => {
    await run(`(async () => {
      state.drawer = { id: ${JSON.stringify(id)}, item: null, doc: null, navIds: ${JSON.stringify(navIds)},
        deps: null, depsFetched: false, depFilter: '', tab: 'info', docCache: {} };
      await refreshDrawer();
    })()`);
  };
  return { sandbox, document, run, dom, requests, key, focusState, dynamicOverlays, openDrawerAt };
}

async function waitUntil(fn, ms = 2000, what = '条件') {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`等待超时：${what}`);
}

async function waitBoot(h) {
  await waitUntil(() => h.run('state.board !== null'), 2000, 'boot() 写入看板数据');
  await new Promise((r) => setTimeout(r, 30));
}

const HELP_VISIBLE = (h) => !h.dom('#shortcutHelpWrap').classList.contains('hidden');

/* ---------- 静态契约：K1 / K2 / K9 / K10 ---------- */

t('K1 顶栏帮助入口与搜索键位提示：#btnShortcuts type=button；.global-search 内 kbd 提示 /', () => {
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/);
  assert.ok(topbar, '未找到顶栏');
  assert.match(topbar[1], /<button id="btnShortcuts" class="btn" type="button"/, '顶栏应有快捷键帮助按钮且可键盘访问');
  assert.match(topbar[1], /快捷键 \?/, '按钮文案「快捷键 ?」');
  const search = html.match(/<div class="global-search module-search"[\s\S]*?<\/div>/);
  assert.ok(search, '未找到搜索容器');
  assert.match(search[0], /<kbd[^>]*aria-hidden="true"[^>]*>\/<\/kbd>/, '搜索容器内应有 / 键位提示 kbd');
  assert.doesNotMatch(search[0], /id="searchInput"[^>]*\/?>\s*<\/input/, '提示不侵占输入框结构');
});

t('K2 帮助面板结构：role=dialog + aria-modal；五组键位 / ? ←→ Esc Tab 与生效条件、输入态限制、关闭按钮', () => {
  const panel = html.match(/<div id="shortcutHelpWrap"[\s\S]*?<\/div>\s*<\/div>(?=\s*<div id="toast")/);
  assert.ok(panel, '未找到 #shortcutHelpWrap 帮助面板');
  const p = panel[0];
  assert.match(p, /role="dialog"/, '面板应为 dialog 角色');
  assert.match(p, /aria-modal="true"/, '面板应声明 aria-modal');
  assert.match(p, /id="shortcutHelpClose"/, '应有常驻关闭按钮');
  assert.match(p, /aria-label="关闭快捷键帮助"/, '关闭按钮应有可访问名称');
  for (const k of ['/', '?', '←', '→', 'Esc', 'Tab']) assert.ok(p.includes(k), `帮助应包含键位 ${k}`);
  assert.match(p, /生效条件/, '帮助应列出「操作 / 按键 / 生效条件」三列');
  assert.match(p, /输入法|组合输入|contenteditable/, '帮助应说明输入态不触发');
  assert.match(p, /Ctrl|⌘|Alt/, '帮助应说明修饰组合键保留默认行为');
  // 单实例：页面只有一个帮助面板容器
  assert.equal((html.match(/id="shortcutHelpWrap"/g) || []).length, 1, '帮助面板节点应唯一');
});

t('K9 样式：.kbd-hint 键帽；帮助面板 max-height + overflow 可滚动、头部 sticky 关闭始终可达；按钮 :focus-visible', () => {
  assert.match(css, /\.kbd-hint\s*\{/, '应有 .kbd-hint 键帽样式');
  assert.match(css, /\.shortcut-help\s*\{[^}]*max-height:/, '帮助面板应限高可滚动');
  assert.match(css, /\.shortcut-help\s*\{[^}]*overflow:\s*auto/, '帮助面板内容应可滚动');
  assert.match(css, /\.shortcut-help \.modal-head\s*\{[^}]*position:\s*sticky/, '头部应 sticky（关闭按钮滚动中始终可达）');
  assert.match(css, /btn:focus-visible/, '按钮应有键盘焦点样式');
});

t('K10 抽屉导航按钮标注方向键：title 边界提示 + 快捷键说明；aria-keyshortcuts 声明', () => {
  const fn = app.match(/function drawerNavBtn[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 drawerNavBtn');
  assert.match(fn[0], /已是第一条/, '首条边界提示保留');
  assert.match(fn[0], /已是最后一条/, '末条边界提示保留');
  assert.match(fn[0], /aria-keyshortcuts/, '应声明 aria-keyshortcuts');
  assert.match(fn[0], /ArrowLeft/, '上一条应声明 ArrowLeft');
  assert.match(fn[0], /ArrowRight/, '下一条应声明 ArrowRight');
});

t('K8a 唯一注册点与零业务动作：document 级 keydown 仅注册一次；处理器内无 api / 批次启动调用', () => {
  assert.equal((app.match(/document\.addEventListener\('keydown'/g) || []).length, 1, 'document 级 keydown 应只注册一次');
  const fn = app.match(/function onGlobalKeydown[\s\S]*?\n\}/);
  assert.ok(fn, '应存在具名 onGlobalKeydown 处理器');
  assert.doesNotMatch(fn[0], /api\(|fetch\(|startBatch|gotoRuns|deleteReq|acceptItems|moveToPlan/, '处理器不得直接执行状态变更或批次启动');
  assert.match(fn[0], /e\.repeat/, '应忽略长按重复事件');
  assert.match(fn[0], /isComposing/, '应忽略组合输入');
  assert.match(fn[0], /ctrlKey|metaKey|altKey/, '修饰组合键应放行');
});

/* ---------- 行为组：K3–K8 ---------- */

t('K3 `/` 聚焦当前模块搜索框；输入态 / 组合输入 / 弹窗 / 搜索隐藏时不触发也不吞字符', async () => {
  const h = setup();
  await waitBoot(h);
  // 正常路径：preventDefault + 聚焦 #searchInput
  h.key({ key: '/' });
  assert.equal(h.focusState.active, h.dom('#searchInput'), '`/` 应聚焦搜索框');
  assert.equal(h.dom('#searchInput').focusCount, 1, '单次按键只聚焦一次');
  // 输入态让位：焦点已在输入框 / 文本域 / contenteditable / 下拉 → 不聚焦（字符照常上屏）
  for (const target of [
    { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    const before = h.dom('#searchInput').focusCount;
    h.key({ key: '/', target });
    assert.equal(h.dom('#searchInput').focusCount, before, `输入态（${target.tagName}${target.isContentEditable ? '+contenteditable' : ''}）不应触发聚焦`);
  }
  // 组合输入（中文输入法）期间不触发
  const before2 = h.dom('#searchInput').focusCount;
  h.key({ key: '/', isComposing: true });
  assert.equal(h.dom('#searchInput').focusCount, before2, '组合输入期间不应触发');
  // 弹窗开启不触发
  for (const open of [
    () => h.dom('#modalWrap').classList.remove('hidden'),
    () => h.dom('#projModalWrap').classList.remove('hidden'),
    () => h.dynamicOverlays.set('.confirm-wrap', element('DIV')),
  ]) {
    open();
    const before3 = h.dom('#searchInput').focusCount;
    h.key({ key: '/' });
    assert.equal(h.dom('#searchInput').focusCount, before3, '弹窗开启时 `/` 不应聚焦');
    h.dom('#modalWrap').classList.add('hidden');
    h.dom('#projModalWrap').classList.add('hidden');
    h.dynamicOverlays.delete('.confirm-wrap');
  }
  // 设置模块隐藏搜索（搜索入口不可用）不触发
  h.dom('#pageHead .module-search').classList.add('hidden');
  const before4 = h.dom('#searchInput').focusCount;
  h.key({ key: '/' });
  assert.equal(h.dom('#searchInput').focusCount, before4, '搜索入口隐藏（设置模块）时 `/` 不应聚焦');
  h.dom('#pageHead .module-search').classList.remove('hidden');
  // 修饰组合键不拦截
  const before5 = h.dom('#searchInput').focusCount;
  h.key({ key: '/', ctrlKey: true });
  assert.equal(h.dom('#searchInput').focusCount, before5, 'Ctrl+/ 应保留浏览器默认行为');
});

t('K4 `?` 打开帮助：焦点进入面板、重复按键不重开；关闭恢复入口焦点，入口失效回落帮助按钮；修饰键不触发', async () => {
  const h = setup();
  await waitBoot(h);
  // 打开：面板可见 + 焦点进入关闭按钮
  h.key({ key: '?' });
  assert.ok(HELP_VISIBLE(h), '`?` 应打开帮助面板');
  assert.equal(h.focusState.active, h.dom('#shortcutHelpClose'), '焦点应进入帮助面板');
  assert.equal(h.dom('#shortcutHelpClose').focusCount, 1, '首次打开聚焦一次');
  // 重复按键不叠加：面板不重建、不重复聚焦
  h.key({ key: '?' });
  assert.ok(HELP_VISIBLE(h), '重复 `?` 面板保持打开');
  assert.equal(h.dom('#shortcutHelpClose').focusCount, 1, '重复 `?` 不应再次聚焦（不叠加面板）');
  // Esc 关闭 + 恢复打开前焦点（入口 = 顶栏帮助按钮）
  h.key({ key: 'Escape' }); // 先关闭当前面板（opener 为空 → 回落帮助按钮）
  assert.ok(!HELP_VISIBLE(h), 'Esc 应关闭帮助');
  h.dom('#btnShortcuts').focus(); // 以帮助按钮为入口重新打开
  h.key({ key: '?' });
  h.key({ key: 'Escape' });
  assert.ok(!HELP_VISIBLE(h), 'Esc 应关闭帮助');
  assert.equal(h.focusState.active, h.dom('#btnShortcuts'), '关闭应恢复打开前焦点（帮助按钮）');
  // 入口失效（opener 已脱离 DOM）→ 回落帮助按钮
  const ghost = element('BUTTON');
  ghost.focus();
  ghost.isConnected = false;
  h.key({ key: '?' });
  assert.ok(HELP_VISIBLE(h), '再次打开帮助');
  const btnCount = h.dom('#btnShortcuts').focusCount;
  h.key({ key: 'Escape' });
  assert.equal(h.focusState.active, h.dom('#btnShortcuts'), '入口失效应回落帮助按钮');
  assert.equal(h.dom('#btnShortcuts').focusCount, btnCount + 1, '回落应实际聚焦帮助按钮');
  // 修饰组合键 / 输入态 / 弹窗开启不触发
  h.key({ key: '?', metaKey: true });
  assert.ok(!HELP_VISIBLE(h), 'Meta+? 不应打开帮助');
  h.key({ key: '?', target: { tagName: 'INPUT' } });
  assert.ok(!HELP_VISIBLE(h), '输入态 `?` 不应打开帮助');
  h.dom('#modalWrap').classList.remove('hidden');
  h.key({ key: '?' });
  assert.ok(!HELP_VISIBLE(h), '弹窗开启时 `?` 不应打开帮助');
});

t('K5 Tab / Shift+Tab 圈定：首末回绕、Shift 反向、面板中间不拦截、面板外焦点拉回', async () => {
  const h = setup();
  await waitBoot(h);
  h.key({ key: '?' });
  assert.ok(HELP_VISIBLE(h), '前置：帮助已打开');
  // 安装面板内可聚焦元素（首 / 中 / 末）
  const first = element('BUTTON'), mid = element('BUTTON'), last = element('BUTTON');
  h.dom('#shortcutHelpWrap').querySelectorAll = () => [first, mid, last];
  // 末元素 Tab → 回绕首元素
  last.focus();
  const ev = { key: 'Tab', shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  h.document.listeners.keydown(ev);
  assert.ok(ev.defaultPrevented, '末元素 Tab 应被圈定拦截');
  assert.equal(h.focusState.active, first, '末元素 Tab 应回绕首元素');
  // 首元素 Shift+Tab → 回绕末元素
  h.key({ key: 'Tab', shiftKey: true });
  assert.equal(h.focusState.active, last, '首元素 Shift+Tab 应回绕末元素');
  // 面板中间元素 Tab → 不拦截（原生在面板内继续）
  mid.focus();
  const midCount = mid.focusCount;
  h.key({ key: 'Tab' });
  assert.equal(h.focusState.active, mid, '中间元素 Tab 不移动焦点（由原生接续）');
  assert.equal(mid.focusCount, midCount, '不应被圈定逻辑改焦点');
  // 面板外焦点 Tab → 拉回面板内首个元素
  const outside = element('BODY');
  outside.focus();
  h.key({ key: 'Tab' });
  assert.equal(h.focusState.active, first, '面板外焦点应被拉回面板内');
});

t('K6 `←/→` 守卫：正常路径沿用冻结范围、边界停止；弹窗 / repeat / IME / 修饰键不切换', async () => {
  const h = setup();
  await waitBoot(h);
  await h.openDrawerAt('REQ-20990101-001', ['REQ-20990101-001', 'REQ-20990101-003', 'REQ-20990101-005']);
  // 正常路径：→ 切到冻结范围下一条
  h.key({ key: 'ArrowRight' });
  await waitUntil(() => h.run("state.drawer.id === 'REQ-20990101-003'"), 2000, '→ 应切到下一条');
  // 边界停止：首条 ← 不动
  await h.openDrawerAt('REQ-20990101-001', ['REQ-20990101-001', 'REQ-20990101-003', 'REQ-20990101-005']);
  h.key({ key: 'ArrowLeft' });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(h.run('state.drawer.id'), 'REQ-20990101-001', '首条再按 ← 应停止（不循环）');
  // 守卫：输入态 / 组合输入 / repeat / 修饰键 / 各弹窗 → 不切换
  await h.openDrawerAt('REQ-20990101-001', ['REQ-20990101-001', 'REQ-20990101-003', 'REQ-20990101-005']);
  const guards = [
    { label: '输入态', over: { target: { tagName: 'INPUT' } } },
    { label: 'contenteditable', over: { target: { tagName: 'DIV', isContentEditable: true } } },
    { label: '组合输入', over: { isComposing: true } },
    { label: '长按重复', over: { repeat: true } },
    { label: 'Ctrl 组合键', over: { ctrlKey: true } },
  ];
  for (const g of guards) {
    h.key({ key: 'ArrowRight', ...g.over });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.run('state.drawer.id'), 'REQ-20990101-001', `${g.label}时 → 不应切换详情`);
  }
  for (const open of [
    { label: '新建弹窗', act: () => h.dom('#modalWrap').classList.remove('hidden'), undo: () => h.dom('#modalWrap').classList.add('hidden') },
    { label: '项目管理弹窗', act: () => h.dom('#projModalWrap').classList.remove('hidden'), undo: () => h.dom('#projModalWrap').classList.add('hidden') },
    { label: '确认弹层', act: () => h.dynamicOverlays.set('.confirm-wrap', element('DIV')), undo: () => h.dynamicOverlays.delete('.confirm-wrap') },
  ]) {
    open.act();
    h.key({ key: 'ArrowRight' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.run('state.drawer.id'), 'REQ-20990101-001', `${open.label}开启时 → 不应切换详情`);
    open.undo();
  }
  // 帮助开启期间方向键也不切换，Esc 只关帮助
  h.key({ key: '?' });
  h.key({ key: 'ArrowRight' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.run('state.drawer.id'), 'REQ-20990101-001', '帮助开启时 → 不应切换详情');
  h.key({ key: 'Escape' });
  assert.ok(!HELP_VISIBLE(h), 'Esc 只关帮助');
  assert.equal(h.run('state.drawer.id'), 'REQ-20990101-001', '关帮助不应连带关抽屉');
});

t('K7 Esc 分层一次关一层：帮助 > 项目管理 > 新建 > 抽屉', async () => {
  const h = setup();
  await waitBoot(h);
  await h.openDrawerAt('REQ-20990101-001', ['REQ-20990101-001', 'REQ-20990101-003']);
  h.key({ key: '?' }); // 帮助仅在无弹窗时可开（契约）；叠层以下为程序模拟验证关闭优先级
  h.dom('#projModalWrap').classList.remove('hidden');
  h.dom('#modalWrap').classList.remove('hidden');
  assert.ok(HELP_VISIBLE(h), '前置：帮助在最上层');
  h.key({ key: 'Escape' });
  assert.ok(!HELP_VISIBLE(h), '第一次 Esc 只关帮助');
  assert.ok(!h.dom('#projModalWrap').classList.contains('hidden'), '项目管理保持打开');
  h.key({ key: 'Escape' });
  assert.ok(h.dom('#projModalWrap').classList.contains('hidden'), '第二次 Esc 关项目管理');
  assert.ok(!h.dom('#modalWrap').classList.contains('hidden'), '新建弹窗保持打开');
  h.key({ key: 'Escape' });
  assert.ok(h.dom('#modalWrap').classList.contains('hidden'), '第三次 Esc 关新建弹窗');
  assert.equal(h.run('state.drawer.id'), 'REQ-20990101-001', '抽屉保持打开');
  h.key({ key: 'Escape' });
  assert.equal(h.run('state.drawer.id'), null, '第四次 Esc 关抽屉');
  // 长按 Esc 不连发多层：首次按下关当层，repeat 事件不穿透下一层
  await h.openDrawerAt('REQ-20990101-001', ['REQ-20990101-001']);
  h.dom('#modalWrap').classList.remove('hidden');
  h.key({ key: 'Escape' }); // 首次按下：关新建弹窗
  h.key({ key: 'Escape', repeat: true }); // 按住产生的重复事件：不应连带关抽屉
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(h.dom('#modalWrap').classList.contains('hidden'), '首次 Esc 关当层（新建弹窗）');
  assert.equal(h.run('state.drawer.id'), 'REQ-20990101-001', 'repeat Esc 不穿透下一层');
});

t('K8b 快捷键路径零业务请求：`/ ? Esc` 与 Tab 圈定不产生任何网络请求', async () => {
  const h = setup();
  await waitBoot(h);
  await waitUntil(() => h.requests.some((u) => u.includes('/api/board')), 2000, 'boot 完成基线');
  const before = h.requests.length;
  h.key({ key: '/' });
  h.key({ key: '?' });
  h.key({ key: 'Tab' });
  h.key({ key: 'Escape' });
  h.key({ key: 'Escape' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.requests.length, before, '快捷键路径不应产生业务请求');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
