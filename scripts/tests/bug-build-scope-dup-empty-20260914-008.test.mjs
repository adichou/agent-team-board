#!/usr/bin/env node
// BUG-20260914-008 新建版本 / 添加条目面板空态口径重复：同一候选口径在单个面板内只出现一次。
// 引入来源：BUG-20260913-001（提交 87a2fca 在空态正文中新增口径句，而面板头部副标题本就
// 承载同一口径——空态分支从此口径出现两次；BUG-20260914-004 仅加 totalDone 分支未消除重复）。
// 修复口径（README「期望行为 / 验收说明」）：
//   - 「无 done 条目」空态正文精简为「暂无可纳入版本的条目」，不再整段复述口径；
//     口径保留在面板头部副标题（新建 / 添加两面板现有文案不动）；
//   - 两面板（新建版本 / 添加条目）一并修复：口径关键词「仅已完成（done）」在面板 HTML 中
//     恰好出现一次；
//   - 不回归 BUG-20260914-004 空态区分：totalDone>0 时仍显示「已完成的条目均已纳入版本计划…」，
//     缺 totalDone 字段回落「无 done 条目」分支；
//   - 不回归正常候选态：头部口径 + 候选列表 / 全选条照常，口径同样单次。
// 用法：node scripts/tests/bug-build-scope-dup-empty-20260914-008.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 前端 vm 脚手架（与 BUG-20260913-001 / BUG-20260914-004 测试同款） ---------- */

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

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

const SCOPE_RE = /仅已完成（done）/g; // 口径关键词：头部副标题与旧空态正文都含
const countOf = (s, re) => (s.match(re) || []).length;
const panelOf = (inner, label) => {
  const m = inner.match(new RegExp(`<aside class="rel-panel"[^>]*aria-label="${label}">[\\s\\S]*?</aside>`));
  return m && m[0];
};

function setup({ candidates = { items: [], totalDone: 0 }, versions = [] } = {}) {
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
      if (up.pathname === '/api/build/state') {
        return { ok: true, json: async () => JSON.parse(JSON.stringify({
          initialized: true, isRepo: true, currentBranch: 'dev', versions,
        })) };
      }
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => JSON.parse(JSON.stringify(candidates)) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

const ver = (id, items) => ({
  id, name: id, description: '', status: 'draft', targetBranch: 'main', items,
  createdAt: '2026-09-14T01:00:00.000Z', updatedAt: '2026-09-14T02:00:00.000Z',
  merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
});
const verItem = (itemId, title) => ({ itemId, commit: H1, title, mergedAt: null, mergeError: null });

/* ---------- 用例 ---------- */

t('F1 新建版本面板空态（无 done 条目）：口径只出现一次（头部），空态正文精简不复述口径', async () => {
  const h = setup(); // candidates: { items: [], totalDone: 0 }
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const panel = panelOf(inner, '新建版本');
  assert.ok(panel, '新建版本面板应渲染');
  assert.equal(countOf(panel, SCOPE_RE), 1, '口径关键词「仅已完成（done）」在面板内恰好出现一次（头部副标题）');
  assert.match(panel, /class="side-panel-scope"[^>]*>[^<]*仅已完成（done）/u, '口径保留在头部副标题');
  assert.match(panel, /暂无可纳入版本的条目/, '空态正文保留简短空态提示');
  assert.doesNotMatch(panel, /会出现在候选中/, '空态正文不再整段复述口径');
  assert.doesNotMatch(panel, /id="bldPickAll"/, '空态不渲染「全选」');
});

t('F2 添加条目面板空态（无 done 条目）：口径只出现一次（头部），空态正文精简', async () => {
  // 一个空版本用于打开「添加条目」面板；候选接口无 done 条目
  const h = setup({ versions: [ver('BLD-20260914-001', [])] });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('versions')`);
  await h.run(`window.ATBBuild.openAddPanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const panel = panelOf(inner, '添加条目');
  assert.ok(panel, '添加条目面板应渲染');
  assert.equal(countOf(panel, SCOPE_RE), 1, '口径关键词在面板内恰好出现一次（头部副标题）');
  assert.match(panel, /class="side-panel-scope"[^>]*>[^<]*仅已完成（done）/u, '口径保留在头部副标题');
  assert.match(panel, /暂无可纳入版本的条目/, '空态正文保留简短空态提示');
  assert.doesNotMatch(panel, /会出现在候选中/, '空态正文不再整段复述口径');
});

t('F3 回归（BUG-20260914-004）：totalDone>0 占用态文案保留且不与「无 done 条目」空态混用；缺 totalDone 回落精简空态', async () => {
  const occupied = [ver('BLD-20260914-001', [verItem('REQ-20260914-010', 'x')])];
  const h1 = setup({ candidates: { items: [], totalDone: 2 }, versions: occupied });
  await h1.run(`window.ATBBuild.enter('/p/a')`);
  await h1.run(`window.ATBBuild.openCreatePanel()`);
  const inner1 = h1.run(`document.querySelector('#buildView').innerHTML`);
  const panel1 = panelOf(inner1, '新建版本');
  assert.ok(panel1, '新建版本面板应渲染');
  assert.match(panel1, /已完成的条目均已纳入版本计划/, 'totalDone>0 时给出「均已被占用」空态');
  assert.doesNotMatch(panel1, /暂无可纳入版本的条目/, '不与「无 done 条目」空态文案混用');
  assert.equal(countOf(panel1, SCOPE_RE), 1, '占用态同样口径单次（仅头部）');

  const h2 = setup({ candidates: { items: [] }, versions: [] }); // 旧响应缺 totalDone
  await h2.run(`window.ATBBuild.enter('/p/a')`);
  await h2.run(`window.ATBBuild.openCreatePanel()`);
  const inner2 = h2.run(`document.querySelector('#buildView').innerHTML`);
  const panel2 = panelOf(inner2, '新建版本');
  assert.match(panel2, /暂无可纳入版本的条目/, '缺 totalDone 时回落「无 done 条目」空态');
  assert.equal(countOf(panel2, SCOPE_RE), 1, '回落分支口径同样单次');
});

t('F4 回归：正常候选态口径单次（仅头部），候选行 / 全选条照常渲染', async () => {
  const h = setup({
    candidates: {
      items: [
        { itemId: 'REQ-20260914-020', title: '未占用需求', status: 'done', commits: [H2] },
        { itemId: 'REQ-20260914-021', title: '未占用无提交需求', status: 'done', commits: [] },
      ],
      totalDone: 2,
    },
  });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const panel = panelOf(inner, '新建版本');
  assert.ok(panel, '新建版本面板应渲染');
  assert.equal(countOf(panel, SCOPE_RE), 1, '正常态口径只在头部出现一次');
  assert.match(panel, /id="bldPickAll"/, '全选条照常渲染');
  assert.match(panel, /data-pick=/, '候选行照常渲染');
  assert.match(panel, /REQ-20260914-020/, 'done 候选渲染');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
