#!/usr/bin/env node
// REQ-20260910-016 排序菜单放到搜索框左侧 —— 定位控件组（排序 → 搜索）布局与交互契约
// （沿用 caption-toolbar-20260910-008.test.mjs 的 vm 模拟 DOM 模式）
// 覆盖 test-cases.md 用例 S1-S6：
//   S1 HTML 静态结构：#pageHead 内定位组（排序在搜索左侧）；#reqCaption 移除排序入口不留占位
//   S2 CSS 契约：定位组靠右、垂直居中、可换行可收缩；窄屏组独占整行且组内排序仍在搜索左侧
//   S3 显隐同步：仅需求模块且已初始化可见；切模块隐藏、切回恢复当前值；未初始化/无项目隐藏
//   S4 排序交互不回退：change 记忆偏好并重排；不清空搜索词、不改变状态筛选档
//   S5 搜索既有契约不回退：范围标签 / 清除按钮 / Esc 与 / 绑定保留；反馈条仍在 #pageHead 之后
//   S6 ui-demo.html 离线自包含且可操作（排序 / 搜索 / 清除 / 模块切换 / 四态）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
const itemDir = path.join(pluginRoot, 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-016');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const item = (id, status = 'done', extra = {}) => ({
  id, type: 'requirement', status, owner: null, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', disabled: false, checked: false, indeterminate: false,
    title: '', value: '', children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function makeStorage(seed = {}) {
  const store = { ...seed };
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
}

function setup({ storage = makeStorage() } = {}) {
  const document = element();
  document.createElement = element;
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} },
    localStorage: storage,
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [item('REQ-20990101-001'), item('REQ-20990101-002')] };
  return { sandbox, document, state, run, storage };
}

const hidden = (h, sel) => h.document.querySelector(sel).classList.contains('hidden');

// S1 静态结构：#pageHead 内定位组先排序后搜索；#reqCaption 无排序入口、无占位空洞
t('S1 静态结构：#pageHead 内 .locate-group 定位组承载 #reqSort 与搜索组且排序在 #searchInput 之前（Tab 顺序排序→搜索）；#reqSort 五选项 + aria-label「列表排序」+ 初始 hidden；#reqCaption 不再含 #reqSort 且其余控件与顺序保留', () => {
  const head = htmlSrc.match(/<section id="pageHead"[\s\S]*?<\/section>/);
  assert.ok(head, '应存在 #pageHead');
  const headSrc = head[0];
  // 定位组容器：排序与搜索同组相邻呈现，中间不插入批量操作
  const group = headSrc.match(/<div id="locateGroup"[^>]*class="[^"]*locate-group[^"]*"[^>]*>/);
  assert.ok(group, '#pageHead 应有定位组容器 #locateGroup.locate-group');
  const groupSrc = headSrc.match(/<div id="locateGroup"[\s\S]*?<\/div>\s*<\/section>/);
  assert.ok(groupSrc, '定位组应完整包含于 #pageHead');
  const grp = groupSrc[0];
  assert.ok(grp.includes('id="reqSort"'), '定位组应包含排序菜单 #reqSort');
  assert.ok(grp.includes('class="global-search module-search"'), '定位组应包含模块搜索组');
  assert.ok(grp.indexOf('id="reqSort"') < grp.indexOf('id="searchInput"'), '排序菜单应在搜索输入框之前（DOM = Tab 顺序）');
  // 组内不插入批量操作
  assert.doesNotMatch(grp, /selGroup|selectOperable|selectNone/, '定位组内不得混入批量操作控件');
  // 排序控件契约：五选项 + 可访问名称 + 初始 hidden（未初始化/无项目不出现可操作入口）
  const sortSel = htmlSrc.match(/<select id="reqSort"[\s\S]*?<\/select>/);
  assert.ok(sortSel, '#reqSort 控件保留');
  for (const [v, label] of [
    ['updated-desc', '最新更新'], ['updated-asc', '最早更新'],
    ['created-desc', '最新创建'], ['created-asc', '最早创建'], ['id-asc', '单号'],
  ]) assert.ok(sortSel[0].includes(`value="${v}"`) && sortSel[0].includes(`>${label}<`), `排序选项 ${label} 保留`);
  assert.match(sortSel[0], /aria-label="列表排序"/, '排序菜单可访问名称「列表排序」');
  assert.match(htmlSrc.match(/<select id="reqSort"[^>]*>/)[0], /class="[^"]*\bhidden\b[^"]*"/, '#reqSort 初始应 hidden');
  // 列表工具栏：排序入口移除、无占位残留，其余控件与顺序保留（全选等仍可用）
  const caption = htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="reqList"/);
  assert.ok(caption, '应存在列表头 #reqCaption');
  const cap = caption[0];
  assert.ok(!cap.includes('id="reqSort"'), '列表工具栏不得再含 #reqSort');
  const order = ['reqCount', 'selectOperable', 'selectNone', 'selGroup', 'laneQuickEntry'].map((id) => cap.indexOf(`id="${id}"`));
  assert.ok(order.every((i) => i !== -1), '工具栏应保留 reqCount/全选/全不选/右组/快捷入口');
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3] && order[3] < order[4], '工具栏顺序：reqCount → 全选 → 全不选 → 右组 → 快捷入口');
  assert.doesNotMatch(cap, /sort-placeholder|排序占位/, '不得遗留排序占位');
});

// S2 CSS 契约：定位组靠右、垂直居中、组内恒同一行可收缩（BUG-20260911-001 起极窄不再组内换行）；搜索组不再自带靠右；窄屏组独占整行、组内排序仍在搜索左侧
t('S2 CSS 契约：.locate-group flex + align-items:center + flex-wrap:nowrap（BUG-20260911-001：wrap 断行按 flex-basis 380px 打包致组宽 ≈<466px 时搜索组换行堆叠，故改 nowrap）+ min-width:0 + margin-left:auto 靠右；.page-head .module-search 不再 margin-left:auto；≤720px 定位组独占整行（flex:1 1 100%; margin-left:0）且 .module-search 组内伸缩（1 1 auto）非强制换行', () => {
  const grpRule = cssSrc.match(/\.page-head \.locate-group\s*\{[^}]*\}/);
  assert.ok(grpRule, '应有 .page-head .locate-group 规则');
  assert.match(grpRule[0], /display:\s*flex/, '定位组 flex 布局（排序与搜索相邻）');
  assert.match(grpRule[0], /align-items:\s*center/, '组内垂直居中');
  assert.match(grpRule[0], /flex-wrap:\s*nowrap/, '组内恒不换行（BUG-20260911-001 取代原 wrap 极窄口径；空间不足时整组随 .page-head wrap 下移，不裁切、不横向滚动）');
  assert.match(grpRule[0], /min-width:\s*0/, '定位组可收缩');
  assert.match(grpRule[0], /margin-left:\s*auto/, '宽屏定位组靠右（副标题保持左侧）');
  // 搜索组靠右职责移交定位组（hidden 排序时搜索组仍随组靠右，视觉与迁移前一致）
  const searchRule = cssSrc.match(/\.page-head \.module-search\s*\{[^}]*\}/);
  assert.ok(searchRule, '应有 .page-head .module-search 规则');
  assert.doesNotMatch(searchRule[0], /margin-left:\s*auto/, '搜索组不再自带 margin-left:auto（由定位组承载靠右）');
  // 窄屏：定位组独占整行；组内搜索可伸缩（非 1 1 100% 强制换行，排序仍在搜索左侧同行）
  const narrow = cssSrc.match(/@media \(max-width: 720px\) \{[\s\S]*?\n\}/);
  assert.ok(narrow, '应保留 ≤720px 窄屏适配');
  const narrowBlock = narrow[0];
  const grpNarrow = narrowBlock.match(/\.page-head \.locate-group\s*\{[^}]*\}/);
  assert.ok(grpNarrow, '窄屏应有 .page-head .locate-group 规则');
  assert.match(grpNarrow[0], /flex:\s*1 1 100%/, '窄屏定位组独占整行（副标题与定位组分行）');
  assert.match(grpNarrow[0], /margin-left:\s*0/, '窄屏定位组不再靠右顶格');
  const searchNarrow = narrowBlock.match(/\.page-head \.module-search\s*\{[^}]*\}/);
  assert.ok(searchNarrow, '窄屏应有 .page-head .module-search 规则');
  assert.match(searchNarrow[0], /min-width:\s*0/, '窄屏搜索组可收缩（搜索可伸缩）');
  assert.doesNotMatch(searchNarrow[0], /flex:\s*1 1 100%/, '搜索组不得强制整行（375px 组内排序仍在搜索左侧）');
});

// S3 显隐同步行为：需求模块且已初始化可见；其他模块隐藏；切回恢复当前排序；未初始化/无项目隐藏
t('S3 显隐同步：status+initialized 可见；切 oncall/files/runs 隐藏；切回 status 恢复且当前排序值保留；未初始化与无项目隐藏；setView 与 renderBoard 均调用同步函数（静态契约）', () => {
  // 静态契约：同步函数存在且被 setView / renderBoard 接入
  assert.match(source, /function syncReqSortVisibility\(\)/, '应有 syncReqSortVisibility 显隐同步函数');
  const setViewBody = source.match(/function setView\(v\) \{[\s\S]*?\n\}/);
  assert.ok(setViewBody, '应存在 setView');
  assert.match(setViewBody[0], /syncReqSortVisibility\(\)/, 'setView 需调用 syncReqSortVisibility（切模块隐藏/恢复需求排序）');
  const boardBody = source.match(/function renderBoard\(\) \{[\s\S]*?if \(!b\.initialized\) return;/);
  assert.ok(boardBody, '应存在 renderBoard 初始化早退段');
  assert.match(boardBody[0], /syncReqSortVisibility\(\)/, 'renderBoard 需在初始化早退前调用 syncReqSortVisibility（未初始化/无项目隐藏）');
  // 行为：status + initialized → 可见
  const h = setup();
  h.run("state.view = 'status'; syncReqSortVisibility();");
  assert.equal(hidden(h, '#reqSort'), false, '需求模块且已初始化：排序菜单可见');
  // 切其他模块 → 隐藏
  for (const v of ['oncall', 'runs', 'files', 'settings']) {
    h.state.view = v;
    h.run('syncReqSortVisibility();');
    assert.equal(hidden(h, '#reqSort'), true, `${v} 模块应隐藏需求排序菜单`);
  }
  // 切回需求：恢复显示且当前排序值保留（偏好不因移动控件丢失）
  h.state.view = 'status';
  h.run("state.reqSort = 'id-asc';");
  h.run('syncReqSortVisibility();');
  assert.equal(hidden(h, '#reqSort'), false, '切回需求模块恢复排序菜单');
  assert.equal(h.state.reqSort, 'id-asc', '隐藏期间排序偏好保留');
  // 未初始化 / 无项目：不出现可操作排序入口
  h.state.board = { initialized: false, noProject: false, items: [] };
  h.run('syncReqSortVisibility();');
  assert.equal(hidden(h, '#reqSort'), true, '未初始化项目：排序菜单隐藏');
  h.state.board = { initialized: false, noProject: true, items: [] };
  h.run('syncReqSortVisibility();');
  assert.equal(hidden(h, '#reqSort'), true, '无项目：排序菜单隐藏');
});

// S4 排序交互不回退：change 记忆偏好并触发重排；不清空搜索词、不改变状态筛选档
t('S4 交互不回退：change 更新 state.reqSort 并写入 localStorage、触发 renderBoard 重排；state.search.q 与 state.reqFilter 不变', () => {
  const h = setup({ storage: makeStorage() });
  // 挂接真实绑定片段（事件绑定区内 #reqSort 的 change 处理器原样执行）
  const bind = source.match(/const reqSortSel = \$\('#reqSort'\);[\s\S]*?\n\}/);
  assert.ok(bind, 'app.js 应保留 #reqSort change 绑定');
  h.run(bind[0]);
  const sel = h.document.querySelector('#reqSort');
  sel.value = 'id-asc';
  let rendered = 0;
  h.run('renderBoard = () => { globalThis.__rendered = (globalThis.__rendered || 0) + 1; };');
  h.state.view = 'status';
  h.state.reqFilter = 'done';
  h.state.search.q = 'REQ-20990101';
  sel.fire('change');
  assert.equal(h.state.reqSort, 'id-asc', 'change 后排序键更新');
  assert.equal(h.storage.store['atb.req.sort'], 'id-asc', '排序偏好写入 localStorage');
  assert.equal(h.sandbox.__rendered, 1, '切换排序触发列表重排');
  assert.equal(h.state.search.q, 'REQ-20990101', '切换排序不得清空搜索词');
  assert.equal(h.state.reqFilter, 'done', '切换排序不得改变状态筛选档');
  // 非法值回退默认（不因移动控件新增副作用）
  sel.value = 'bogus';
  sel.fire('change');
  assert.equal(h.state.reqSort, 'updated-desc', '非法值回退默认排序键');
});

// S5 搜索既有契约不回退：范围标签 / 清除按钮 / Esc 与 / 绑定保留；反馈条仍在 #pageHead 之后独立成条
t('S5 契约不回退：#searchScope / #searchClear / #searchInput 保留于定位组搜索组内；Esc 清空与 / 聚焦的绑定仍在；#searchFeedback 紧随 #pageHead 之后；不新增批量操作副作用', () => {
  const groupSrc = htmlSrc.match(/<div id="locateGroup"[\s\S]*?<\/div>\s*<\/section>/)[0];
  for (const id of ['searchScope', 'searchInput', 'searchClear']) {
    assert.ok(groupSrc.includes(`id="${id}"`), `定位组搜索组应保留 #${id}`);
  }
  assert.ok(groupSrc.includes('kbd-hint'), '快捷键提示 / 保留');
  // Esc 清空与 / 聚焦沿用现有行为：Esc 清空绑定于 bindSearchOnce（输入框级，不冒泡），
  // / 聚焦在 onGlobalKeydown（全局单键处理器）
  const bindFn = source.match(/function bindSearchOnce\(\) \{[\s\S]*?\n\}/);
  assert.ok(bindFn, '应存在 bindSearchOnce 搜索绑定函数');
  assert.match(bindFn[0], /Escape[\s\S]{0,120}clearSearch\(\)/, 'Esc 清空搜索入口保留');
  const keydown = source.match(/function onGlobalKeydown[\s\S]*?\n\}/);
  assert.ok(keydown, '应存在全局快捷键处理器');
  assert.match(keydown[0], /searchInput/, '/ 聚焦搜索入口保留');
  // 反馈条位置：紧随 #pageHead 之后（不混入定位组）
  const iHeadEnd = htmlSrc.indexOf('</section>', htmlSrc.indexOf('<section id="pageHead"'));
  const iFeed = htmlSrc.indexOf('<section id="searchFeedback"');
  assert.ok(iFeed > iHeadEnd, '#searchFeedback 应位于 #pageHead 之后');
  assert.ok(!groupSrc.includes('searchFeedback'), '搜索反馈不混入定位组');
});

// S6 ui-demo.html 离线自包含且可操作
t('S6 ui-demo 离线自包含：条目目录存在 ui-demo.html、README 有相对链接；无外链资源；含排序 / 搜索 / 清除 / 模块切换与 正常/空/加载/失败 四态', () => {
  const demoPath = path.join(itemDir, 'ui-demo.html');
  assert.ok(fs.existsSync(demoPath), '条目目录应存在 ui-demo.html');
  const demo = fs.readFileSync(demoPath, 'utf8');
  assert.doesNotMatch(demo, /<script[^>]*\ssrc=/i, '不得外链脚本');
  assert.doesNotMatch(demo, /<link[^>]*href=/i, '不得外链样式/资源');
  assert.doesNotMatch(demo, /@import/i, '不得 @import 外部样式');
  assert.doesNotMatch(demo, /url\(\s*['"]?https?:/i, '不得引用网络资源');
  for (const word of ['列表排序', '搜索', '清除搜索', '模块']) {
    assert.ok(demo.includes(word), `演示应包含「${word}」`);
  }
  for (const st of ['正常', '空', '加载', '失败']) {
    assert.ok(demo.includes(st), `演示应可切换「${st}」状态`);
  }
  const readme = fs.readFileSync(path.join(itemDir, 'README.md'), 'utf8');
  assert.match(readme, /\]\(\.\/ui-demo\.html\)/, 'README 需含 ./ui-demo.html 相对链接');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
