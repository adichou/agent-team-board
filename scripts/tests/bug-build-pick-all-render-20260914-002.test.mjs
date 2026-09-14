#!/usr/bin/env node
// BUG-20260914-002 版本计划选单面板「全选 / 全不选」点击后界面不更新（勾选集合与渲染错位）。
// 引入来源：REQ-20260913-001（构建模块前端选单工具行实现时，#bldPickAll 在有跳过条目时只弹
// toast 不重渲染，#bldPickNone 点击处理完全缺失 render()——内部 picked 集合已更新但界面保持旧值）。
// 修复口径（README「期望行为 / 验收说明」）：
//   - 「全选」点击后 DOM 立即同步：有 commit 候选的行复选框 checked、「已选 N 项」计数更新、
//     行内 commit 下拉解禁；无提交条目保持禁用与标注；跳过 toast 与界面更新同时生效；
//   - 「全不选」点击后 DOM 立即清空：复选框全不勾、计数归零、commit 下拉恢复禁用；
//     任意候选构成下行为一致；
//   - 新建版本 / 添加条目两个面板共用路径一并覆盖；
//   - 界面与提交内容一致：全选后提交的 items 即界面所显示勾选；全不选后提交被拦截且界面无勾选残留；
//   - 全部候选有提交的对照组不回归（全选仍正常、无跳过 toast）。
// 用法：node scripts/tests/bug-build-pick-all-render-20260914-002.test.mjs

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

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const R1 = 'REQ-20260914-001'; // done + 有提交 → 可全选
const R2 = 'REQ-20260914-002'; // done + 无提交 → 全选跳过、复选框禁用
const R3 = 'REQ-20260914-003'; // in-progress → 前端防御过滤不渲染

function mixedCandidates() {
  return { items: [
    { itemId: R1, title: '有提交需求', status: 'done', commits: [H1, H2] },
    { itemId: R2, title: '无提交需求', status: 'done', commits: [] },
    { itemId: R3, title: '开发中需求', status: 'in-progress', commits: [H2] },
  ] };
}

function allCommittedCandidates() {
  return { items: [
    { itemId: R1, title: '有提交需求', status: 'done', commits: [H1] },
    { itemId: R3, title: '另一有提交需求', status: 'done', commits: [H2] },
  ] };
}

const ver = (id, items = []) => ({
  id, name: id, description: '', status: 'draft', targetBranch: 'main', items,
  createdAt: '2026-09-14T01:00:00.000Z', updatedAt: '2026-09-14T02:00:00.000Z',
  merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
});

function setup({ state = null, candidates = mixedCandidates() } = {}) {
  const versions = state?.versions ?? [];
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const toasts = [];
  const requests = [];
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    toast: (m, isErr) => toasts.push({ m, isErr }),
    fetch: async (url, opts) => {
      const u = String(url);
      const up = new URL(u, 'http://local');
      requests.push({ url: u, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
      if (up.pathname === '/api/build/state') {
        return { ok: true, json: async () => JSON.parse(JSON.stringify({ initialized: true, isRepo: true, currentBranch: 'dev', versions })) };
      }
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => JSON.parse(JSON.stringify(candidates)) };
      if (up.pathname === '/api/build/version') return { ok: true, json: async () => ({ version: ver('BLD-NEW') }) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const inner = () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox);
  // 模拟用户点击面板内按钮（bindCommon 每次 render 后重新绑定，取最新监听器）
  const click = (sel) => vm.runInContext(
    `document.querySelector('#buildView').querySelector(${JSON.stringify(sel)}).listeners.click()`, sandbox);
  return { sandbox, toasts, requests, inner, click, run: (code) => vm.runInContext(code, sandbox) };
}

t('F1 新建版本面板「全选」即时生效（存在无提交候选）：复选框勾选 / 计数 / commit 下拉解禁同步，跳过 toast 同时保留', async () => {
  const h = setup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  // 初始：0 勾选、计数 0、有提交行 commit 下拉禁用、无提交行禁用并标注
  assert.match(h.inner(), /已选 0 项/, '初始计数 0');
  assert.doesNotMatch(h.inner(), new RegExp(`data-pick="createPanel" data-item="${R1}" checked`), '初始无勾选');
  assert.match(h.inner(), new RegExp(`data-panel="createPanel" data-item="${R1}" disabled`), '初始 commit 下拉禁用');
  // 点「全选」→ DOM 立即同步
  h.click('#bldPickAll');
  const after = h.inner();
  assert.match(after, new RegExp(`data-pick="createPanel" data-item="${R1}" checked`), '有提交行复选框立即勾选');
  assert.match(after, /已选 1 项/, '计数立即更新');
  assert.doesNotMatch(after, new RegExp(`data-panel="createPanel" data-item="${R1}" disabled`), '勾选行 commit 下拉解禁');
  assert.match(after, new RegExp(`data-pick="createPanel" data-item="${R2}" disabled`), '无提交行复选框仍禁用');
  assert.match(after, /暂无关联提交/, '无提交行保留标注');
  assert.doesNotMatch(after, new RegExp(R3), '非 done 条目不渲染');
  assert.ok(h.toasts.some((x) => x.m.includes('已全选有 commit 候选的条目') && x.m.includes('1 个条目暂无关联提交已跳过')),
    `跳过提示与渲染同时生效：${JSON.stringify(h.toasts)}`);
});

t('F2 新建版本面板「全不选」即时生效：复选框清空 / 计数归零 / commit 下拉恢复禁用', async () => {
  const h = setup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  h.click('#bldPickAll');
  assert.match(h.inner(), /已选 1 项/, '前置：全选后计数 1');
  // 点「全不选」→ DOM 立即清空（含无提交候选构成）
  h.click('#bldPickNone');
  const after = h.inner();
  assert.match(after, /已选 0 项/, '计数立即归零');
  assert.doesNotMatch(after, new RegExp(`data-pick="createPanel" data-item="${R1}" checked`), '复选框立即清空');
  assert.match(after, new RegExp(`data-panel="createPanel" data-item="${R1}" disabled`), 'commit 下拉恢复禁用');
  assert.doesNotMatch(after, new RegExp(`data-pick="createPanel" data-item="${R2}" checked`), '无提交行从未被勾选');
});

t('F3 对照组（全部候选有提交）不回归：全选正常且无跳过 toast；全不选同样生效', async () => {
  const h = setup({ candidates: allCommittedCandidates() });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  h.click('#bldPickAll');
  const after = h.inner();
  assert.match(after, new RegExp(`data-pick="createPanel" data-item="${R1}" checked`), 'R1 勾选');
  assert.match(after, new RegExp(`data-pick="createPanel" data-item="${R3}" checked`), 'R3 勾选');
  assert.match(after, /已选 2 项/, '计数 2');
  assert.ok(!h.toasts.some((x) => x.m.includes('已跳过')), '无跳过 toast');
  h.click('#bldPickNone');
  const cleared = h.inner();
  assert.match(cleared, /已选 0 项/, '全不选后计数归零');
  assert.doesNotMatch(cleared, new RegExp(`data-pick="createPanel" data-item="${R1}" checked`), 'R1 清空');
  assert.doesNotMatch(cleared, new RegExp(`data-pick="createPanel" data-item="${R3}" checked`), 'R3 清空');
});

t('F4 添加条目面板同口径：全选 / 全不选 DOM 同步（共用同一代码路径）', async () => {
  const inVer = 'REQ-20260914-000'; // 已在本版本 → 不出现在候选
  const h = setup({ state: { versions: [ver('BLD-20260914-001', [{ itemId: inVer, commit: H1, title: '已在版本', mergedAt: null, mergeError: null }])] } });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openAddPanel()`);
  assert.match(h.inner(), /已选 0 项/, '初始计数 0');
  h.click('#bldPickAll');
  const after = h.inner();
  assert.match(after, new RegExp(`data-pick="addPanel" data-item="${R1}" checked`), '添加面板：有提交行立即勾选');
  assert.match(after, /已选 1 项/, '添加面板：计数立即更新');
  assert.doesNotMatch(after, new RegExp(`data-pick="addPanel" data-item="${inVer}"`), '已在本版本的条目不出现');
  h.click('#bldPickNone');
  const cleared = h.inner();
  assert.match(cleared, /已选 0 项/, '添加面板：全不选归零');
  assert.doesNotMatch(cleared, new RegExp(`data-pick="addPanel" data-item="${R1}" checked`), '添加面板：复选框清空');
});

t('F5 界面与提交一致：全选后提交内容即界面所示；全不选后提交被拦截且界面无勾选残留', async () => {
  const h = setup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  // 全选（界面已正确显示勾选）→ 直接提交成功，items 与界面显示一致
  h.click('#bldPickAll');
  assert.match(h.inner(), new RegExp(`data-pick="createPanel" data-item="${R1}" checked`), '提交前界面已显示勾选（所见）');
  h.click('#bldCreateBtn');
  await new Promise((r) => setTimeout(r, 10));
  const created = h.requests.find((x) => x.url.includes('/api/build/version') && x.method === 'POST');
  assert.ok(created, '应发起创建版本请求');
  assert.deepEqual(created.body.items, [{ itemId: R1, commit: H1 }], '提交内容与界面显示的勾选一致（含默认 commit）');
  assert.ok(h.toasts.some((x) => x.m === '✓ 版本计划已创建'), '创建成功 toast');
  // 重开面板：全选 → 全不选（界面归零）→ 提交被拦截且界面无勾选残留
  await h.run(`window.ATBBuild.openCreatePanel()`);
  h.click('#bldPickAll');
  h.click('#bldPickNone');
  h.click('#bldCreateBtn');
  await new Promise((r) => setTimeout(r, 10));
  const blocked = h.inner();
  assert.match(blocked, /请至少勾选一个条目（无关联 commit 的条目不可纳入版本）/, '零勾选提交被拦截');
  assert.doesNotMatch(blocked, new RegExp(`data-pick="createPanel" data-item="${R1}" checked`), '拦截时界面无勾选残留（所见即所交）');
  const posts = h.requests.filter((x) => x.url.includes('/api/build/version') && x.method === 'POST');
  assert.equal(posts.length, 1, '拦截路径不再发起提交');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
