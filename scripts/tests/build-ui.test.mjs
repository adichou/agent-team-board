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
    totalDone: 3,
    items: [
      { itemId: 'REQ-20260913-001', title: '演示需求', status: 'done', commits: [H1] },
      { itemId: 'REQ-20260913-002', title: '无提交需求', status: 'done', commits: [] },
      // BUG-20260913-001：后端已收窄为仅 done；保留非 done 条目验证前端防御过滤
      { itemId: 'REQ-20260913-003', title: '开发中需求', status: 'in-progress', commits: [H2] },
      // BUG-20260914-004：后端已收窄为未占用；保留已占用条目（state 中 BLD-20260913-001
      // 已纳入 REQ-20260913-001）验证前端防御过滤
      { itemId: 'REQ-20260913-004', title: '未占用有提交需求', status: 'done', commits: [H2] },
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

t('N7b 创建面板：候选仅 done 且未占用条目（BUG-20260913-001 / BUG-20260914-004）；全选只纳入有 commit 候选的条目；无 commit 条目标注且不可选', async () => {
  const h = setup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  const panel = inner.match(/<aside class="rel-panel"[^>]*aria-label="新建版本">[\s\S]*?<\/aside>/);
  assert.ok(panel, '新建版本面板应渲染');
  assert.match(panel[0], /无提交需求/, '无 commit 条目仍列出');
  assert.match(panel[0], /暂无关联提交/, '无 commit 明确提示');
  assert.doesNotMatch(panel[0], /开发中需求/, '非 done 条目不渲染（前端防御过滤）');
  assert.doesNotMatch(panel[0], /REQ-20260913-001/, '已纳入版本的条目不渲染（前端防御过滤，BUG-20260914-004）');
  const selectable = h.run(`window.ATBBuild.selectableCandidates(window.ATBBuild.getCandidates())`);
  assert.deepEqual(selectable.map((x) => x.itemId), ['REQ-20260913-004'], '全选口径=未占用 done 且有 commit 候选的条目');
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

/* ---------- N7e BUG-20260914-009 提交记录分页 ---------- */

t('N7e 提交记录分页：默认 50/offset 请求、页码与进度渲染、翻到末页、翻页失败保留旧内容可重试、切分支重置、每页条数切换、空分支无分页', async () => {
  const st = statePayload();
  const h = setup({ state: st, candidates: candidatesPayload() });
  h.sandbox.__branches = { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [] };
  h.sandbox.__logReqs = [];
  h.sandbox.__logFail = false;
  h.sandbox.__logTotal = 137;
  h.sandbox.fetch = async (url, opts) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(st)) };
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(h.sandbox.__branches)) };
    if (up.pathname === '/api/build/branch-log') {
      h.sandbox.__logReqs.push(up.pathname + up.search);
      if (h.sandbox.__logFail) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      const total = h.sandbox.__logTotal;
      if (total === 0) return { ok: true, json: async () => ({ branch: up.searchParams.get('branch'), commits: [], total: 0, limit: Number(up.searchParams.get('limit') || 50), offset: Number(up.searchParams.get('offset') || 0) }) };
      const limit = Number(up.searchParams.get('limit') || 50);
      const offset = Number(up.searchParams.get('offset') || 0);
      const n = Math.max(0, Math.min(limit, total - offset));
      const commits = Array.from({ length: n }, (_, i) => ({ hash: H1, short: H1.slice(0, 7), subject: `提交 ${offset + i + 1}`, author: 'T', date: '2026-09-13T01:00:00.000Z' }));
      return { ok: true, json: async () => ({ branch: up.searchParams.get('branch'), commits, total, limit, offset }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  const reqs = () => h.sandbox.__logReqs;
  const inner = () => h.run(`document.querySelector('#buildView').innerHTML`);

  // 首屏：请求带 limit/offset；分页条渲染页码 + 进度 + 上一页禁用；未到末页无「已到末尾」
  h.run(`window.ATBBuild.selectBranch('dev')`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(reqs().at(-1), /[?&]limit=50&offset=0/, '首屏请求 limit=50&offset=0');
  assert.match(inner(), /第 1–50 条 \/ 共 137 条/, '进度信息「第 1–50 条 / 共 137 条」');
  assert.match(inner(), /data-pg="2"/, '页码按钮渲染（共 3 页）');
  assert.match(inner(), /data-pg="prev" disabled/, '首页上一页禁用');
  assert.match(inner(), /aria-current="page"/, '当前页高亮标记');
  assert.doesNotMatch(inner(), /已到末尾/, '未到末页不出现末页反馈');

  // 翻页：offset 跟随页码；进度区间更新
  h.run(`window.ATBBuild.gotoLogPage(2)`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(reqs().at(-1), /[?&]limit=50&offset=50/, '第 2 页请求 offset=50');
  assert.match(inner(), /第 51–100 条 \/ 共 137 条/, '第 2 页进度区间');

  // 末页：区间收口、「已到末尾」反馈、下一页禁用（可翻至分支首个提交）
  h.run(`window.ATBBuild.gotoLogPage(3)`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(reqs().at(-1), /[?&]limit=50&offset=100/, '第 3 页请求 offset=100');
  assert.match(inner(), /第 101–137 条 \/ 共 137 条/, '末页进度区间收口');
  assert.match(inner(), /已到末尾 · 共 137 条提交/, '末页「已到末尾」反馈');
  assert.match(inner(), /data-pg="next" disabled/, '末页下一页禁用');

  // 翻页失败：保留已加载内容与页码，行内错误 + 重试入口；重试成功恢复
  h.sandbox.__logFail = true;
  h.run(`window.ATBBuild.gotoLogPage(1)`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(inner(), /第 101–137 条 \/ 共 137 条/, '翻页失败保留已加载页内容');
  assert.match(inner(), /提交记录读取失败：boom/, '行内错误信息');
  assert.match(inner(), /id="bldLogRetry"/, '失败提供重试按钮');
  h.sandbox.__logFail = false;
  h.run(`window.ATBBuild.retryLogPage()`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(inner(), /第 1–50 条 \/ 共 137 条/, '重试成功加载目标页');
  assert.doesNotMatch(inner(), /提交记录读取失败/, '错误条消失');

  // 切换分支重置回第一页
  h.run(`window.ATBBuild.gotoLogPage(2)`);
  await new Promise((r) => setTimeout(r, 10));
  h.run(`window.ATBBuild.selectBranch('main')`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(reqs().at(-1), /branch=main&limit=50&offset=0/, '切换分支重置回第一页');

  // 每页条数切换：回第一页并按新 limit 请求
  h.run(`window.ATBBuild.setLogPageSize(100)`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(reqs().at(-1), /[?&]limit=100&offset=0/, '每页条数切换按新 limit 从第一页请求');
  assert.match(inner(), /第 1–100 条 \/ 共 137 条/, '新每页条数进度区间');

  // 空分支：无分页控件
  h.sandbox.__logTotal = 0;
  h.run(`window.ATBBuild.selectBranch('dev')`);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(inner(), /该分支暂无提交/, '空分支提示保持');
  assert.doesNotMatch(inner(), /bld-log-pager/, '空分支不出分页控件');
});

t('N7f 分页静态契约：data-pg / 每页条数下拉 / 重试按钮在 bindCommon 绑定；分页条与末页反馈样式类存在', () => {
  assert.match(buildJs, /view\.querySelectorAll\('\[data-pg\]'\)/, 'bindCommon 循环绑定 data-pg 分页按钮');
  assert.match(buildJs, /#bldLogSize/, 'bindCommon 绑定每页条数下拉');
  assert.match(buildJs, /#bldLogRetry/, 'bindCommon 绑定翻页失败重试按钮');
  assert.match(buildJs, /bld-log-pager/, '渲染分页条容器类');
  assert.match(buildJs, /bld-log-eof/, '渲染末页反馈类');
  const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  assert.match(css, /\.bld-log-pager/, 'style.css 含分页条样式');
  assert.match(css, /\.bld-log-eof/, 'style.css 含末页反馈样式');
});

/* ---------- N9 REQ-20260913-004 版本删除 ---------- */

const ver = (id, name, status = 'draft') => ({
  id, name, description: '', status, targetBranch: 'main',
  items: [{ itemId: 'REQ-20260913-001', commit: H1, title: '演示需求', mergedAt: status === 'merged' ? '2026-09-13T03:00:00.000Z' : null, mergeError: null }],
  createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z', merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
});

t('N9a 版本卡片第三个操作键「删除」：quiet 弱化、位于合并键之后；merging 禁用 title；mergeBusy 全局禁用口径', async () => {
  const h = setup({ state: statePayload({ versions: [
    ver('BLD-20260913-001', 'v1.0', 'draft'),
    ver('BLD-20260913-002', 'v2.0', 'merging'),
    ver('BLD-20260913-003', 'v3.0', 'merged'),
    ver('BLD-20260913-004', 'v4.0', 'failed'),
  ] }) });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  const inner = h.run(`document.querySelector('#buildView').innerHTML`);
  for (const id of ['BLD-20260913-001', 'BLD-20260913-002', 'BLD-20260913-003', 'BLD-20260913-004']) {
    assert.match(inner, new RegExp(`data-ver-delete="${id}"`), `${id} 卡片应有删除键`);
    assert.match(inner, new RegExp(`aria-label="删除 ${id}"`), `${id} 删除键 aria-label 带版本号`);
  }
  // 顺序：AI 完善 → 合并入 main → 删除（同行 card-acts 末位，quiet 弱化不抢主操作）
  const card1 = inner.slice(inner.indexOf('data-ver-id="BLD-20260913-001"'), inner.indexOf('data-ver-id="BLD-20260913-002"'));
  const acts = card1.slice(card1.indexOf('card-acts'));
  const iAnswer = acts.indexOf('data-ver-answer');
  const iMerge = acts.indexOf('data-ver-merge');
  const iDel = acts.indexOf('data-ver-delete');
  assert.ok(iAnswer !== -1 && iMerge !== -1 && iDel !== -1 && iAnswer < iMerge && iMerge < iDel, '删除键应排在 AI 完善 / 合并入 main 之后');
  const delBtnHtml = acts.slice(acts.lastIndexOf('<button', iDel), acts.indexOf('</button>', iDel));
  assert.match(delBtnHtml, /btn small quiet/, '删除键为 quiet 弱化样式');
  assert.match(inner, />删除<\/button>/, '删除键文案');
  // 状态口径：merging 禁用；draft / merged / failed 可用
  assert.match(inner, /data-ver-delete="BLD-20260913-002" disabled title="合并中，不可删除"/, 'merging 卡片删除键禁用并提示');
  assert.match(inner, /data-ver-delete="BLD-20260913-001" aria-label/, 'draft 删除键可用');
  assert.match(inner, /data-ver-delete="BLD-20260913-003" aria-label/, 'merged 删除键可用');
  assert.match(inner, /data-ver-delete="BLD-20260913-004" aria-label/, 'failed 删除键可用');
  // 静态契约：mergeBusy 全局禁用口径覆盖删除键；按 data-ver-delete 循环绑定
  const listFn = buildJs.match(/function renderVersionList\(\) \{[\s\S]*?\n  \}/);
  assert.ok(listFn, '缺少 renderVersionList');
  assert.ok(listFn[0].includes('data-ver-delete'), 'renderVersionList 应渲染删除键');
  assert.ok(listFn[0].includes('state.mergeBusy'), 'mergeBusy 期间删除键应一并禁用');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-ver-delete\]'\)/, 'bindCommon 循环绑定 data-ver-delete');
});

t('N9b 删除确认弹窗：标题带版本号；正文列名称 / 状态 / 关联单数；状态差异化提示；弹窗打开期间不重复开其他删除', async () => {
  const h = setup({ state: statePayload({ versions: [
    ver('BLD-20260913-001', 'v1.0', 'draft'),
    ver('BLD-20260913-002', 'v2.0', 'merging'),
    ver('BLD-20260913-003', 'v3.0 已合并', 'merged'),
    ver('BLD-20260913-004', 'v4.0', 'failed'),
  ] }) });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  // draft：不可恢复提示
  h.run(`window.ATBBuild.openDeleteConfirm('BLD-20260913-001')`);
  let inner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(inner, /删除版本（BLD-20260913-001）/, '弹窗标题含版本编号');
  assert.match(inner, /v1\.0/, '正文列版本名称');
  assert.match(inner, /计划中/, '正文列状态');
  assert.match(inner, /1 个关联单/, '正文列关联单数');
  assert.match(inner, /删除后不可恢复/, 'draft 提示不可恢复');
  assert.match(inner, /重新纳入其他版本/, 'draft 提示条目可重新纳入');
  assert.doesNotMatch(inner, /仅删除看板版本记录/, 'draft 不出现 merged 专属提示');
  assert.match(inner, /id="bldDeleteCancel"/, '取消键');
  assert.match(inner, /id="bldDeleteGo"[^>]*class="btn danger"/, '确认删除为危险主样式');
  // 弹窗打开期间不可再触发其他删除
  h.run(`window.ATBBuild.openDeleteConfirm('BLD-20260913-003')`);
  assert.match(h.run(`document.querySelector('#buildView').innerHTML`), /删除版本（BLD-20260913-001）/, '弹窗未换目标（打开期间锁其他删除）');
  // merged：仅移除看板记录提示
  const h2 = setup({ state: statePayload({ versions: [ver('BLD-20260913-003', 'v3.0 已合并', 'merged')] }) });
  await h2.run(`window.ATBBuild.enter('/p/a')`);
  h2.run(`window.ATBBuild.openDeleteConfirm()`);
  const innerM = h2.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(innerM, /删除版本（BLD-20260913-003）/, 'merged 弹窗');
  assert.match(innerM, /仅删除看板版本记录/, 'merged 提示仅删看板记录');
  assert.match(innerM, /不影响已合并入 main/, 'merged 提示不影响已合并提交与代码');
  assert.doesNotMatch(innerM, /条目可重新纳入/, 'merged 不出现 draft 专属提示');
  // failed：与 draft 同口径（放弃计划）
  const h3 = setup({ state: statePayload({ versions: [ver('BLD-20260913-004', 'v4.0', 'failed')] }) });
  await h3.run(`window.ATBBuild.enter('/p/a')`);
  h3.run(`window.ATBBuild.openDeleteConfirm()`);
  const innerF = h3.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(innerF, /删除版本（BLD-20260913-004）/);
  assert.match(innerF, /删除后不可恢复/, 'failed 同 draft 不可恢复提示');
  // 不存在的版本号不弹窗
  const h4 = setup();
  await h4.run(`window.ATBBuild.enter('/p/a')`);
  h4.run(`window.ATBBuild.openDeleteConfirm('BLD-NOPE')`);
  assert.doesNotMatch(h4.run(`document.querySelector('#buildView').innerHTML`), /删除版本（/, '不存在的版本号不弹窗');
});

t('N9c 删除执行流：执行期间确认键禁用防重复；成功 toast + 列表移除 + 选中回落 / 空态；失败 toast + 版本保留可重试', async () => {
  // 两版本：删最新选中项后回落另一版本；再删光验证空态
  const st = {
    initialized: true, isRepo: true, currentBranch: 'dev',
    versions: [ver('BLD-20260913-002', 'v2.0', 'draft'), ver('BLD-20260913-001', 'v1.0', 'draft')],
  };
  const h = setup({ state: st });
  const toasts = [];
  h.sandbox.toast = (m, isErr) => toasts.push({ m, isErr });
  const live = { versions: JSON.parse(JSON.stringify(st.versions)) };
  const deleted = [];
  let gate = null;
  h.sandbox.fetch = async (url, opts) => {
    const u = new URL(String(url), 'http://local');
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: JSON.parse(JSON.stringify(live.versions)) }) };
    if (u.pathname === '/api/build/version/delete') {
      const body = JSON.parse(opts.body || '{}');
      deleted.push(body);
      if (gate) await gate;
      live.versions = live.versions.filter((v) => v.id !== body.id);
      return { ok: true, json: async () => ({ ok: true, id: body.id }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  await h.run(`window.ATBBuild.enter('/p/a')`);
  assert.match(h.run(`document.querySelector('#buildView').innerHTML`), /rel-card sel" data-ver-id="BLD-20260913-002"/, '初始选中最新 v2.0');
  // 弹窗 → 确认删除（门闸暂停在途，验证执行中按钮禁用）
  h.run(`window.ATBBuild.openDeleteConfirm('BLD-20260913-002')`);
  let release;
  gate = new Promise((res) => { release = res; });
  const p = h.run(`window.ATBBuild.doDelete()`);
  const busyInner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.match(busyInner, /删除版本（BLD-20260913-002）/, '执行期间弹窗保持展示');
  assert.match(busyInner, /id="bldDeleteGo" disabled/, '执行期间确认删除禁用');
  assert.match(busyInner, /删除中…/, '确认键显示进行中状态');
  release();
  await p;
  let inner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.ok(toasts.some((x) => x.m === '✓ 已删除版本（BLD-20260913-002）'), '成功 toast：✓ 已删除版本（<id>）');
  assert.doesNotMatch(inner, /删除版本（BLD-20260913-002）/, '成功后关闭弹窗');
  assert.doesNotMatch(inner, /data-ver-id="BLD-20260913-002"/, '卡片从列表移除');
  assert.match(inner, /rel-card sel" data-ver-id="BLD-20260913-001"/, '被删为选中版本时详情回落列表最新');
  assert.deepEqual(deleted.map((b) => b.id), ['BLD-20260913-002'], '删除请求携带版本号且只发一次');
  // 删最后一个版本 → 空态回落
  h.run(`window.ATBBuild.openDeleteConfirm('BLD-20260913-001')`);
  await h.run(`window.ATBBuild.doDelete()`);
  inner = h.run(`document.querySelector('#buildView').innerHTML`);
  assert.ok(toasts.some((x) => x.m === '✓ 已删除版本（BLD-20260913-001）'), '第二个删除成功 toast');
  assert.match(inner, /暂无版本计划/, '列表为空显示既有空态文案');
  assert.match(inner, /点击左侧版本查看详情/, '详情回落空态');
  // 失败流：删除报错 → ✕ toast、弹窗关闭、版本保留、可重试
  const hf = setup({ state: statePayload() });
  const toastsF = [];
  hf.sandbox.toast = (m, isErr) => toastsF.push({ m, isErr });
  hf.sandbox.fetch = async (url) => {
    const u = new URL(String(url), 'http://local');
    if (u.pathname === '/api/build/version/delete') {
      return { ok: false, status: 409, json: async () => ({ error: '版本合并中，不可删除，请等合并结束后再删' }) };
    }
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(statePayload())) };
    return { ok: true, json: async () => ({}) };
  };
  await hf.run(`window.ATBBuild.enter('/p/a')`);
  hf.run(`window.ATBBuild.openDeleteConfirm('BLD-20260913-001')`);
  await hf.run(`window.ATBBuild.doDelete()`);
  const innerF = hf.run(`document.querySelector('#buildView').innerHTML`);
  assert.ok(toastsF.some((x) => x.isErr === true && x.m.includes('✕ 删除失败：') && x.m.includes('版本合并中')), `失败 toast 应为 ✕ 删除失败：<原因>：${JSON.stringify(toastsF)}`);
  assert.doesNotMatch(innerF, /删除版本（BLD-20260913-001）/, '失败后关闭弹窗');
  assert.match(innerF, /data-ver-id="BLD-20260913-001"/, '失败后版本仍留在列表');
  hf.run(`window.ATBBuild.openDeleteConfirm('BLD-20260913-001')`);
  assert.match(hf.run(`document.querySelector('#buildView').innerHTML`), /删除版本（BLD-20260913-001）/, '失败后可重试（再次打开弹窗）');
});



t('N8 i18n 词典：构建页签与模块副标题等新增键入 EN 词典', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应暴露 ATBI18N');
  const { EN } = I._dict;
  assert.equal(EN['构建'], 'Build');
  assert.ok(EN['版本计划与分支，集中在这里'], '模块副标题词条');
  assert.ok(EN['搜版本 / 单号 / 分支…'], '搜索占位符词条');
});

t('N9d i18n 词典：版本删除相关新文案入 EN / EN_DYNAMIC（值无中文、无重复值）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['删除', '确认删除', '合并中，不可删除']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  for (const k of ['删除版本（◇）', '✓ 已删除版本（◇）', '✕ 删除失败：◇']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
  const values = Object.values(EN);
  for (const k of ['删除', '确认删除', '合并中，不可删除']) {
    assert.equal(values.filter((v) => v === EN[k]).length, 1, `EN 值唯一（无重复）：${k}`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
