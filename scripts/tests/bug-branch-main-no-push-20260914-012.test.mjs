#!/usr/bin/env node
// BUG-20260914-012 分支浏览「本地」分组 main 行渲染了多余的「推送」按钮：
// main 推远端归发布模块受控动作（REQ-20260913-001 语义边界；同步推送 BUG-20260914-011 起亦排除 main），
// 分支浏览不为 main 渲染推送入口；行本身保留（只读浏览不变），其余分支按钮 / attn 高亮 / 推送链路不变。
// U1–U3：build.js 分支列表渲染（vm 行为，载荷注入 + 同步应答控制，setup 模式同 BUG-20260914-006 测试）；
// S1：源码静态断言——[data-push] 委托绑定与推送执行链路保持存在（仅渲染条件收敛，非链路改动）。
// 用法：node scripts/tests/bug-branch-main-no-push-20260914-012.test.mjs

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

function statePayload(over = {}) {
  return { initialized: true, isRepo: true, currentBranch: 'dev', versions: [], ...over };
}

function setup({ branches, state = statePayload(), fetchResult } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const toasts = [];
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    toast: (m, isErr) => toasts.push([m, isErr]),
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(branches)) };
      if (up.pathname === '/api/build/sync') return fetchResult ? fetchResult() : { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, toasts, document, run: (code) => vm.runInContext(code, sandbox) };
}

async function openBranches(h) {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  return h.document.nodes.get('#buildView');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

t('U1 dev+main 双分支（当前 dev）：main 行无「推送」按钮且行保留可浏览，其他分支按钮结构不变', async () => {
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev', 'feat', 'main'], remote: [], remotes: ['origin'] } });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  assert.match(inner, /data-branch="main"/, 'main 行本身保留（只读浏览语义不变）');
  assert.doesNotMatch(inner, /data-push="main"/, 'main 行不得渲染「推送」按钮（BUG-20260914-012）');
  assert.match(inner, /data-push="feat"/, '非 main 开发分支「推送」按钮仍在');
  assert.match(inner, /data-push="feat"[^>]*title="推送到远端"/, '按钮属性结构与改前一致');
});

t('U2 main 为当前分支：以「当前」行渲染、无按钮（现状回归未破坏）；其他分支按钮仍在', async () => {
  const h = setup({ branches: { isRepo: true, current: 'main', local: ['main', 'dev'], remote: [], remotes: ['origin'] } });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  assert.match(inner, /bld-cur" data-branch="main"/, 'main 以「当前」行渲染（现状）');
  assert.doesNotMatch(inner, /data-push="main"/, '当前 main 行本就无按钮，修复后同样无');
  assert.match(inner, /data-push="dev"/, '非当前 dev 行按钮仍在');
});

t('U3 BUG-20260914-006 回归：同步成功后远端仍空 → 非 main 分支推送按钮 attn 高亮仍在，main 行无按钮', async () => {
  const h = setup({
    branches: { isRepo: true, current: 'dev', local: ['dev', 'feat', 'main'], remote: [], remotes: ['origin'] },
    fetchResult: () => ({ ok: true, json: async () => ({ ok: true, remote: 'origin', pushed: [], failed: [], skipped: ['main'] }) }),
  });
  const view = await openBranches(h);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  const inner = view.innerHTML;
  assert.match(inner, /bld-push attn/, 'dev 行「推送」按钮仍高亮为出路（高亮对象为非 main 分支）');
  assert.doesNotMatch(inner, /data-push="main"/, 'main 行不得出现高亮或普通推送按钮');
});

t('S1 源码：推送链路仅收敛渲染条件——[data-push] 委托绑定与确认弹窗 / 执行入口保持存在', () => {
  assert.match(buildJs, /querySelectorAll\('\[data-push\]'\)/, '[data-push] 点击委托绑定仍在（按钮行为链路未动）');
  assert.match(buildJs, /renderPushConfirm/, '推送确认弹窗渲染仍在');
  assert.match(buildJs, /post\('\/push'/, '推送执行接口调用仍在（服务端能力口径见 design.md：不封禁）');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${String(e && e.message ? e.message : e).split('\n').join('\n  ')}`);
  }
}
console.log(`\n${cases.length} 用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
