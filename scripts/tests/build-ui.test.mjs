#!/usr/bin/env node
// REQ-20260913-001 构建模块（版本管理）—— 前端契约 + 行为测试 N1~N8。
// N1~N6 静态契约（index.html / app.js / i18n）；N7 vm 行为（加载实际 build.js，
// fetch stub 返回 state / candidates 汇总）；N8 i18n 词典覆盖。
// 用法：node scripts/tests/build-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 静态契约 ---------- */

t('N1 顶栏导航：页签顺序 需求→构建→任务→设置；「构建」按钮插在 status 与 runs 之间', () => {
  const nav = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, '缺少模块导航');
  const order = [...nav[0].matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['status', 'build', 'runs', 'settings'], '导航顺序应为 需求/构建/任务 + 末位设置');
  assert.match(nav[0], /data-view="build"[^>]*>构建</, '构建入口文案');
  const iStatus = nav[0].indexOf('data-view="status"');
  const iBuild = nav[0].indexOf('data-view="build"');
  const iRuns = nav[0].indexOf('data-view="runs"');
  assert.ok(iStatus < iBuild && iBuild < iRuns, '构建按钮应在需求与任务之间');
  assert.match(nav[0], /class="view-tab" data-view="build"/, '构建默认不激活（需求保持默认激活）');
});

t('N2 app.js：VIEWS 含 build（需求与任务之间）；setView 支持 build 容器显隐与 enter；隐藏模块兜底不回退', () => {
  const views = app.match(/const VIEWS = \[[^\]]*\];/);
  assert.ok(views, '应存在 VIEWS');
  assert.match(views[0], /'build'/, 'VIEWS 应含 build');
  const seq = views[0].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));
  assert.ok(seq.indexOf('status') < seq.indexOf('build') && seq.indexOf('build') < seq.indexOf('runs'),
    'VIEWS 序列中 build 应位于 status 与 runs 之间（既有序列兼容）');
  for (const k of ['oncall', 'runs', 'files', 'marketing', 'release', 'settings']) {
    assert.match(views[0], new RegExp(`'${k}'`), `VIEWS 既有序列保留 ${k}`);
  }
  const hidden = app.match(/const HIDDEN_VIEWS = new Set\(\[[^\]]*\]\);/);
  assert.ok(hidden, '应存在 HIDDEN_VIEWS');
  assert.doesNotMatch(hidden[0], /'build'/, 'build 不在隐藏集合');
  for (const k of ['oncall', 'files', 'marketing', 'release']) {
    assert.match(hidden[0], new RegExp(`'${k}'`), `隐藏集合保留 ${k}`);
  }
  const setV = app.match(/^(?:async )?function setView\(v\) \{[\s\S]*?^\}/m);
  assert.ok(setV, '缺少 setView 函数');
  assert.match(setV[0], /#buildView/, 'setView 应切换 #buildView 显隐');
  assert.match(setV[0], /ATBBuild\?\.enter/, 'setView 进入 build 时应调用 ATBBuild.enter');
});

t('N3 静态：#buildView 容器 + build.js 引用（app.js 之前加载）+ app.js 快照与搜索接线', () => {
  assert.match(html, /<section id="buildView" class="build-view hidden"[^>]*>/, '应有 #buildView 容器且初始 hidden');
  const iBuild = html.indexOf('<script src="/build.js">');
  const iApp = html.indexOf('<script src="/app.js">');
  assert.ok(iBuild !== -1 && iBuild < iApp, 'build.js 应在 app.js 之前加载');
  assert.match(app, /build:\s*window\.ATBBuild\?\.snapshot\?\.\(\) \|\| null/, '快照应保存 build 子状态');
  assert.match(app, /snap\.build[\s\S]{0,120}ATBBuild\?\.restoreView/, '快照恢复应委托 ATBBuild.restoreView');
  assert.match(app, /ATBBuild\?\.setQuery/, '模块搜索应接 ATBBuild.setQuery');
  const sub = app.match(/const MODULE_SUB = \{[\s\S]*?\};/);
  assert.match(sub[0], /build:\s*'/, 'MODULE_SUB 应含 build 副标题');
  const scope = app.match(/const SEARCH_SCOPE = \{[\s\S]*?\};/);
  assert.match(scope[0], /build:\s*'构建'/, 'SEARCH_SCOPE 应含 build=构建');
  const ph = app.match(/const SEARCH_PLACEHOLDER = \{[\s\S]*?\};/);
  assert.match(ph[0], /build:\s*'/, 'SEARCH_PLACEHOLDER 应含 build 占位符');
});

/* ---------- vm 行为（build.js） ---------- */

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

function statePayload(over = {}) {
  return {
    initialized: true,
    isRepo: true,
    currentBranch: 'dev',
    versions: [
      { id: 'BLD-20260913-001', name: 'v1.0', description: '首个版本', status: 'draft', targetBranch: 'main',
        items: [{ itemId: 'REQ-20260913-001', commit: H1, title: '演示需求', mergedAt: null, mergeError: null }],
        createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z', merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' } },
    ],
    ...over,
  };
}

function candidatesPayload() {
  return {
    items: [
      { itemId: 'REQ-20260913-001', title: '演示需求', status: 'done', commits: [H1] },
      { itemId: 'REQ-20260913-002', title: '无提交需求', status: 'done', commits: [] },
      // BUG-20260913-001：后端已收窄为仅 done；保留非 done 条目验证前端防御过滤
      { itemId: 'REQ-20260913-003', title: '开发中需求', status: 'in-progress', commits: [H2] },
    ],
  };
}

function setup({ state = statePayload(), candidates = candidatesPayload() } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const requests = [];
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url, opts) => {
      const u = String(url);
      const up = new URL(u, 'http://local');
      requests.push({ url: u, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => JSON.parse(JSON.stringify(candidates)) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, requests, run: (code) => vm.runInContext(code, sandbox) };
}

t('N7a build.js 挂载与 state 渲染：版本列表 + 状态 chip + 空态 + 非 git 引导', async () => {
  const h = setup();
  assert.ok(h.run('window.ATBBuild'), '应挂载 window.ATBBuild');
  await h.run(`window.ATBBuild.enter('/p/a')`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner, /v1\.0/, '版本名渲染');
  assert.match(inner, /REQ-20260913-001/, '关联单渲染');
  assert.match(inner, /计划中/, '状态 chip 文案');
  assert.match(inner, /版本计划/, '子页签渲染');
  assert.match(inner, /分支浏览/, '子页签渲染');
  // 空态
  const h2 = setup({ state: statePayload({ versions: [] }) });
  await h2.run(`window.ATBBuild.enter('/p/a')`);
  assert.match(h2.run(`document.querySelector('#buildView').innerHTML`), /暂无版本计划/, '空版本列表引导');
  // 非 git 引导
  const h3 = setup({ state: statePayload({ isRepo: false, versions: [] }) });
  await h3.run(`window.ATBBuild.enter('/p/a')`);
  const inner3 = h3.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner3, /不是 git 仓库|初始化/, '非 git 给引导空态');
  assert.doesNotMatch(inner3, /id="bldNewBtn"/, '非 git 不出现创建入口');
});

t('N7b 创建面板：候选仅 done 条目（BUG-20260913-001）；全选只纳入有 commit 候选的条目；无 commit 条目标注且不可选', async () => {
  const h = setup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner, /新建版本/, '新建版本面板渲染');
  assert.match(inner, /无提交需求/, '无 commit 条目仍列出');
  assert.match(inner, /暂无关联提交/, '无 commit 明确提示');
  assert.doesNotMatch(inner, /开发中需求/, '非 done 条目不渲染（前端防御过滤）');
  const selectable = h.run(`window.ATBBuild.selectableCandidates(window.ATBBuild.getCandidates())`);
  assert.deepEqual(selectable.map((x) => x.itemId), ['REQ-20260913-001'], '全选口径=仅纳入有 commit 候选的条目');
});

t('N7c 回填解析：标准回答解析出名称与描述；缺名称报错保留原文', () => {
  const h = setup();
  const good = JSON.parse(JSON.stringify(h.run(`window.ATBBuild.parseAnswer(${JSON.stringify('版本名称：v2.0 发布\n版本描述：\n包含分支同步与合并。')})`)));
  assert.deepEqual(good, { ok: true, name: 'v2.0 发布', description: '包含分支同步与合并。' });
  const bad = h.run(`window.ATBBuild.parseAnswer(${JSON.stringify('我不知道你要什么')})`);
  assert.equal(bad.ok, false);
  assert.ok(bad.error && bad.error.length > 0, '解析失败有明确报错');
  const noDesc = h.run(`window.ATBBuild.parseAnswer(${JSON.stringify('版本名称：v3')})`);
  assert.equal(noDesc.ok, true);
  assert.equal(noDesc.name, 'v3');
});

t('N7d 分支浏览渲染：当前/本地/远端分组与提交记录', async () => {
  const st = statePayload();
  const h = setup({
    state: st,
    candidates: candidatesPayload(),
  });
  h.sandbox.__branches = {
    isRepo: true, current: 'dev', local: ['dev', 'main'], remote: ['origin/dev'],
  };
  h.sandbox.fetch = async (url, opts) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(st)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') {
      return { ok: true, json: async () => ({ commits: [{ hash: H1, short: H1.slice(0, 7), subject: 'feat: 演示需求 REQ-20260913-001', author: 'T', date: '2026-09-13T01:00:00.000Z' }] }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner, /dev/, '当前分支渲染');
  assert.match(inner, /当前/, '当前分支标识');
  assert.match(inner, /origin\/dev/, '远端分支渲染');
  h.run(`window.ATBBuild.selectBranch('dev')`);
  await new Promise((r) => setTimeout(r, 10));
  const inner2 = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner2, /feat: 演示需求 REQ-20260913-001/, '提交说明渲染');
  assert.match(inner2, new RegExp(H1.slice(0, 7)), '短 hash 渲染');
});

/* ---------- N8 i18n ---------- */

t('N8 i18n 词典：构建页签与模块副标题等新增键入 EN 词典', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应暴露 ATBI18N');
  const { EN } = I._dict;
  assert.equal(EN['构建'], 'Build');
  assert.ok(EN['版本计划与分支，集中在这里'], '模块副标题词条');
  assert.ok(EN['搜版本 / 单号 / 分支…'], '搜索占位符词条');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
