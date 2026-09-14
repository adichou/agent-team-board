#!/usr/bin/env node
// BUG-20260911-009 禁用态按钮无视觉反馈 —— 通用 .btn:disabled 禁用态视觉契约
// 覆盖验收标准：1/3 通用禁用态（半透明 + not-allowed，含 .btn.primary 变体，
// 作用于 #batchNext/#devStart/#refineNext/#commitNext/#commitCreate 等任务面板按钮）；
// 2 禁用时 title 说明保留；4 既有上下文禁用样式不回退（.sel-group .btn:disabled /
// .card-accept-btn:disabled / .shot-x:disabled / .refine-badge:disabled）；
// 5 vm 桩渲染：空态禁用按钮走通用 .btn 类，视觉由通用规则接管。
// 用法：node scripts/tests/bug-btn-disabled-visual-20260911-009.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 提取选择器声明块（支持选择器列表「a, b { }」形态）
function decls(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- C1/C2 静态 CSS 契约 ----------

t('C1 通用 .btn:disabled：半透明（0<opacity<1）+ not-allowed 光标，裸选择器全局生效', () => {
  const r = decls('.btn:disabled');
  const o = Number(r.match(/opacity:\s*([\d.]+)/)?.[1]);
  assert.ok(o > 0 && o < 1, `opacity 应为 (0,1) 半透明（得到 ${r}）`);
  assert.match(r, /cursor:\s*not-allowed/, '禁用态 not-allowed 光标');
  // 通用规则必须先于/独立于各上下文规则：裸 .btn:disabled 直接命中 .btn.primary 等变体
  // （变体选择器为 .btn.primary 复合类，元素恒带 .btn，无需逐变体另写禁用规则）
  assert.match(flat, /\.btn\.primary\s*\{/, '.btn.primary 为 .btn 复合类（同元素命中通用规则）');
});

t('C2 上下文专属禁用样式不回退：.sel-group .btn / .card-accept-btn / .shot-x / .refine-badge', () => {
  assert.match(decls('.sel-group .btn:disabled'), /cursor:\s*not-allowed/, '选择组按钮禁用反馈保留');
  assert.match(decls('.card-accept-btn:disabled'), /opacity:\s*0?\.5/, '卡片接受按钮禁用反馈保留');
  assert.match(decls('.shot-x:disabled'), /cursor:\s*default/, '截图移除按钮禁用光标口径保留');
  assert.match(decls('.refine-badge:disabled'), /cursor:\s*default/, '完善徽标禁用光标口径保留');
});

// ---------- vm 桩渲染：空态禁用按钮走通用 .btn 类 + title 保留 ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
  };
}

function setupUI() {
  const document = element();
  document.createElement = element;
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(js.split('\nboot();')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/p';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {};');
  return { sandbox, document, state, run };
}

const mkBatch = (extra = {}) => ({
  batchId: 'B-20990911-001', mode: 'zcode', agent: 'subagent', status: 'finished',
  abortRequested: false, aborted: false, pauseRequested: false, developer: null,
  createdAt: '2026-09-11T00:00:00.000Z', lastActivityAt: '2026-09-11T00:10:00.000Z',
  candidates: [], prompt: '主调度提示词内容', ...extra,
});

// 逐按钮断言：禁用 + title 原因保留 + class 恒含通用 .btn（视觉由通用 .btn:disabled 规则接管）
function assertDisabledBtn(html, id, titleRe) {
  const btn = html.match(new RegExp(`<button type="button" class="btn[^"]*" id="${id}"[^>]*>`));
  assert.ok(btn, `应渲染按钮 ${id}`);
  assert.match(btn[0], /\sdisabled/, `${id} 空态应禁用`);
  assert.match(btn[0], new RegExp(`title="${titleRe}`), `${id} 禁用时 title 原因保留`);
}

t('V1 批量开发空态：#devStart / #batchNext 禁用 + title 保留 + 走通用 .btn 类', () => {
  const h = setupUI();
  h.run('plannedQueue = () => [];');
  // 启动区「启动」
  const bar = h.run('renderDevStartBar()');
  assertDisabledBtn(bar, 'devStart', '暂无已计划候选');
  assert.match(bar.match(/<button[^>]*id="devStart"[^>]*>/)[0], /class="btn primary"/, 'devStart 为 .btn.primary（命中通用规则）');
  // 终态「启动新一轮」（批次结束 + 无已计划候选）
  h.state.batchData = {
    batch: mkBatch(),
    counts: { total: 1, reported: 1, failed: 0, blockedRuns: 0, interrupted: 0, remaining: 0 },
    current: null, records: [], recordsTotal: 1, pending: [], nextAction: 'stop', notice: null, queue: [], stats: { candidates: 0, blocked: 0 },
  };
  const dev = h.run('renderZcodeBatchPanel()');
  assertDisabledBtn(dev, 'batchNext', '暂无已计划候选');
  assert.match(dev.match(/<button[^>]*id="batchNext"[^>]*>/)[0], /class="btn primary"/, 'batchNext 为 .btn.primary（命中通用规则）');
  // 有候选对照：title 保留但不禁用（禁用语义不变，可点路径不回退）
  h.run('plannedQueue = () => [{ id: "REQ-1", title: "t" }];');
  const dev2 = h.run('renderZcodeBatchPanel()');
  const btn2 = dev2.match(/<button[^>]*id="batchNext"[^>]*>/)[0];
  assert.doesNotMatch(btn2, /\sdisabled/, '有候选时启动新一轮可点');
  assert.match(btn2, /title="/, '有候选时 title 保留');
});

t('V2 批量完善空态：#refineNext 禁用 + title 保留 + 走通用 .btn 类', () => {
  const h = setupUI();
  h.state.refine.data = {
    batch: mkBatch({ batchId: 'RFB-20990911-001' }),
    counts: { total: 1, done: 1, failed: 0, skipped: 0, interrupted: 0, remaining: 0 },
    current: null, records: [], recordsTotal: 1, candidates: [], stats: { candidates: 0 },
  };
  const ref = h.run('renderRefinePanel()');
  assertDisabledBtn(ref, 'refineNext', '暂无可完善候选');
  assert.match(ref.match(/<button[^>]*id="refineNext"[^>]*>/)[0], /class="btn primary"/, 'refineNext 为 .btn.primary（命中通用规则）');
});

t('V3 批量 Commit 面板已回退（REQ-20260911-010）：renderCommitPanel / commitCreate / commitNext 不存在', () => {
  // 人工触发的批量提交流程整体下线，禁用态视觉规则不再有 commit 侧用例
  assert.doesNotMatch(js, /renderCommitPanel/, 'renderCommitPanel 应随面板回退移除');
  for (const id of ['commitCreate', 'commitNext']) {
    assert.doesNotMatch(js, new RegExp(`id="${id}"`), `${id} 按钮应随面板回退移除`);
  }
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
