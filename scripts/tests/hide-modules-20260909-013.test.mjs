#!/usr/bin/env node
// REQ-20260909-013 隐藏文件模块（暂态隐藏「讨论」「文件」入口，不删功能）—— 静态契约 + vm 行为测试。
// 用法：node scripts/tests/hide-modules-20260909-013.test.mjs
// 覆盖条目 test-cases.md 的 H1–H9；H10（既有断言口径同步 + npm test 全绿）由全量回归承担。

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
const bannerJs = fs.readFileSync(path.join(webRoot, 'banner.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(src, name) {
  const m = src.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

/* ---------- 静态契约 ---------- */

t('H1 顶栏模块导航收敛：仅 需求/任务/设置，无「讨论」「文件」按钮与空占位', () => {
  const nav = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, '缺少模块导航');
  const order = [...nav[0].matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  // REQ-20260909-013：暂态隐藏 oncall/files；
  // REQ-20260911-002：营销 / 发布入口同口径暂态隐藏（口径锁定见 hide-marketing-release-20260911-002.test.mjs）；
  // 恢复时按各条目 design.md「恢复步骤」加回 <button data-view>
  assert.deepEqual(order, ['status', 'runs', 'settings'],
    '导航顺序应为 需求/任务 + 末位设置（讨论 / 文件 / 营销 / 发布已暂隐藏）');
  assert.match(nav[0], /data-view="status"[^>]*>需求</, '需求入口保留');
  assert.doesNotMatch(nav[0], /data-view="oncall"/, '导航不得残留「讨论」入口');
  assert.doesNotMatch(nav[0], /data-view="files"/, '导航不得残留「文件」入口');
  assert.doesNotMatch(nav[0], /data-view="marketing"/, '「营销」入口随 REQ-20260911-002 暂态隐藏（隐藏范围后续单扩展）');
  assert.doesNotMatch(nav[0], /data-view="release"/, '「发布」入口随 REQ-20260911-002 暂态隐藏（隐藏范围后续单扩展）');
});

t('H4 统一新建「类型」仅 需求（REQ）/ Bug（BUG）两项；表单其余结构不受影响', () => {
  const modal = html.match(/<div id="modalWrap"[\s\S]*?<\/form>/);
  assert.ok(modal, '缺少统一新建表单');
  const typeSel = modal[0].match(/<select id="fType">[\s\S]*?<\/select>/);
  assert.ok(typeSel, '缺少类型下拉');
  assert.match(typeSel[0], /<option value="req">需求（REQ）<\/option>/, '保留需求类型');
  assert.match(typeSel[0], /<option value="bug">Bug（BUG）<\/option>/, '保留 Bug 类型');
  assert.equal((typeSel[0].match(/<option/g) || []).length, 2, '类型下拉应只剩两项');
  assert.doesNotMatch(modal[0], /value="ask"/, '「讨论（ASK）」选项应随入口隐藏移除（裁定见 design.md 待确认 2）');
  // 不回归：截图区块（REQ-20260909-009）与两枚提交按钮保留
  assert.match(modal[0], /id="fShotRow"/, '截图区块保留');
  assert.match(modal[0], /id="fSubmitAccept"/, '「创建并接受」按钮保留');
  assert.match(modal[0], /id="fSubmit"[^>]*>创建</, '「创建」按钮保留');
});

t('H9a 暂态可逆：收敛点为单一 HIDDEN_VIEWS 开关，含 oncall 与 files 两键', () => {
  const m = app.match(/const HIDDEN_VIEWS = [^\n]+;/);
  assert.ok(m, 'app.js 应定义 HIDDEN_VIEWS 暂态隐藏开关（恢复入口见条目 design.md）');
  assert.match(m[0], /'oncall'/, '开关应含 oncall（讨论）');
  assert.match(m[0], /'files'/, '开关应含 files（文件）');
  // 各收敛点均以开关门控（而非删除机制）
  const setV = fnSrc(app, 'setView');
  assert.match(setV, /HIDDEN_VIEWS\.has\(v\)/, 'setView 应以开关兜底隐藏模块（旧深链/快照/残余入口统一回落）');
});

t('H9b 服务端零改动：讨论 / 文档讨论 / 文件读取路由仍注册，数据目录保留', () => {
  assert.match(serverSrc, /pathname === '\/api\/oncall\/tickets'/, '/api/oncall/tickets 路由保留');
  assert.match(serverSrc, /pathname === '\/api\/req-disc'/, '/api/req-disc 路由保留');
  assert.match(serverSrc, /pathname === '\/api\/fs'/, '/api/fs 文件读取路由保留（文件读取能力不因模块隐藏禁用）');
  const docsRoot = path.join(pluginRoot, 'docs', 'agent-team-board');
  assert.ok(fs.existsSync(path.join(docsRoot, 'discussions')), 'discussions/ 数据目录保留');
  assert.ok(fs.existsSync(path.join(docsRoot, 'oncall')), 'oncall/ 数据目录保留');
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
  '#oncallLightbox', '#runsView', '#settingsView', '#modalWrap', '#mask',,
  '#holdPanel',
];

const item = (id, extra = {}) => ({
  id, type: id.startsWith('BUG') ? 'bug' : 'requirement', status: 'submitted', title: `标题 ${id}`,
  docs: ['README.md', 'design.md', 'test-cases.md'],
  createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z', ...extra,
});

function setup({ search = '' } = {}) {
  const document = element();
  document.createElement = element;
  for (const sel of INITIALLY_HIDDEN) document.querySelector(sel).classList.add('hidden');
  const board = {
    initialized: true, projectRoot: '/project/a', dataDir: '/project/a/docs/agent-team-board',
    items: [
      item('REQ-20990101-001', {
        status: 'accepted',
        sourceDiscussion: { id: 'DISC-20990909-001' }, // 旧绑定来源讨论（隐藏口径：整行不渲染）
        bugs: [item('BUG-20990101-002')], bugCount: 1, openBugCount: 1,
      }),
      item('BUG-20990101-002'),
    ],
  };
  const requests = [];
  const notices = [];
  const urlWrites = [];
  const sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
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
  sandbox.window = sandbox; // banner.js 挂 window.ATBBanner；app.js 读 window.*（含可选链）
  vm.createContext(sandbox);
  vm.runInContext(bannerJs, sandbox, { filename: 'banner.js' });
  vm.runInContext(app, sandbox, { filename: 'app.js' }); // 模块求值即触发 boot()
  const run = (code) => vm.runInContext(code, sandbox);
  sandbox.__notice = (message, error) => notices.push({ message, error });
  run('toast = __notice;'); // 回落提示走 toast 桩记录
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

t('H2 旧深链回落：?view=oncall / ?view=files 打开刷新均回落需求模块，URL view 参数被清理', async () => {
  for (const deep of ['oncall', 'files']) {
    const h = setup({ search: `?project=%2Fproject%2Fa&view=${deep}` });
    await h.waitBoot();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(h.run('state.view'), 'status', `?view=${deep} 应回落需求模块（无空白视图）`);
    assert.equal(h.dom('#reqView').classList.contains('hidden'), false, '回落后需求工作区可见');
    const lastUrl = h.urlWrites.at(-1) || '';
    assert.ok(lastUrl.includes('project='), '回落重写应保留 project 等与模块无关的参数');
    assert.ok(!lastUrl.includes('view='), `URL 的 view 参数应被清理（最后写入：${lastUrl}）`);
    assert.ok(h.notices.some((n) => /隐藏|回到需求/.test(n.message)), '回落应给出一次性提示');
    assert.equal(h.requests.some((u) => u.includes('/api/discussion/board')), false, '回落过程不应拉取讨论模块数据');
  }
});

t('H3 setView 兜底：直接切入隐藏模块亦回落需求模块并提示；正常模块切换不受影响', async () => {
  const h = setup();
  await h.waitBoot();
  h.run("setView('oncall')");
  assert.equal(h.run('state.view'), 'status', "setView('oncall') 应回落 status");
  assert.equal(h.dom('#oncallView').classList.contains('hidden'), true, '讨论视图容器保持隐藏');
  h.run("setView('files')");
  assert.equal(h.run('state.view'), 'status', "setView('files') 应回落 status");
  assert.ok(h.notices.some((n) => /隐藏|回到需求/.test(n.message)), '回落应有 toast 提示');
  // 未隐藏模块照常切换（不回归）
  h.run("setView('runs')");
  assert.equal(h.run('state.view'), 'runs', '任务模块切换不受影响');
  h.run("setView('status')");
  assert.equal(h.run('state.view'), 'status', '切回需求模块正常');
});

t('H5 详情抽屉收敛：无「讨论纪要」页签与分区、无「来源讨论」行；其余 meta 与下属 Bug 列表不受影响', async () => {
  const h = setup();
  await h.waitBoot();
  await h.run("openDrawer('REQ-20990101-001')");
  const drawerHtml = h.dom('#drawer').innerHTML;
  assert.ok(drawerHtml.includes('data-tab="info"'), '基本信息页签保留');
  assert.ok(drawerHtml.includes('基本信息'), '页签行保留「基本信息」');
  assert.ok(!drawerHtml.includes('讨论纪要'), '「讨论纪要」页签不应再渲染');
  assert.ok(!drawerHtml.includes('data-pane="disc"'), '讨论纪要分区不应再渲染');
  assert.ok(!drawerHtml.includes('data-tab="disc"'), '页签按钮不应残留');
  assert.ok(!drawerHtml.includes('来源讨论'), 'meta-grid 不应再展示「来源讨论」行（裁定见 design.md 待确认 3）');
  assert.ok(!drawerHtml.includes('DISC-20990909-001'), '来源讨论编号不应露出（底层数据字段保留）');
  assert.ok(drawerHtml.includes('认领者') && drawerHtml.includes('创建'), '其余 meta 字段不受影响');
  assert.ok(drawerHtml.includes('下属 Bug'), '下属 Bug 列表不受影响');
  // 文档页签与失效回落机制不回归（REQ-20260909-006）
  assert.ok(drawerHtml.includes('data-tab="README.md"') || drawerHtml.includes('drawerDocTabs'), '文档页签保留');
});

t('H6 打开需求详情后零讨论请求：不再发起 /api/oncall/tickets 与 /api/req-disc', async () => {
  const h = setup();
  await h.waitBoot();
  h.requests.length = 0;
  await h.run("openDrawer('REQ-20990101-001')");
  await new Promise((r) => setTimeout(r, 30));
  await h.run('poll()'); // 主轮询链路同样不得补发讨论请求
  assert.equal(h.requests.some((u) => u.includes('/api/oncall/tickets')), false, '不得请求 /api/oncall/tickets');
  assert.equal(h.requests.some((u) => u.includes('/api/req-disc')), false, '不得请求 /api/req-disc');
});

t('H7 页签失效回落：隐藏态 disc 页签无效，激活 / 恢复 tab=disc 回落基本信息', async () => {
  const h = setup();
  await h.waitBoot();
  await h.run("openDrawer('REQ-20990101-001')");
  h.run("activateDrawerTab('disc')");
  assert.equal(h.run('state.drawer.tab'), 'info', '激活已隐藏页签应回落 info（会话内不残留指向已隐藏页签的激活态）');
  // 静态口径：drawerTabValid 依赖开关判定
  const hiddenConst = app.match(/const HIDDEN_VIEWS = [^\n]+;/);
  assert.ok(hiddenConst, '缺少 HIDDEN_VIEWS 开关');
  const consts = app.match(/const DRAWER_TAB_LABEL = \{[\s\S]*?\};\s*\nconst DRAWER_FIXED_DOC_TABS = \[[^\]]*\];/);
  assert.ok(consts, '应存在页签常量定义');
  const src = `${hiddenConst[0]}\n${consts[0]}\n${fnSrc(app, 'drawerDocTabs')}\n${fnSrc(app, 'drawerTabValid')}\n__r = [drawerTabValid('disc', { docs: [] }), drawerTabValid('info', {}), drawerTabValid('README.md', { docs: ['README.md'] })];`;
  const sandbox = { __r: null };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.deepEqual([...sandbox.__r], [false, true, true], 'disc 无效；info 与存在文档页签仍有效');
});

t('H8 搜索间接入口：需求视图反馈条不再渲染「在文件查看」跨模块入口', async () => {
  const h = setup();
  await h.waitBoot();
  h.run("Object.assign(state.search, { q: 'kw', resQ: 'kw', res: { items: [], docs: [], files: [{ path: 'docs/intro.md' }] } })");
  const out = h.run('renderDocHits()');
  assert.ok(!out.includes('data-goto-view="files"'), '不应再渲染进入文件模块的跨模块入口');
  assert.ok(!out.includes('在文件查看'), '「在文件查看」文案不应出现');
  assert.ok(out.includes('条目') && out.includes('文档'), '条目 / 文档分组保留（需求搜索不回归）');
  // 恢复口径：返回需求入口（data-goto-view="status"）与通用绑定保留
  assert.match(app, /data-goto-view="status"/, '文件视图「在需求查看」返回入口模板保留（恢复即生效）');
  assert.match(fnSrc(app, 'renderSearchFeedback'), /data-goto-view\]/, '跨模块入口通用绑定保留');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
