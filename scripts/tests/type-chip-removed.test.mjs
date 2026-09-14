#!/usr/bin/env node
// BUG-20260908-004 契约测试 —— 单号前缀（REQ-/BUG-）已区分类型，界面不再渲染
// 与单号并排的 REQ/BUG 类型徽章（chip）。覆盖三处：需求列表行（reqRowEl）、
// 详情抽屉头部（renderDrawer）、需求完善候选列表（renderRefinePanel 静态契约）；
// 并清理 style.css 中失去引用的 .chip.req / .chip.bug 配色。
// 抽屉 meta-grid 的「类型」字段是有标签的结构化详情字段（非徽章），不在本 Bug 范围。
// 用法：node scripts/tests/type-chip-removed.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

// DOM 接缝：控件级 stub（card-flag-dedup.test.mjs 同法）
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
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  seed('#board', element());
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {};');
  return { sandbox, document, state, run, seed };
}

const item = (id, status, extra = {}) => ({ id, type: 'requirement', status, parent: null, title: id, ...extra });

function drawerSetup(h) {
  const drawer = element();
  h.seed('#drawer', drawer);
  h.seed('#drawerClose', element()); // renderDrawer 尾部直接绑定 closeDrawer，需真实节点
  h.run('syncAcceptance=()=>{}; batchSettingsHtml=()=>""; bindBatchSettings=()=>{};');
  return drawer;
}
function setItem(h, it) {
  h.state.board = { initialized: true, items: [it] };
  h.state.drawer.id = it.id;
  h.state.drawer.item = it;
  h.state.drawer.navIds = null;
  h.sandbox.testItem = it;
}

// 类型徽章特征：与单号并排的 REQ/BUG chip（列表/抽屉/refine 候选三处拼接形式）
const CHIP_PATTERNS = [
  /<span class="chip (?:req|bug)">(?:REQ|BUG)<\/span>/,
];

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 需求列表行：不渲染 REQ/BUG 类型徽章，单号（含前缀）与复制按钮保留（requirement 与 bug 各验一条）', () => {
  const h = setup();
  setItem(h, item('REQ-20990101-001', 'in-progress'));
  const reqHtml = h.run('reqRowEl(testItem)').innerHTML;
  for (const p of CHIP_PATTERNS) assert.doesNotMatch(reqHtml, p, `需求行不应再渲染类型徽章：${p}`);
  assert.match(reqHtml, /class="cid">REQ-20990101-001</, '需求行应完整展示含 REQ- 前缀的单号');
  assert.match(reqHtml, /data-copy-id="REQ-20990101-001"/, '需求行单号复制按钮应保留');

  setItem(h, item('BUG-20990101-002', 'in-progress', { type: 'bug' }));
  const bugHtml = h.run('reqRowEl(testItem)').innerHTML;
  for (const p of CHIP_PATTERNS) assert.doesNotMatch(bugHtml, p, `Bug 行不应再渲染类型徽章：${p}`);
  assert.match(bugHtml, /class="cid">BUG-20990101-002</, 'Bug 行应完整展示含 BUG- 前缀的单号');
});

t('T2 详情抽屉头部：不渲染 REQ/BUG 类型徽章，单号保留', () => {
  const h = setup();
  const drawer = drawerSetup(h);
  setItem(h, item('REQ-20990101-003', 'in-progress'));
  h.run('renderDrawer()');
  for (const p of CHIP_PATTERNS) assert.doesNotMatch(drawer.innerHTML, p, `抽屉头部不应再渲染类型徽章：${p}`);
  assert.match(drawer.innerHTML, /class="cid">REQ-20990101-003</, '抽屉头部应完整展示含前缀的单号');
});

t('T3 静态契约：app.js 不再存在任何 REQ/BUG 类型徽章拼接（含需求完善候选列表），候选行仍渲染可跳转单号', () => {
  assert.doesNotMatch(source, /class="chip \$\{it\.type === 'requirement' \? 'req' : 'bug'\}"/, '不得残留列表/抽屉的类型徽章拼接');
  assert.doesNotMatch(source, /chip type-\$\{c\.type === 'requirement' \? 'req' : 'bug'\}/, '不得残留需求完善候选列表的类型徽章拼接');
  assert.doesNotMatch(source, /'req' : 'bug'\}">\$\{(?:it|c)\.type === 'requirement' \? 'REQ' : 'BUG'\}/, '不得残留 REQ/BUG 徽章文本插值');
  // REQ-20260908-026：候选列表收敛进共用 pendingQueueHtml（最近 2 条），行内仍渲染可跳转完整单号
  const queue = source.match(/function pendingQueueHtml\([\s\S]*?\n\}/);
  assert.ok(queue, '应存在 pendingQueueHtml');
  assert.match(queue[0], /data-goto-item="\$\{esc\(x\.id\)\}"/, '待处理队列行仍应渲染可跳转的完整单号');
});

t('T4 样式清理：style.css 移除失去引用的 .chip.req / .chip.bug 配色', () => {
  assert.doesNotMatch(css, /\.chip\.req\s*\{/, 'style.css 不应残留 .chip.req 规则');
  assert.doesNotMatch(css, /\.chip\.bug\s*\{/, 'style.css 不应残留 .chip.bug 规则');
});

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
