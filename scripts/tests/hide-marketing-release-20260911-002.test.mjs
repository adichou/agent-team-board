#!/usr/bin/env node
// REQ-20260911-002 营销 / 发布模块暂态隐藏（非删除：数据与服务端零改动）—— 静态契约 + vm 行为测试。
// 用法：node scripts/tests/hide-marketing-release-20260911-002.test.mjs
// 覆盖条目 test-cases.md 的 M1–M7；既有断言口径同步 + npm test 全绿由全量回归承担。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
const itemDir = path.join(pluginRoot, 'docs', 'agent-team-board', 'requirements', 'REQ-20260911-002');
const designSrc = fs.readFileSync(path.join(itemDir, 'design.md'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 静态契约 ---------- */

t('M1 顶栏模块导航收敛：仅 需求/任务/设置；HIDDEN_VIEWS 单一开关扩展含 marketing / release；MODULE_SUB 两键移出', () => {
  const nav = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, '缺少模块导航');
  const order = [...nav[0].matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  // REQ-20260911-002：营销 / 发布入口暂态隐藏（恢复步骤见条目 design.md）；
  // 导航收敛为 需求/任务 + 末位设置（讨论 / 文件自 REQ-20260909-013 起已暂隐藏）
  assert.deepEqual(order, ['status', 'runs', 'settings'],
    '导航顺序应为 需求/任务 + 末位设置（营销与发布已暂隐藏）');
  assert.match(nav[0], /data-view="status"[^>]*>需求</, '需求入口保留');
  assert.match(nav[0], /data-view="runs"[^>]*>任务</, '任务入口保留');
  assert.match(nav[0], /<button[^>]*class="view-tab nav-extra"[^>]*data-view="settings"/, '设置保持行末辅助入口');
  assert.doesNotMatch(nav[0], /data-view="marketing"/, '导航不得残留「营销」入口（无空占位）');
  assert.doesNotMatch(nav[0], /data-view="release"/, '导航不得残留「发布」入口（无空占位）');
  // 单一开关扩展：同一 HIDDEN_VIEWS 集合新增 marketing / release（oncall / files 键保留）
  const m = app.match(/const HIDDEN_VIEWS = new Set\(\[[^\]]*\]\);/);
  assert.ok(m, 'app.js 应定义 HIDDEN_VIEWS 暂态隐藏开关');
  for (const key of ['oncall', 'files', 'marketing', 'release']) {
    assert.match(m[0], new RegExp(`'${key}'`), `开关应含 ${key}`);
  }
  const setV = app.match(/^(?:async )?function setView\(v\) \{[\s\S]*?^\}/m);
  assert.ok(setV, '缺少 setView 函数');
  assert.match(setV[0], /HIDDEN_VIEWS\.has\(v\)/, 'setView 应以开关兜底隐藏模块（旧深链/快照/残余入口统一回落）');
  // 副标题两键随入口移出（沿用 REQ-20260909-013 的 oncall / files 先例；恢复时按 design.md 加回）
  const sub = app.match(/const MODULE_SUB = \{[\s\S]*?\};/);
  assert.ok(sub, '应存在 MODULE_SUB');
  assert.doesNotMatch(sub[0], /marketing:\s*'/, 'marketing 副标题随 REQ-20260911-002 暂隐藏移出');
  assert.doesNotMatch(sub[0], /release:\s*'/, 'release 副标题随 REQ-20260911-002 暂隐藏移出');
});

t('M6 服务端与模块零改动：路由 / 源文件 / 容器 / 脚本引用 / 数据目录全部保留', () => {
  assert.match(serverSrc, /\/api\/marketing\//, '/api/marketing/* 路由注册保留');
  assert.match(serverSrc, /\/api\/release\//, '/api/release/* 路由注册保留');
  assert.match(serverSrc, /pathname === '\/api\/marketing\/state'/, '/api/marketing/state 路由保留');
  assert.match(serverSrc, /pathname === '\/api\/release\/state'/, '/api/release/state 路由保留');
  for (const f of ['marketing.js', 'release.js']) {
    assert.ok(fs.existsSync(path.join(webRoot, f)), `${f} 源文件保留（仅收敛入口，不删模块代码）`);
  }
  assert.match(html, /id="marketingView"/, '#marketingView 容器保留');
  assert.match(html, /id="releaseView"/, '#releaseView 容器保留');
  assert.match(html, /<script src="\/marketing\.js">/, 'index.html 引入 marketing.js');
  assert.match(html, /<script src="\/release\.js">/, 'index.html 引入 release.js');
  const docsRoot = path.join(pluginRoot, 'docs', 'agent-team-board');
  assert.ok(fs.existsSync(path.join(docsRoot, 'marketing')), 'marketing/ 数据目录保留');
  assert.ok(fs.existsSync(path.join(docsRoot, 'releases')), 'releases/ 数据目录保留');
});

t('M5 静态前置：快照恢复接缝保留——applyViewSnapshot 仍把 marketing / release 子状态交给模块暂存（不做破坏性清理）', () => {
  const fn = app.match(/^(?:async )?function applyViewSnapshot\(snap\) \{[\s\S]*?^\}/m);
  assert.ok(fn, '缺少 applyViewSnapshot 函数');
  assert.match(fn[0], /snap\.marketing[\s\S]{0,120}ATBMarketing\?\.restoreView/, 'marketing 快照子状态仍委托暂存');
  assert.match(fn[0], /snap\.release[\s\S]{0,120}ATBRelease\?\.restoreView/, 'release 快照子状态仍委托暂存');
});

t('M7 暂态可逆：恢复步骤完整记录于条目 design.md（开关两键 + 两个导航按钮 + MODULE_SUB 两键）', () => {
  assert.match(designSrc, /## 恢复步骤/, 'design.md 应含恢复步骤章节');
  assert.match(designSrc, /HIDDEN_VIEWS[\s\S]{0,80}marketing[\s\S]{0,80}release/, '恢复步骤应覆盖开关移除 marketing / release 两键');
  assert.match(designSrc, /data-view="marketing"/, '恢复步骤应含营销导航按钮还原口径');
  assert.match(designSrc, /data-view="release"/, '恢复步骤应含发布导航按钮还原口径');
  // 副标题恢复口径：营销文案 + 发布通用文案（BUG-20260911-002 溯源不回退）
  assert.match(designSrc, /marketing:\s*'项目营销档案：定位、证据与定价版本'/, '恢复步骤应记录 marketing 副标题原文');
  assert.match(designSrc, /release:\s*'构建与发布流程：预检 → 计划确认 → 执行 → 核验'/, '恢复步骤应记录 release 通用副标题原文');
});

/* ---------- 行为测试（vm 全量加载 app.js，boot 即跑） ---------- */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => (on ? classes.add(v) : classes.delete(v)),
    },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {},
    closest() { return null; },
  };
}

const INITIALLY_HIDDEN = [
  '#reqView', '#board', '#emptyState', '#filterBar', '#fileView', '#oncallView',
  '#oncallLightbox', '#runsView', '#marketingView', '#releaseView', '#settingsView',
  '#modalWrap', '#mask',,
  '#holdPanel',
];

const item = (id, extra = {}) => ({
  id, type: id.startsWith('BUG') ? 'bug' : 'requirement', status: 'submitted', title: `标题 ${id}`,
  docs: ['README.md', 'design.md', 'test-cases.md'],
  createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z', ...extra,
});

function setup({ search = '', snapshot = null } = {}) {
  const document = element();
  document.createElement = element;
  for (const sel of INITIALLY_HIDDEN) document.querySelector(sel).classList.add('hidden');
  const board = {
    initialized: true, projectRoot: '/project/a', dataDir: '/project/a/docs/agent-team-board',
    items: [item('REQ-20990101-001', { status: 'accepted' }), item('BUG-20990101-002')],
  };
  const requests = [];
  const notices = [];
  const urlWrites = [];
  const store = new Map();
  if (snapshot) store.set('atb.viewstate:/project/a', JSON.stringify(snapshot));
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const sandbox = {
    document, URLSearchParams, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    location: { pathname: '/', search },
    history: { replaceState: (s, t, url) => urlWrites.push(String(url)) },
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage,
    addEventListener() {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    marked: { parse: (s) => String(s || '') },
    hljs: { highlightElement() {} },
    fetch: async (url) => {
      const u = String(url);
      const up = new URL(u, 'http://local');
      requests.push(u);
      if (u.includes('/api/health')) return { ok: true, json: async () => ({ projects: ['/project/a'], defaultProject: '/project/a' }) };
      if (u.includes('/api/board')) return { ok: true, json: async () => JSON.parse(JSON.stringify(board)) };
      if (u.includes('/api/dispatch/pending')) return { ok: true, json: async () => ({ count: 0, items: [] }) };
      if (u.includes('/api/search')) return { ok: true, json: async () => ({ items: [], docs: [], files: [] }) };
      if (up.pathname.startsWith('/api/item/') && up.pathname.includes('/doc/')) return { ok: true, json: async () => ({ content: '# 文档' }) };
      if (up.pathname.startsWith('/api/item/')) {
        const id = decodeURIComponent(up.pathname.split('/api/item/')[1]);
        const it = board.items.find((x) => x.id === id);
        if (it) return { ok: true, json: async () => JSON.parse(JSON.stringify(it)) };
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: '条目不存在' }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(app, sandbox, { filename: 'app.js' }); // 模块求值即触发 boot()
  const run = (code) => vm.runInContext(code, sandbox);
  sandbox.__notice = (message) => notices.push({ message });
  run('toast = __notice;');
  const dom = (sel) => document.querySelector(sel);
  async function waitBoot() {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (run('state.board !== null')) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('boot() 未在时限内写入看板数据');
  }
  return { sandbox, document, run, dom, requests, notices, urlWrites, waitBoot };
}

const hitMkt = (rs) => rs.some((u) => u.includes('/api/marketing/'));
const hitRel = (rs) => rs.some((u) => u.includes('/api/release/'));

t('M2 旧深链回落：?view=marketing / ?view=release 打开刷新均回落需求模块，URL view 参数被清理，无两模块请求', async () => {
  for (const deep of ['marketing', 'release']) {
    const h = setup({ search: `?project=%2Fproject%2Fa&view=${deep}` });
    await h.waitBoot();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(h.run('state.view'), 'status', `?view=${deep} 应回落需求模块（无空白视图）`);
    assert.equal(h.dom('#reqView').classList.contains('hidden'), false, '回落后需求工作区可见');
    assert.equal(h.dom('#marketingView').classList.contains('hidden'), true, '营销视图容器保持隐藏');
    assert.equal(h.dom('#releaseView').classList.contains('hidden'), true, '发布视图容器保持隐藏');
    const lastUrl = h.urlWrites.at(-1) || '';
    assert.ok(lastUrl.includes('project='), '回落重写应保留 project 等与模块无关的参数');
    assert.ok(!lastUrl.includes('view='), `URL 的 view 参数应被清理（最后写入：${lastUrl}）`);
    assert.ok(h.notices.some((n) => /隐藏|回到需求/.test(n.message)), '回落应给出一次性提示');
    assert.equal(hitMkt(h.requests), false, '回落过程不应请求 /api/marketing/*');
    assert.equal(hitRel(h.requests), false, '回落过程不应请求 /api/release/*');
  }
});

t('M3 setView 兜底：直接切入隐藏模块亦回落需求模块并提示；未隐藏模块切换不受影响', async () => {
  const h = setup();
  await h.waitBoot();
  h.run("setView('marketing')");
  assert.equal(h.run('state.view'), 'status', "setView('marketing') 应回落 status");
  assert.equal(h.dom('#marketingView').classList.contains('hidden'), true, '营销视图容器保持隐藏');
  h.run("setView('release')");
  assert.equal(h.run('state.view'), 'status', "setView('release') 应回落 status");
  assert.equal(h.dom('#releaseView').classList.contains('hidden'), true, '发布视图容器保持隐藏');
  assert.ok(h.notices.some((n) => /隐藏|回到需求/.test(n.message)), '回落应有 toast 提示');
  // 未隐藏模块照常切换（不回归）
  h.run("setView('runs')");
  assert.equal(h.run('state.view'), 'runs', '任务模块切换不受影响');
  h.run("setView('settings')");
  assert.equal(h.run('state.view'), 'settings', '设置模块切换不受影响');
  h.run("setView('status')");
  assert.equal(h.run('state.view'), 'status', '切回需求模块正常');
});

t('M4 零网络请求：boot 与主轮询链路全程不出现 /api/marketing/* 与 /api/release/*', async () => {
  const h = setup();
  await h.waitBoot();
  h.requests.length = 0;
  await h.run('poll()'); // 主轮询链路不得补发营销 / 发布请求
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(hitMkt(h.requests), false, '不得请求 /api/marketing/*（含 /api/marketing/state）');
  assert.equal(hitRel(h.requests), false, '不得请求 /api/release/*（含 /api/release/state）');
});

t('M5 快照兜底：snap.view 为 marketing / release 时刷新回落需求模块，子状态不被破坏性清理', async () => {
  for (const view of ['marketing', 'release']) {
    const h = setup({
      snapshot: {
        v: 1, view,
        reqFilter: 'accepted', searchQ: '', drawer: null, batchMode: 'refine', batchPane: 'overview',
        refinePane: 'overview', commitPane: 'overview',
        globalStatus: 'all', globalKind: 'all', globalQ: '',
        oncall: null,
        marketing: view === 'marketing' ? { tab: 'positioning', view: 'v2' } : null,
        release: view === 'release' ? { tab: 'logs', targetFilter: 'git', statusFilter: 'running', runId: 'run-1' } : null,
        files: null,
      },
    });
    await h.waitBoot();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(h.run('state.view'), 'status', `快照 view=${view} 刷新应回落需求模块（不得恢复进入隐藏模块）`);
    assert.equal(h.dom('#marketingView').classList.contains('hidden'), true, '营销视图容器保持隐藏');
    assert.equal(h.dom('#releaseView').classList.contains('hidden'), true, '发布视图容器保持隐藏');
    assert.ok(h.notices.some((n) => /隐藏|回到需求/.test(n.message)), '回落应给出一次性提示');
    assert.equal(hitMkt(h.requests), false, '快照回落不应请求 /api/marketing/*');
    assert.equal(hitRel(h.requests), false, '快照回落不应请求 /api/release/*');
    // 不做破坏性清理：回落经 saveViewSnapshot 正常重写——marketing / release 键仍在快照 schema 中
    // （不删键、不做版本迁移；子状态随正常浏览按现状机制自然重建，沿用 REQ-20260909-013 口径）
    const snapRaw = h.run(`sessionStorage.getItem(${JSON.stringify('atb.viewstate:/project/a')})`);
    const snap = JSON.parse(snapRaw);
    assert.ok('marketing' in snap, '回落重写快照仍保留 marketing 键（schema 不做破坏性清理）');
    assert.ok('release' in snap, '回落重写快照仍保留 release 键（schema 不做破坏性清理）');
    assert.equal(snap.view, 'status', '回落重写快照的 view 收敛为 status');
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
