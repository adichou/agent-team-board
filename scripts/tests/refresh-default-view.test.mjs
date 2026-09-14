#!/usr/bin/env node
// BUG-20260907-002：浏览器手动刷新需求界面无数据，切换到其他栏目再切回来才有数据。
// 根因：boot() 对默认 status 视图不调 setView，#reqView 保持 index.html 初始 hidden，
// renderBoard 只切换其子容器 #board/#emptyState，整个需求工作区不可见；切换栏目再
// 回来触发 setView('status') 才显示。引入来源：REQ-20260907-004 布局重构。
// 行为测试：vm + 模拟 DOM 加载完整 app.js（含 boot()），断言刷新（默认视图）后数据可见。
// 用法：node scripts/tests/refresh-default-view.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const item = (id, extra = {}) => ({
  id, type: id.startsWith('BUG') ? 'bug' : 'requirement', status: 'submitted', title: `标题 ${id}`,
  createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z', ...extra,
});

// DOM 接缝：与 index.html 初始态一致的 hidden 集合；querySelector 按需建节点并缓存。
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => (on ? classes.add(v) : classes.delete(v)),
    },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
  };
}

// 与 index.html 一致：初始带 hidden 的容器（BUG-20260907-016 恢复 #filterBar 第四行筛选条）
const INITIALLY_HIDDEN = [
  '#reqView', '#board', '#emptyState', '#filterBar', '#docHits', '#fileView', '#oncallView',
  '#oncallMask', '#oncallDrawer', '#oncallLightbox', '#runsView', '#settingsView', '#modalWrap', '#mask',,
  '#holdPanel',
];

function setup({ search = '', boardOnline = true } = {}) {
  const document = element();
  document.createElement = element;
  for (const sel of INITIALLY_HIDDEN) document.querySelector(sel).classList.add('hidden');
  const board = { initialized: true, projectRoot: '/project/a', dataDir: '/project/a/docs/agent-team-board', items: [item('REQ-20990101-001'), item('BUG-20990101-002')] };
  const requests = [];
  const sandbox = {
    document, URLSearchParams, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    location: { pathname: '/', search }, history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {} },
    fetch: async (url) => {
      requests.push(String(url));
      const u = String(url);
      if (u.includes('/api/health')) return { ok: true, json: async () => ({ projects: ['/project/a'], defaultProject: '/project/a' }) };
      if (u.includes('/api/board')) {
        if (!boardOnline) return { ok: false, status: 500, statusText: 'Offline', json: async () => ({ error: '服务离线' }) };
        return { ok: true, json: async () => JSON.parse(JSON.stringify(board)) };
      }
      if (u.includes('/api/dispatch/pending')) return { ok: true, json: async () => ({ count: 0, items: [] }) };
      return { ok: true, json: async () => ({}) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app.js' }); // 模块求值即触发 boot()
  const run = (code) => vm.runInContext(code, sandbox);
  const dom = (sel) => document.querySelector(sel);
  async function waitBoot() { // 等 boot() 的 await 链推进完毕（状态稳定：board 已写入或明确失败）
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (run('state.board !== null')) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('boot() 未在时限内写入看板数据');
  }
  return { sandbox, document, run, dom, requests, board, waitBoot };
}

t('R1 复现修复：默认需求视图手动刷新后数据立即可见（#reqView 不再保持 hidden）', async () => {
  const h = setup(); // 无 ?view= 参数：浏览器刷新需求界面的默认路径
  await h.waitBoot();
  assert.equal(h.run('state.view'), 'status', '默认应进入需求视图');
  assert.equal(h.dom('#reqView').classList.contains('hidden'), false, '刷新后需求工作区必须可见（BUG-20260907-002 核心）');
  assert.equal(h.dom('#board').classList.contains('hidden'), false, '已初始化项目列表应显示');
  assert.equal(h.dom('#emptyState').classList.contains('hidden'), true, '有数据时不应显示初始化空态');
  assert.equal(h.dom('#reqList').children.length, 2, '两条条目应渲染进列表');
  assert.equal(h.dom('#moduleSub').textContent, '从想法到验收，跟进每一项工作', '默认视图副标题应初始化');
});

t('R2 切走再切回不依赖 workaround：boot 后直接 setView 往返，列表保持可见', async () => {
  const h = setup();
  await h.waitBoot();
  h.run("setView('runs')");
  assert.equal(h.dom('#reqView').classList.contains('hidden'), true, '离开需求视图应隐藏');
  h.run("setView('status')");
  assert.equal(h.dom('#reqView').classList.contains('hidden'), false, '切回需求视图应可见');
  assert.equal(h.dom('#reqList').children.length, 2, '数据不因往返丢失');
});

t('R3 深链其他模块刷新后切回需求：依旧可见（不回归 W12 深链兼容；REQ-20260909-013：讨论深链回落需求）', async () => {
  const h = setup({ search: '?project=%2Fproject%2Fa&view=runs' });
  await h.waitBoot();
  assert.equal(h.run('state.view'), 'runs', '深链应进入任务视图');
  assert.equal(h.dom('#runsView').classList.contains('hidden'), false, '任务视图应可见');
  h.run("setView('status')");
  assert.equal(h.dom('#reqView').classList.contains('hidden'), false, '切回需求视图应可见');
  assert.equal(h.dom('#reqList').children.length, 2, '数据应渲染');

  // REQ-20260909-013：旧 oncall / files 深链回落需求模块（不进入已隐藏模块，无空白视图）
  const h2 = setup({ search: '?project=%2Fproject%2Fa&view=oncall' });
  await h2.waitBoot();
  assert.equal(h2.run('state.view'), 'status', 'oncall 深链应回落需求模块');
  assert.equal(h2.dom('#reqView').classList.contains('hidden'), false, '回落后需求工作区可见');
});

t('R4 首轮服务离线：boot 仍应初始化视图容器，显示空态引导而非整页空白', async () => {
  const h = setup({ boardOnline: false });
  await new Promise((r) => setTimeout(r, 80)); // poll 失败路径无 state.board 写入，等待即止
  assert.equal(h.run('state.board'), null);
  assert.equal(h.dom('#reqView').classList.contains('hidden'), false, '离线时需求视图容器也应初始化（空态可见）');
  assert.equal(h.dom('#emptyState').classList.contains('hidden'), false, '未取得看板数据应显示初始化空态');
});

t('R5 静态契约：boot 对默认视图必须无条件调用 setView 初始化容器显隐', () => {
  const bootSeg = source.slice(source.indexOf('async function boot()'), source.indexOf('boot();'));
  assert.ok(bootSeg, '缺少 boot 函数');
  assert.match(bootSeg, /setView\(viewParam\)/, 'boot 应对解析后的视图统一调用 setView（含默认 status）');
  assert.doesNotMatch(bootSeg, /viewParam !== 'status'/, '不得按视图分支跳过 setView——正是该分支导致默认视图刷新后 #reqView 保持 hidden');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
