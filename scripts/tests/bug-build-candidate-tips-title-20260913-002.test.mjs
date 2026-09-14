#!/usr/bin/env node
// BUG-20260913-002 优化：新建版本 / 添加条目候选行 tips 只显示标题，不含单号。
// 引入来源：REQ-20260913-001（构建模块候选行渲染时未带 title 属性，长标题截断后
// 悬停无提示；BUG-20260913-002 初版口径为 tips 含「单号 + 标题」，人工优化为仅标题，
// 与版本详情正文条目行既有 tips 口径一致）。
// 修复口径（README「期望行为」，经人工优化调整）：
//   - 新建版本、添加条目两个侧拉面板的候选行标题带原生 tips（title 属性），
//     内容为完整标题，不含单号；
//   - tips 文案经 esc() 转义，标题含引号 / 尖括号不截断属性、无注入；
//   - 行内展示口径不变：仍是「单号 + 标题」单行省略截断。
// 用法：node scripts/tests/bug-build-candidate-tips-title-20260913-002.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const H1 = 'a'.repeat(40);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 脚手架（vm 行为测试，沿用 BUG-20260913-001 模式） ---------- */

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

function setup({ candidates, versions = [] } = {}) {
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

// 从渲染 HTML 中提取某候选行的标题 span 标签（含属性）
function candTitleTag(html, itemId) {
  const m = html.match(new RegExp(`<span class="bld-cand-title"[^>]*>[^<]*(?:${itemId})[^<]*</span>`));
  return m ? m[0] : null;
}

/* ---------- 用例 ---------- */

t('T1 新建版本面板：候选行标题带 tips，内容为完整标题且不含单号', async () => {
  const longTitle = '这是一个超过二十五个字的长标题用于验证候选行截断后悬停提示只显示标题';
  const h = setup({ candidates: { items: [
    { itemId: 'REQ-20260913-010', title: longTitle, status: 'done', commits: [H1] },
  ] } });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const tag = candTitleTag(inner, 'REQ-20260913-010');
  assert.ok(tag, '候选行标题 span 应渲染');
  assert.match(tag, / title="/, '标题 span 应带 title 属性（tips）');
  const tip = tag.match(/ title="([^"]*)"/)[1];
  assert.equal(tip, longTitle, 'tips 内容应为完整标题');
  assert.ok(!tip.includes('REQ-20260913-010'), 'tips 不应包含单号');
});

t('T2 添加条目面板：候选行 tips 同口径（共用渲染函数，只显示标题）', async () => {
  const versions = [{
    id: 'BLD-20260913-001', name: 'v1.0', description: '', status: 'draft', targetBranch: 'main',
    items: [{ itemId: 'REQ-20260913-099', commit: H1, title: '已在版本中', mergedAt: null, mergeError: null }],
    createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
  }];
  const longTitle = '添加条目面板里同样需要悬停提示的长标题条目，截断后悬停只显示标题不含单号';
  const h = setup({
    versions,
    candidates: { items: [
      { itemId: 'BUG-20260913-021', title: longTitle, status: 'done', commits: [H1] },
    ] },
  });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('versions')`);
  await h.run(`window.ATBBuild.openAddPanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const tag = candTitleTag(inner, 'BUG-20260913-021');
  assert.ok(tag, '添加条目面板候选行应渲染');
  const tip = tag.match(/ title="([^"]*)"/)?.[1];
  assert.equal(tip, longTitle, '添加条目面板 tips 应为完整标题');
  assert.ok(!tip.includes('BUG-20260913-021'), '添加条目面板 tips 不含单号');
});

t('T3 特殊字符标题：tips 经 esc() 转义进 title 属性，无属性截断、无注入', async () => {
  const h = setup({ candidates: { items: [
    { itemId: 'REQ-20260913-011', title: '含"引号"与<尖括号>的标题', status: 'done', commits: [H1] },
  ] } });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const tag = candTitleTag(inner, 'REQ-20260913-011');
  assert.ok(tag, '候选行应渲染');
  const tip = tag.match(/ title="([^"]*)"/)[1];
  assert.equal(tip, '含&quot;引号&quot;与&lt;尖括号&gt;的标题', '引号转义为 &quot;、尖括号转义为 &lt;&gt;');
  assert.equal((inner.match(/含"引号"/g) || []).length, 0, '原始引号不得直接落入 HTML（防属性截断）');
});

t('T4 行内展示口径不变：行内仍为「单号 + 标题」，本次只改 tips 不动文案', async () => {
  const h = setup({ candidates: { items: [
    { itemId: 'REQ-20260913-010', title: '短标题条目', status: 'done', commits: [H1] },
  ] } });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const tag = candTitleTag(inner, 'REQ-20260913-010');
  assert.ok(tag, '候选行应渲染');
  const text = tag.replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '');
  assert.match(text, /REQ-20260913-010\s*短标题条目/, '行内仍显示「单号 + 标题」');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
