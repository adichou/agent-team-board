#!/usr/bin/env node
// BUG-20260914-005 分支浏览同步按钮文案「⟳ 同步远端」→「⟳ 和远端同步」。
// U1–U4：build.js 分支浏览渲染（vm，载荷注入）——默认态文案 / 远端空态指称 /
// 执行中禁用与成功失败 toast 维持现状；W1：i18n 词典新词条（含 ⟳ 前缀全文命中）与
// 旧键清理；S1：源码旧按钮文案无残留（toast「同步远端失败」等现状串不受影响）。
// 用法：node scripts/tests/bug-sync-btn-wording-20260914-005.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

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
  return {
    initialized: true,
    isRepo: true,
    currentBranch: 'dev',
    versions: [],
    ...over,
  };
}

// fetchResult：同步接口的可控应答工厂（U3/U4 驱动 busy 态与 toast；
// BUG-20260914-011 起同步走 /api/build/sync，成功应答含逐分支推送结果）
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
  return {
    sandbox, toasts, document,
    run: (code) => vm.runInContext(code, sandbox),
  };
}

async function openBranches(h, branches) {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  return h.document.nodes.get('#buildView');
}

const fetchBtnHtml = (inner) => {
  const m = inner.match(/<button[^>]*id="bldFetchBtn"[^>]*>/);
  assert.ok(m, '应渲染 #bldFetchBtn 同步按钮');
  return m[0];
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- U1–U2：文案与指称 ---------- */

t('U1 默认态按钮显示「⟳ 和远端同步」，悬停提示为 fetch+push 双动作（BUG-20260914-011），旧文案无残留', async () => {
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev'], remote: ['origin/dev'] } });
  const view = await openBranches(h, null);
  const inner = view.innerHTML;
  assert.match(inner, /⟳ 和远端同步/, '按钮默认态应为「⟳ 和远端同步」');
  assert.doesNotMatch(inner, /⟳ 同步远端/, '旧按钮文案「⟳ 同步远端」不得残留');
  assert.match(fetchBtnHtml(inner), /title="fetch --all --prune 拉取远端，再推送本地开发分支（main 除外）：确保本地与远端一致"/, '悬停提示为双动作口径（BUG-20260914-011）');
  assert.ok(!/disabled/.test(fetchBtnHtml(inner)), '默认态不禁用');
});

t('U2 远端空态指称与按钮更名一致：先「和远端同步」或推送本地分支', async () => {
  // BUG-20260914-006：remotes=[]（未配置远端）保持本句既有空态文案（范围外不改）
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev'], remote: [], remotes: [] } });
  const view = await openBranches(h, null);
  const inner = view.innerHTML;
  assert.match(inner, /（无远端分支：先「和远端同步」或推送本地分支）/, '空态提示应引用新按钮名');
  assert.doesNotMatch(inner, /先「同步远端」/, '空态提示不得再引用旧按钮名');
});

/* ---------- U3–U4：行为维持现状（禁用 / 同步中 / 成功失败 toast） ---------- */

t('U3 点击同步：执行中禁用并显示「同步中…」，成功 toast 汇总 fetch 与推送（BUG-20260914-011），完成后恢复新文案', async () => {
  let resolveFetch;
  const fetchResult = () => new Promise((res) => { resolveFetch = res; });
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev'], remote: ['origin/dev'] }, fetchResult });
  const view = await openBranches(h, null);
  const btn = view.nodes.get('#bldFetchBtn');
  assert.ok(btn?.listeners?.click, '#bldFetchBtn 应绑定 click（doSync）');
  btn.listeners.click();
  assert.match(view.innerHTML, /同步中…/, '执行中应显示「同步中…」');
  assert.match(fetchBtnHtml(view.innerHTML), /disabled/, '执行中按钮应禁用');
  resolveFetch({ ok: true, json: async () => ({ ok: true, remote: 'origin', pushed: [{ branch: 'dev', remoteBranch: 'origin/dev', setUpstream: true }], failed: [], skipped: [] }) });
  await sleep(30);
  assert.deepEqual(
    h.toasts.filter(([m]) => m === '✓ 已同步远端：fetch 完成，已推送 dev → origin'),
    [['✓ 已同步远端：fetch 完成，已推送 dev → origin', undefined]],
    '成功 toast 汇总两步结果',
  );
  assert.match(view.innerHTML, /⟳ 和远端同步/, '完成后按钮恢复新文案');
  assert.ok(!/disabled/.test(fetchBtnHtml(view.innerHTML)), '完成后按钮恢复可点');
});

t('U4 同步失败：错误 toast 维持现状，按钮恢复可点可重试', async () => {
  const fetchResult = () => ({ ok: false, status: 502, json: async () => ({ error: '远端不可达' }) });
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev'], remote: [] }, fetchResult });
  const view = await openBranches(h, null);
  const btn = view.nodes.get('#bldFetchBtn');
  btn.listeners.click();
  assert.match(view.innerHTML, /同步中…/, '执行中应显示「同步中…」');
  await sleep(30);
  assert.ok(
    h.toasts.some(([m]) => m === '✕ 同步远端失败：远端不可达'),
    '失败 toast 应维持「✕ 同步远端失败：<原因>」',
  );
  assert.match(view.innerHTML, /⟳ 和远端同步/, '失败后按钮恢复新文案');
  assert.ok(!/disabled/.test(fetchBtnHtml(view.innerHTML)), '失败后按钮恢复可点（可重试）');
});

/* ---------- W1：i18n 词典 ---------- */

t('W1 词典收录新文案（键含 ⟳ 前缀全文命中），中英往返，旧按钮名词条清理', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  assert.equal(EN['⟳ 和远端同步'], '⟳ Sync with remote', '新按钮文案应有词条（⟳ 与文案同文本节点，键需含前缀）');
  assert.ok(!('⟳ 同步远端' in EN), '旧按钮文案不得残留词条');
  assert.ok(!('同步远端' in EN), '更名后旧键「同步远端」应清理（避免死词条）');
  I.setLang('en');
  assert.equal(I.t('⟳ 和远端同步'), '⟳ Sync with remote', '英文界面按钮应正常翻译（不降级显示中文）');
  I.setLang('zh');
  assert.equal(I.t('⟳ Sync with remote'), '⟳ 和远端同步', '切回中文可还原（往返）');
});

/* ---------- S1：源码旧文案无残留 ---------- */

t('S1 build.js 源码：旧按钮文案「⟳ 同步远端」无残留，现状串（同步中…/失败 toast/成功汇总）保持', () => {
  assert.ok(!buildJs.includes('⟳ 同步远端'), '源码不得残留旧按钮文案');
  assert.ok(buildJs.includes('⟳ 和远端同步'), '源码应包含新按钮文案');
  assert.ok(buildJs.includes('先「和远端同步」或推送本地分支'), '空态指称应更新');
  assert.ok(buildJs.includes('同步中…'), '执行中文案维持现状');
  assert.ok(buildJs.includes('✓ 已同步远端：fetch 完成，已推送 '), '成功 toast 为两步汇总口径（BUG-20260914-011）');
  assert.ok(buildJs.includes('✕ 同步远端失败：'), '失败 toast 维持现状');
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
