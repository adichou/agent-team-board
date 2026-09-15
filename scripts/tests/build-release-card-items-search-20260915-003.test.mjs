#!/usr/bin/env node
// REQ-20260915-003 构建模块布局调整——产品发布入口迁入左侧版本卡片按钮区、
// 「关联条目与 commit」联合列表支持搜索与分页、「＋ 新建版本」上移至页签工具行右端。
// R1~R10 vm 行为 + 纯函数 + 静态契约（假 DOM 口径同 build-ui.test.mjs）。
// 用法：node scripts/tests/build-release-card-items-search-20260915-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 假 DOM（口径同 build-ui.test.mjs） ---------- */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
  };
}

const H = (c) => c.repeat(40);
const H1 = H('a');
const H2 = H('b');
const H3 = H('c');

// 多条目版本：12 条（REQ-……-01 ~ 12），标题轮换，commit 各异
function manyItems(n = 12) {
  return Array.from({ length: n }, (_, i) => ({
    itemId: `REQ-20260915-0${String(i + 1).padStart(2, '0')}`,
    title: ['改进构建布局', '优化搜索反馈', '修复版本选择'][i % 3] + ` ${i + 1}`,
    commit: [H1, H2, H3][i % 3].slice(0, 39) + String(i % 10),
    mergedAt: null, mergeError: null,
  }));
}

function ver(id, name, status = 'merged', items = manyItems()) {
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main',
    items,
    createdAt: '2026-09-15T01:00:00.000Z', updatedAt: '2026-09-15T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
  };
}

function setup({ versions = [ver('BLD-20260915-001', 'v1.0', 'merged'), ver('BLD-20260915-002', 'v2.0', 'draft')] } = {}) {
  const live = { versions: JSON.parse(JSON.stringify(versions)) };
  const state = () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: live.versions });
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state())) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return {
    sandbox, live,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    el: (sel) => vm.runInContext(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`, sandbox),
    enter: async () => vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox),
  };
}

/* ---------- R1 发布按钮迁入版本卡片 ---------- */

t('R1 每张版本卡片按钮区含「创建发布」「查看发布记录」（未选中卡片也有）；详情不再渲染产品发布操作区', async () => {
  const h = setup();
  await h.enter(); // 自动选中首个 BLD-20260915-001（merged）
  const inner = h.inner();
  for (const id of ['BLD-20260915-001', 'BLD-20260915-002']) {
    assert.match(inner, new RegExp(`data-ver-release="${id}"`), `${id} 卡片应有创建发布按钮`);
    assert.match(inner, new RegExp(`data-ver-release-view="${id}"`), `${id} 卡片应有查看发布记录按钮`);
    assert.match(inner, new RegExp(`aria-label="创建发布 ${id}"`), '创建发布 aria-label 带版本号');
    assert.match(inner, new RegExp(`aria-label="查看发布记录 ${id}"`), '查看发布记录 aria-label 带版本号');
  }
  // 按钮在卡片 card-acts 区内，与既有操作集中展示（AI 完善 → 合并 → 创建发布 → 查看发布记录 → 删除）
  const card2 = inner.slice(inner.indexOf('data-ver-id="BLD-20260915-002"'), inner.indexOf('关联条目与 commit'));
  const acts = card2.slice(card2.indexOf('card-acts'));
  const order = ['data-ver-answer', 'data-ver-merge', 'data-ver-release=', 'data-ver-release-view', 'data-ver-delete']
    .map((k) => acts.indexOf(k));
  assert.ok(order.every((i) => i !== -1) && order.every((i, idx) => idx === 0 || i > order[idx - 1]),
    `卡片按钮顺序应为 AI 完善 → 合并 → 创建发布 → 查看发布记录 → 删除：${order}`);
  // 详情不再渲染产品发布操作区（原 bld-release-block 移除，按钮模板不在 renderDetail 内）
  const detail = inner.slice(inner.indexOf('rel-detail'));
  assert.doesNotMatch(detail, /bld-release-block/, '详情不渲染产品发布操作区');
  assert.doesNotMatch(detail, /从已合并版本发起跨仓库产品发布/, '详情底部产品发布说明移除');
});

t('R2 状态口径逐卡 + 按卡片版本绑定：draft/merging/failed 创建发布禁用（title 含「请先完成合并入 main」）；merged 可用；未选中卡片的创建发布打开所在卡片版本弹层；查看记录派发跨模块跳转事件', async () => {
  const h = setup({ versions: [
    ver('BLD-DRAFT', 'd', 'draft'),
    ver('BLD-MERGING', 'g', 'merging'),
    ver('BLD-MERGED', 'm', 'merged'),
    ver('BLD-FAILED', 'f', 'failed'),
  ] });
  await h.enter(); // 选中首个 BLD-DRAFT（merged 卡片处于未选中态）
  const inner = h.inner();
  const mergedBtn = inner.match(/data-ver-release="BLD-MERGED"[^>]*/);
  assert.ok(mergedBtn && !/disabled/.test(mergedBtn[0]), 'merged 创建发布可用（无 disabled）');
  for (const id of ['BLD-DRAFT', 'BLD-MERGING', 'BLD-FAILED']) {
    const btn = inner.match(new RegExp(`data-ver-release="${id}"[^>]*`));
    assert.ok(btn && /disabled/.test(btn[0]), `${id} 创建发布禁用`);
    assert.ok(btn && btn[0].includes('请先完成合并入 main'), `${id} 禁用 title 说明「请先完成合并入 main」`);
  }
  // 未合并直调兜底：不弹窗（按钮已禁用，直调路径同样拦截）
  h.run(`window.ATBBuild.openReleaseConfirm('BLD-DRAFT')`);
  assert.doesNotMatch(h.inner(), /创建产品发布（/, '未合并版本不打开弹层（兜底口径保留）');
  // 未选中卡片（BLD-MERGED）的创建发布打开所在卡片版本的弹层，不受右侧选中态（BLD-DRAFT）影响
  h.run(`window.ATBBuild.openReleaseConfirm('BLD-MERGED')`);
  const rcInner = h.inner();
  assert.match(rcInner, /创建产品发布（BLD-MERGED）/, 'merged 打开既有核对弹层（目标为所在卡片版本）');
  assert.doesNotMatch(rcInner, /创建产品发布（BLD-DRAFT）/, '不误用右侧选中版本');
  assert.match(rcInner, /rel-card sel" data-ver-id="BLD-DRAFT"/, '选中态保持不变');
  // BUG-20260915-014：查看发布记录不再派发 atb:goto-view（旧跳转命中 HIDDEN_VIEWS 回落，
  // 即缺陷根因）——改为就地激活所在卡片版本的详情发布页签
  const fired = [];
  h.sandbox.window.dispatchEvent = (e) => { fired.push(e); };
  h.run(`window.ATBBuild.openReleaseTab('BLD-MERGED')`);
  const relInner = h.inner();
  assert.ok(!fired.some((e) => e.type === 'atb:goto-view'), '不再派发跨模块跳转事件');
  assert.match(relInner, /rel-card sel" data-ver-id="BLD-MERGED"/, '查看发布记录切换到所在卡片版本');
  assert.match(relInner, /data-detail-tab="release"[^>]*aria-selected="true"/, '就地激活发布页签');
  assert.match(relInner, /bld-rel-pane/, '发布区就地渲染');
  // 卡片按钮静态契约：bindCommon 循环绑定 data-ver-release / data-ver-release-view
  assert.match(buildJs, /view\.querySelectorAll\('\[data-ver-release\]'\)/, 'bindCommon 循环绑定 data-ver-release');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-ver-release-view\]'\)/, 'bindCommon 循环绑定 data-ver-release-view');
});

/* ---------- R3 新建版本上移页签工具行 ---------- */

t('R3 「＋ 新建版本」与两页签同一工具行右端：无独立 bld-toolbar；分支浏览页不出现新建入口；点击仍打开新建面板', async () => {
  const h = setup();
  await h.enter();
  let inner = h.inner();
  assert.doesNotMatch(inner, /bld-toolbar/, '不再有独立工具栏');
  assert.match(inner, /id="bldNewBtn"/, '版本计划页有新建版本按钮');
  // 与页签同一行：bldNewBtn 在 rel-tabs/bld-tabs 容器内、位于两页签之后、工具容器右端
  const nav = inner.match(/<nav class="rel-tabs bld-tabs"[^>]*>[\s\S]*?<\/nav>/);
  assert.ok(nav, '存在页签导航容器');
  assert.match(nav[0], /data-bld-tab="versions"/, '页签容器含版本计划');
  assert.match(nav[0], /data-bld-tab="branches"/, '页签容器含分支浏览');
  assert.match(nav[0], /bld-tabs-tools[^>]*>\s*<button[^>]*id="bldNewBtn"/, '新建按钮在页签行工具容器右端');
  const iV = nav[0].indexOf('data-bld-tab="versions"');
  const iB = nav[0].indexOf('data-bld-tab="branches"');
  const iNew = nav[0].indexOf('id="bldNewBtn"');
  assert.ok(iV !== -1 && iB !== -1 && iNew !== -1 && iV < iB && iB < iNew, '页签靠左、新建按钮在右端');
  // 点击打开既有新建面板
  h.run(`window.ATBBuild.openCreatePanel()`);
  assert.match(h.inner(), /aria-label="新建版本"/, '点击新建版本打开既有侧拉面板');
  // 分支浏览页：不出现新建入口（维持既有可用范围）
  await h.run(`window.ATBBuild.setTab('branches')`);
  inner = h.inner();
  assert.doesNotMatch(inner, /id="bldNewBtn"/, '分支浏览页不出现新建版本入口');
  assert.match(inner, /data-bld-tab="versions"/, '分支页仍可切回版本计划');
});

/* ---------- R4 纯函数：联合行搜索 ---------- */

t('R4 filterVersionItems：覆盖条目 ID / 标题 / 完整与短 commit；忽略大小写与首尾空白；保持原顺序；字段边界不串配', () => {
  const h = setup();
  const items = manyItems(6);
  // JSON 往返拍平 vm 跨 realm 数组（严格 deepEqual 校验原型，见 build-ui N7c 同法）
  const f = (q) => JSON.parse(JSON.stringify(h.run(`window.ATBBuild.filterVersionItems(${JSON.stringify(items)}, ${JSON.stringify(q)})`)));
  // 条目 ID
  assert.equal(f('REQ-20260915-001').length, 1, '按条目 ID 命中');
  // 标题
  assert.equal(f('优化搜索反馈').length, 2, '按标题命中（保持原顺序）');
  assert.deepEqual(f('优化搜索反馈').map((x) => x.itemId), ['REQ-20260915-002', 'REQ-20260915-005'], '命中保持原顺序');
  // 完整与短 commit 哈希
  assert.equal(f(H1.slice(0, 39) + '0').length, 1, '按完整 commit 哈希命中');
  assert.ok(f(H2.slice(0, 8)).length >= 1, '按短 commit 哈希命中（完整哈希包含匹配覆盖）');
  // 大小写不敏感 + 首尾空白
  assert.equal(f('  req-20260915-001  ').length, 1, '首尾空白与英文大小写不影响命中');
  // 空关键词 = 全量（原数组引用，不复制）
  assert.equal(f('').length, 6, '空关键词返回全量');
  assert.equal(f('   ').length, 6, '纯空白关键词等同全量');
  // 字段边界不串配：标题结尾 + commit 开头拼出的假词不命中
  const edge = items[0].title.slice(-2) + items[0].commit.slice(0, 2);
  assert.equal(f(edge).length, 0, '跨字段拼接不误命中');
  // 无命中返回空数组
  assert.equal(f('zzz-not-exist').length, 0, '无命中返回空');
});

/* ---------- R5 纯函数 + 渲染：分页 ---------- */

t('R5 paginateItems：切片与计数准确；页码越界回落最后有效页；零结果不产生虚假页数', () => {
  const h = setup();
  const p = (n, page, size = 10) => JSON.parse(JSON.stringify(h.run(`window.ATBBuild.paginateItems(Array.from({length: ${n}}, (_, i) => i), ${page}, ${size})`)));
  let r = p(12, 1);
  assert.equal(r.total, 12); assert.equal(r.pages, 2); assert.equal(r.page, 1);
  assert.deepEqual(r.rows, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], '第一页切片');
  r = p(12, 2);
  assert.equal(r.page, 2); assert.deepEqual(r.rows, [10, 11], '末页切片');
  r = p(12, 99);
  assert.equal(r.page, 2, '越界页码回落最后有效页');
  r = p(12, 0);
  assert.equal(r.page, 1, '非法页码回落第一页');
  r = p(0, 1);
  assert.equal(r.total, 0); assert.equal(r.pages, 0, '零结果不产生虚假页数'); assert.deepEqual(r.rows, [], '零结果无数据行');
  r = p(5, 1);
  assert.equal(r.pages, 1, '不足一页时不翻页');
});

t('R5b 渲染层分页与翻页行为：默认页大小分片；首末页禁用；上一页/下一页翻页；搜索回第一页；清空恢复；切换版本清空搜索并回第一页', async () => {
  const h = setup();
  await h.enter(); // 选中 BLD-20260915-001（merged，12 条）
  const inner = () => h.inner();
  // 头部行：标题 → 搜索输入/按钮（/清空）→ 添加条目（用计数行作头部行结束锚点）
  const iHead = inner().indexOf('bld-items-head');
  const iCount = inner().indexOf('bld-items-count');
  assert.ok(iHead !== -1 && iCount > iHead, '关联列表头部行渲染');
  const head = inner().slice(iHead, iCount);
  assert.match(head, /<strong>关联条目与 commit<\/strong>/, '标题保留');
  assert.match(head, /id="bldItemsSearchInput"/, '搜索输入框在标题右侧');
  assert.match(head, /id="bldItemsSearchGo"/, '搜索按钮');
  assert.match(head, /id="bldAddItem"/, '既有添加条目入口保留');
  const iTitle = head.indexOf('<strong>');
  const iInput = head.indexOf('id="bldItemsSearchInput"');
  const iAdd = head.indexOf('id="bldAddItem"');
  assert.ok(iTitle !== -1 && iTitle < iInput && iInput < iAdd, '标题 → 搜索 → 添加条目 依次排列');
  // 分页条：12 条 → 2 页；第 1 页上一页禁用、下一页可用；计数行显示总数
  assert.match(inner(), /共 12 条/, '计数显示总条目数');
  assert.match(inner(), /第 1 \/ 2 页/, '页码与总页数');
  assert.match(inner(), /data-items-pg="prev" disabled/, '首页上一页禁用');
  assert.match(inner(), /data-items-pg="next"[^>]*>下一页/, '下一页可用');
  assert.ok(!/data-items-pg="next" disabled/.test(inner()), '非末页下一页不禁用');
  // 翻到第 2 页：只渲染第 2 页数据行（第 11/12 条），上一页恢复可用
  h.run(`window.ATBBuild.gotoItemsPage(2)`);
  assert.match(inner(), /第 2 \/ 2 页/, '翻到第 2 页');
  assert.match(inner(), /REQ-20260915-012/, '第 2 页含第 12 条');
  assert.doesNotMatch(inner(), /REQ-20260915-001</, '第 2 页不含第 1 页数据行');
  assert.match(inner(), /data-items-pg="prev"[^>]*>上一页/, '第 2 页上一页可用');
  assert.match(inner(), /data-items-pg="next" disabled/, '末页下一页禁用');
  // DOM 翻页按钮同路径：绑定存在性由 R10 静态契约覆盖
  h.run(`window.ATBBuild.gotoItemsPage(1)`);
  // 搜索：命中跨页数据回第一页；计数区分匹配数与总数（12 条中标题「优化搜索反馈」命中 4 条）
  const input = h.el('#bldItemsSearchInput');
  input.value = '优化搜索反馈';
  input.listeners.input();
  h.el('#bldItemsSearchGo').listeners.click();
  assert.match(inner(), /匹配 4 \/ 共 12 条/, '搜索计数「匹配 4 / 共 12 条」');
  assert.match(inner(), /第 1 \/ 1 页/, '命中不足一页时单页');
  assert.match(inner(), /REQ-20260915-002[\s\S]*REQ-20260915-005[\s\S]*REQ-20260915-008[\s\S]*REQ-20260915-011/, '命中保持原顺序');
  assert.match(inner(), /data-items-search-clear/, '有关键词时头部出现清空入口');
  // 清空：恢复全量第一页（行为经行为接缝直调；DOM 循环绑定见 R10 静态契约）
  h.run(`window.ATBBuild.clearItemsSearch()`);
  assert.match(inner(), /共 12 条/, '清空恢复全量');
  assert.match(inner(), /第 1 \/ 2 页/, '清空回第一页');
  assert.ok(!/data-items-search-clear/.test(inner()), '清空后清空入口消失');
  // 切换版本：清空搜索并回第一页（经真实卡片点击路径：.rel-list 点击 → selectVersion → 重渲染）
  input.value = 'REQ-20260915-012';
  input.listeners.input();
  h.el('#bldItemsSearchGo').listeners.click();
  assert.match(inner(), /匹配 1 \/ 共 12 条/, '按单号搜索命中 1 条');
  h.el('.rel-list').listeners.click({ target: { closest: (s) => (s === '[data-ver-id]' ? { dataset: { verId: 'BLD-20260915-002' } } : null) } });
  assert.match(inner(), /第 1 \/ 2 页/, '切换版本回第一页（v2.0 也是 12 条）');
  assert.ok(!/data-items-search-clear/.test(inner()), '切换版本清空搜索');
  assert.doesNotMatch(inner(), /value="REQ-20260915-012"/, '切换版本清空搜索框草稿');
  assert.match(inner(), /rel-card sel" data-ver-id="BLD-20260915-002"/, '切换后选中态更新');
});

/* ---------- R6 空态区分 ---------- */

t('R6 空态区分：零关联显示添加引导；无匹配显示关键词与清空入口；两种空态互斥且零结果不出分页条', async () => {
  // 零关联（1 条空版本）
  const h0 = setup({ versions: [ver('BLD-EMPTY', 'e', 'draft', [])] });
  await h0.enter();
  const inner0 = h0.inner();
  assert.match(inner0, /暂无条目：点「＋ 添加条目」纳入需求单 \/ Bug 单/, '零关联显示添加引导');
  assert.doesNotMatch(inner0, /没有匹配的关联条目/, '零关联不出搜索无结果文案');
  assert.doesNotMatch(inner0, /bld-items-pager/, '零关联不出分页条');
  assert.doesNotMatch(inner0, /匹配 0 \/ 共 0 条/, '零关联不出搜索计数');
  // 有数据但无匹配
  const h = setup();
  await h.enter();
  const input = h.el('#bldItemsSearchInput');
  input.value = 'zzz-not-exist';
  input.listeners.input();
  h.el('#bldItemsSearchGo').listeners.click();
  const inner = h.inner();
  assert.match(inner, /没有匹配的关联条目（关键词：zzz-not-exist）/, '无匹配显示关键词');
  assert.match(inner, /data-items-search-clear/, '无匹配提供清空入口');
  assert.match(inner, /匹配 0 \/ 共 12 条/, '无匹配显示 0 条计数（不伪装成空数据）');
  assert.doesNotMatch(inner, /暂无条目：点「＋ 添加条目」/, '无匹配不出现零关联引导');
  assert.doesNotMatch(inner, /bld-items-pager/, '零结果不出可翻页的分页条');
  // 清空恢复（行为接缝直调；DOM 循环绑定见 R10 静态契约）
  h.run(`window.ATBBuild.clearItemsSearch()`);
  assert.match(h.inner(), /第 1 \/ 2 页/, '清空后恢复可翻页列表');
});

/* ---------- R7 加载与读取失败 ---------- */

t('R7 加载显示提示不出数据操作；读取失败显示失败与重试、重试成功恢复渲染（模块级状态机，列表数据与版本同源）', async () => {
  // 加载中：fetch 挂起，视图停留在 loading（无任何数据操作入口）
  const hL = setup();
  let release;
  hL.sandbox.fetch = (url) => new Promise((res) => {
    if (String(url).includes('/api/build/state')) { release = () => res({ ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: [] }) }); return; }
    res({ ok: true, json: async () => ({}) });
  });
  const pending = hL.run(`window.ATBBuild.enter('/p/a')`);
  const loading = hL.inner();
  assert.match(loading, /加载构建模块…/, '加载提示');
  assert.doesNotMatch(loading, /bldItemsSearchInput|data-remove-item|bldAddItem/, '加载中不出数据操作入口（不伪装为空数据）');
  release();
  await pending;
  // 读取失败：error 态 + 重试按钮；无数据操作入口
  const hE = setup();
  hE.sandbox.fetch = async (url) => {
    if (String(url).includes('/api/build/state')) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
    return { ok: true, json: async () => ({}) };
  };
  await hE.run(`window.ATBBuild.enter('/p/a')`);
  const errView = hE.inner();
  assert.match(errView, /构建模块读取失败：boom/, '失败提示带原因');
  assert.match(errView, /id="bldRetryLoad"/, '失败提供重试按钮');
  assert.doesNotMatch(errView, /bldItemsSearchInput|暂无条目/, '失败不伪装为空数据');
  // 重试成功恢复
  hE.sandbox.fetch = async () => ({ ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: [ver('BLD-20260915-001', 'v1.0', 'merged')] }) });
  await hE.run(`window.ATBBuild.refresh()`);
  assert.match(hE.inner(), /data-ver-release="BLD-20260915-001"/, '重试成功恢复版本渲染');
  assert.match(hE.inner(), /id="bldItemsSearchInput"/, '重试成功恢复列表与搜索入口');
});

/* ---------- R8 行内操作绑定与锁定回归 ---------- */

t('R8 过滤/翻页后移出与 commit 换选绑定真实条目 ID；merging/merged 锁定不回归；数据减少后越界页回落最后有效页', async () => {
  const h = setup({ versions: [ver('BLD-20260915-001', 'v1.0', 'merged', manyItems(12))] });
  await h.enter();
  // 搜索过滤到 2 条 → 行内按钮 data-remove-item 为命中的真实条目
  const input = h.el('#bldItemsSearchInput');
  input.value = '优化搜索反馈';
  input.listeners.input();
  h.el('#bldItemsSearchGo').listeners.click();
  let inner = h.inner();
  assert.match(inner, /data-remove-item="REQ-20260915-002"/, '过滤后移出按钮绑定命中条目');
  assert.match(inner, /data-commit-item="REQ-20260915-005"/, '过滤后 commit 换选绑定命中条目');
  assert.doesNotMatch(inner, /data-remove-item="REQ-20260915-001"/, '未命中条目不出现在当前页行内操作');
  // merged 锁定：移出 / commit 换选 / 添加条目禁用（搜索与翻页不绕过锁定）
  assert.match(inner, /data-remove-item="REQ-20260915-002" disabled/, 'merged 移出禁用');
  assert.match(inner, /data-commit-item="REQ-20260915-002" disabled/, 'merged commit 换选禁用');
  assert.match(inner, /id="bldAddItem" disabled/, 'merged 添加条目禁用');
  // merging 同口径
  const h2 = setup({ versions: [ver('BLD-MERGING', 'g', 'merging', manyItems(3))] });
  await h2.enter();
  const inner2 = h2.inner();
  assert.match(inner2, /data-remove-item="REQ-20260915-001" disabled title="合并中\/已合并状态锁定条目增删"/, 'merging 移出禁用提示保留');
  // 数据减少：12 条第 2 页 → 移出 2 条变 10 条后回写回落第 1 页
  const h3 = setup({ versions: [ver('BLD-20260915-001', 'v1.0', 'draft', manyItems(12))] });
  await h3.enter();
  h3.run(`window.ATBBuild.gotoItemsPage(2)`);
  assert.match(h3.inner(), /第 2 \/ 2 页/, '先到第 2 页');
  h3.live.versions[0].items = h3.live.versions[0].items.slice(0, 10); // 模拟移出 2 条后 refresh 返回
  await h3.run(`window.ATBBuild.refresh()`);
  assert.match(h3.inner(), /第 1 \/ 1 页/, '数据减少导致当前页失效回落最后有效页');
  assert.match(h3.inner(), /共 10 条/, '计数随数据减少更新');
});

/* ---------- R9 i18n ---------- */

t('R9 i18n：新增静态文案入 EN、动态文案入 EN_DYNAMIC（值无中文、不与受检键值重复）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['清空', '上一页', '下一页', '搜单号 / 标题 / commit…', '创建发布', '查看发布记录']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  for (const k of ['匹配 ◇ / 共 ◇ 条', '第 ◇ / ◇ 页', '没有匹配的关联条目（关键词：◇）']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
  // 受检键值唯一性不回归（'清除'→Clear 不得再出现同值键）
  const values = Object.values(EN);
  for (const k of ['清除', '搜索', '删除', '确认删除']) {
    assert.equal(values.filter((v) => v === EN[k]).length, 1, `EN 值唯一（无重复）：${k}`);
  }
});

/* ---------- R10 静态契约 ---------- */

t('R10 静态契约：搜索/清空/分页绑定与样式类存在；发布按钮迁出详情（renderDetail 无 data-ver-release）', () => {
  assert.match(buildJs, /#bldItemsSearchInput/, 'bindCommon 绑定搜索输入框（草稿回写 + 回车提交）');
  assert.match(buildJs, /#bldItemsSearchGo/, 'bindCommon 绑定搜索按钮');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-items-search-clear\]'\)/, 'bindCommon 循环绑定清空入口');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-items-pg\]'\)/, 'bindCommon 循环绑定分页按钮');
  // 详情渲染函数不再含发布按钮模板（发布入口在 renderVersionList 内）
  const detailFn = buildJs.match(/function renderDetail\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(detailFn, '缺少 renderDetail');
  assert.doesNotMatch(detailFn[0], /data-ver-release/, 'renderDetail 不再渲染发布按钮');
  const listFn = buildJs.match(/function renderVersionList\(\) \{[\s\S]*?\n  \}/);
  assert.ok(listFn, '缺少 renderVersionList');
  assert.match(listFn[0], /data-ver-release/, 'renderVersionList 渲染发布按钮');
  assert.doesNotMatch(buildJs, /bld-toolbar/, '独立工具栏容器移除');
  const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  assert.match(css, /\.bld-tabs-tools/, 'style.css 含页签行工具容器样式');
  assert.match(css, /\.bld-items-search/, 'style.css 含搜索控件样式');
  assert.match(css, /\.bld-items-count/, 'style.css 含计数行样式');
  assert.match(css, /\.bld-items-pager/, 'style.css 含分页条样式');
  assert.doesNotMatch(css, /\.bld-toolbar/, '独立工具栏样式移除');
  assert.match(css, /\.bld-items-head \{[^}]*flex-wrap: wrap/, '列表头部行允许换行（窄屏不溢出）');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
