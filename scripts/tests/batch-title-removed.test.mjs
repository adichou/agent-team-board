#!/usr/bin/env node
// BUG-20260908-009 契约测试 —— 任务面板头部不再渲染「任务」模块大标题。
// 模块归属由第二行「任务」页签（data-view="runs"）+ 第三行副标题
// 「进度、队列与结果集中在这里」（MODULE_SUB.runs，REQ-20260907-004 口径）承担。
// BUG-20260909-014 新契约：头部整行移除 .batch-head（项目路径与顶栏 #dataDir 重复、「✕」
// 与导航「需求」页签重复），不再渲染 #batchClose 与 span.path，头部只剩
// 「批量完善 / 批量开发」子面板 Tab（REQ-20260908-020）并收紧间距。
// 范围边界：条目详情抽屉 renderDrawer 的 <h2>${标题}</h2> 属条目标题非模块名，
// 保留；aria-label 非可见辅助信息，保留原样。
// 用法：node scripts/tests/batch-title-removed.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');

// DOM 接缝：控件级 stub（settings-title-removed.test.mjs 同法）；
// document.querySelector 对未播种选择器自动造节点，容纳文件尾部静态事件绑定段
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false, indeterminate: false,
    tagName: 'DIV',
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: () => true, toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
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
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '', href: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url) => {
      const p = String(url).split('?')[0];
      const body = p === '/api/tasks/settings'
        ? { settings: { agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] }, models: { refine: {}, develop: {} } } }
        : p === '/api/dispatch/settings'
          ? { settings: { codex: {} } }
          : p === '/api/dispatch/codex/models'
            ? { ok: false, models: [], reason: 'stub 未加载', loadedAt: null }
            : p === '/api/dispatch/codex/model-inherit'
              ? { inherit: {} }
              : {};
      return { ok: true, status: 200, statusText: 'OK', json: async () => body };
    },
  };
  vm.createContext(sandbox);
  // 载入至「启动」段之前：包含全部渲染函数（renderBatchDrawer 等）与静态事件绑定，
  // 排除 boot() 的真实网络轮询
  vm.runInContext(source.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  return { sandbox, document, state, run, seed };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 动态渲染：批量完善子面板头部无「任务」大标题，其余头部元素保留', async () => {
  const h = setup();
  h.state.batch.mode = 'refine';
  const drawer = element();
  h.seed('#batchDrawer', drawer);
  await h.run('renderBatchDrawer()');
  const head = drawer.innerHTML;
  assert.doesNotMatch(head, /<h2>任务<\/h2>/, '任务面板头部不应再渲染「任务」大标题');
  // BUG-20260909-014：头部整行移除 .batch-head——项目路径（与顶栏 #dataDir 重复）
  // 与「✕」关闭按钮（与导航「需求」页签重复）不再渲染，消除页签上方空白横带
  assert.doesNotMatch(head, /class="batch-head"/, '头部不应再渲染 .batch-head 行（BUG-20260909-014 整行移除）');
  assert.doesNotMatch(head, /class="path"/, '头部不应再渲染项目路径 span.path（顶栏 #dataDir 已展示）');
  assert.doesNotMatch(head, /id="batchClose"/, '头部不应再渲染「✕」关闭按钮（离开模块走导航页签）');
  assert.match(head, /data-bmode="refine"[^>]*>AI 分析</, '「AI 分析」子面板 Tab 应保留（REQ-20260913-005 改名）');
  assert.match(head, /data-bmode="develop"[^>]*>AI 开发</, '「AI 开发」子面板 Tab 应保留（REQ-20260913-005 改名）');
  assert.match(head, /<header class="drawer-head">/, '抽屉头部容器结构保留（样式由 .drawer-head 承担）');
});

t('T2 动态渲染：批量开发子面板同样无「任务」大标题，面板主体不受影响', async () => {
  const h = setup();
  h.state.batch.mode = 'develop';
  const drawer = element();
  h.seed('#batchDrawer', drawer);
  await h.run('renderBatchDrawer()');
  const head = drawer.innerHTML;
  assert.doesNotMatch(head, /<h2>任务<\/h2>/, '批量开发子面板头部同样不应出现「任务」大标题');
  assert.match(head, /id="devStart"/, '批量开发启动区（启动按钮）应正常渲染（REQ-20260909-011：无执行 Agent 选择）');
  assert.doesNotMatch(head, /id="batchClose"/, '关闭按钮不应再渲染（BUG-20260909-014）');
});

t('T3 静态契约：renderBatchDrawer 函数体不再拼接「任务」模块大标题', () => {
  const fn = source.match(/function renderBatchDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 renderBatchDrawer');
  assert.doesNotMatch(fn[0], /<h2>任务<\/h2>/, 'renderBatchDrawer 不应再拼接「任务」大标题');
  assert.doesNotMatch(fn[0], /id="batchClose"/, 'renderBatchDrawer 不应再拼接关闭按钮（BUG-20260909-014）');
  // 绑定一并移除：不再查询 #batchClose（否则头部无该节点时报错）
  const bind = source.match(/function bindBatchDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(bind, '应存在 bindBatchDrawer');
  assert.doesNotMatch(bind[0], /batchClose/, 'bindBatchDrawer 不应再绑定 #batchClose（节点已移除）');
});

t('T4 范围边界：详情抽屉条目标题、aria 标签与样式规则不受影响', () => {
  // 条目详情抽屉的 <h2> 是条目标题而非模块名，保留
  const detail = source.match(/function renderDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(detail, '应存在 renderDrawer');
  assert.match(detail[0], /<h2>\$\{esc\(it\.title\)\}<\/h2>/, '详情抽屉条目标题 h2 应保持原样');
  // .drawer-head h2 样式仍被详情抽屉使用，CSS 规则保留
  assert.match(css, /\.drawer-head h2\s*\{/, 'style.css 的 .drawer-head h2 规则仍被详情抽屉引用，应保留');
  // aria-label 非可见辅助信息，保留原样（README 期望 4）
  assert.match(html, /id="runsView"[^>]*aria-label="任务"/, '#runsView aria-label="任务" 应保留');
  assert.match(html, /id="batchDrawer"[^>]*aria-label="任务面板"/, '#batchDrawer aria-label="任务面板" 应保留');
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
