#!/usr/bin/env node
// REQ-20260910-001：app 场景 Cmd+R 刷新后回到刷新前的界面。
// 行为测试：vm 全量加载 app.js（模块求值即 boot()），sessionStorage 桩跨「刷新」保留，
// 模拟整页重载 = 同一 storage 下重新求值 app.js；断言各模块浏览状态按快照恢复与失效回落。
// 讨论模块恢复语义（O 组）：vm 加载 oncall.js，测 restoreView / snapshot / atb:oncall-state。
// 用法：node scripts/tests/refresh-restore-20260910-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const webRoot = new URL('../web/', import.meta.url);
const app = fs.readFileSync(new URL('app.js', webRoot), 'utf8');
const oncallJs = fs.readFileSync(new URL('oncall.js', webRoot), 'utf8');
const bannerJs = fs.readFileSync(new URL('banner.js', webRoot), 'utf8');
const electronDir = new URL('../../electron/', import.meta.url);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const item = (id, extra = {}) => ({
  id, type: id.startsWith('BUG') ? 'bug' : 'requirement', status: 'submitted', title: `标题 ${id}`,
  docs: ['README.md', 'design.md', 'test-cases.md'],
  createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z', ...extra,
});

// sessionStorage 桩：同一对象跨多次 setup（模拟刷新）传递 = 会话级存储
function sessionStorageStub() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

// DOM 接缝：与 index.html 初始态一致（refresh-default-view.test.mjs 同法，补 closest）
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
  '#reqView', '#board', '#emptyState', '#filterBar', '#docHits', '#fileView', '#oncallView',
  '#oncallLightbox', '#runsView', '#settingsView', '#modalWrap', '#mask',,
  '#holdPanel',
];

const FILE_VIEWER_FALLBACK_HINT = '刷新前查看的文件已不存在';

function defaultBoard() {
  return {
    initialized: true, projectRoot: '/project/a', dataDir: '/project/a/docs/agent-team-board',
    items: [item('REQ-20990101-001', { status: 'done' }), item('BUG-20990101-002')],
  };
}

// app.js 行为沙箱。sessionStorage 由调用方注入（跨刷新共享）；fs/item 路由可覆写。
function setup({
  search = '', sessionStorage = sessionStorageStub(), board = defaultBoard(),
  fs = { '': { entries: [{ name: 'README.md', dir: false }, { name: 'docs', dir: true }] },
         docs: { entries: [{ name: 'agent-team-board', dir: true }, { name: 'intro.md', dir: false }] } },
  discussionDetail = null, batchCurrent = null,
} = {}) {
  const document = element();
  document.createElement = element;
  for (const sel of INITIALLY_HIDDEN) document.querySelector(sel).classList.add('hidden');
  const requests = [];
  const windowListeners = {};
  const sandbox = {
    document, URLSearchParams, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    location: { pathname: '/', search }, history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage,
    addEventListener: (ev, fn) => { windowListeners[ev] = fn; },
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
      if (up.pathname === '/api/fs') {
        const p = up.searchParams.get('path') ?? '';
        if (fs[p]) return { ok: true, json: async () => JSON.parse(JSON.stringify(fs[p])) };
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: '目录不存在' }) };
      }
      if (up.pathname === '/api/fs/file') return { ok: true, json: async () => ({ content: '# 内容\n正文', path: '' }) };
      if (up.pathname.startsWith('/api/item/') && up.pathname.includes('/doc/')) return { ok: true, json: async () => ({ content: `# 文档 ${u}` }) };
      if (up.pathname.startsWith('/api/item/')) {
        const id = decodeURIComponent(up.pathname.split('/api/item/')[1]);
        const it = board.items.find((x) => x.id === id);
        if (it) return { ok: true, json: async () => JSON.parse(JSON.stringify(it)) };
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: '条目不存在' }) };
      }
      if (up.pathname.startsWith('/api/discussion/')) {
        if (discussionDetail) return { ok: true, json: async () => ({ discussion: discussionDetail }) };
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: '讨论不存在' }) };
      }
      if (up.pathname === '/api/batch/current' && batchCurrent) {
        return { ok: true, json: async () => JSON.parse(JSON.stringify(batchCurrent)) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox; // banner.js 挂 window.ATBBanner；app.js 读 window.*（含可选链）
  vm.createContext(sandbox);
  vm.runInContext(bannerJs, sandbox, { filename: 'banner.js' });
  vm.runInContext(app, sandbox, { filename: 'app.js' }); // 模块求值即触发 boot()
  const run = (code) => vm.runInContext(code, sandbox);
  const dom = (sel) => document.querySelector(sel);
  return { sandbox, document, run, dom, requests, windowListeners, sessionStorage };
}

async function waitUntil(fn, ms = 2000, what = '条件') {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`等待超时：${what}`);
}

async function waitBoot(h) {
  await waitUntil(() => h.run('state.board !== null'), 2000, 'boot() 写入看板数据');
  await new Promise((r) => setTimeout(r, 30)); // boot 后续异步（恢复/setView）微任务推进
}

function putSnapshot(h, project, snap) {
  h.sessionStorage.setItem(`atb.viewstate:${project}`, JSON.stringify(snap));
}

/* ---------- R 组：app.js 刷新恢复行为 ---------- */

t('R1 需求模块恢复：筛选档 / 抽屉条目与页签 / 搜索词刷新后复原', async () => {
  const ss = sessionStorageStub();
  putSnapshot({ sessionStorage: ss }, '/project/a', {
    v: 1, view: 'status', reqFilter: 'done', searchQ: '看板',
    drawer: { id: 'REQ-20990101-001', tab: 'test-cases.md' },
    batchMode: 'refine', batchPane: 'overview', refinePane: 'overview', oncall: null, files: null,
  });
  const h = setup({ sessionStorage: ss });
  await waitBoot(h);
  await waitUntil(() => h.run("state.drawer.doc === 'test-cases.md'"), 2000, '抽屉文档页签恢复');
  await waitUntil(() => h.requests.some((u) => u.includes('/api/search?q=')), 2000, '搜索重新发起');
  assert.equal(h.run('state.view'), 'status', '仍在需求模块');
  assert.equal(h.run('state.reqFilter'), 'done', '筛选档应恢复为已完成');
  assert.equal(h.run('state.drawer.id'), 'REQ-20990101-001', '抽屉应重新打开同一条目');
  assert.equal(h.run('state.drawer.tab'), 'test-cases.md', '页签应恢复为测试用例');
  assert.equal(h.run('state.search.q'), '看板', '搜索词应恢复');
  assert.equal(h.dom('#searchInput').value, '看板', '搜索框应回填关键词');
});

t('R2 任务模块恢复：一级页签与两面板二级页签各自恢复、互不串扰', async () => {
  const ss = sessionStorageStub();
  putSnapshot({ sessionStorage: ss }, '/project/a', {
    v: 1, view: 'runs', reqFilter: 'submitted', searchQ: '',
    drawer: null, batchMode: 'develop', batchPane: 'records', refinePane: 'queue', oncall: null, files: null,
  });
  const h = setup({
    sessionStorage: ss,
    batchCurrent: { batch: { batchId: 'batch-20990909-001', status: 'running', createdAt: '2099-09-09T00:00:00.000Z', developer: 'dev' }, counts: {}, queue: [], pending: [], recordsTotal: 0, records: [] },
  });
  await waitBoot(h);
  await waitUntil(() => h.dom('#batchDrawer').innerHTML.includes('task-pane'), 2000, '任务面板渲染');
  assert.equal(h.run('state.view'), 'runs', '应恢复任务模块');
  assert.equal(h.run('state.batch.mode'), 'develop', '一级页签应恢复为批量开发');
  assert.equal(h.run('state.batch.pane'), 'records', '批量开发二级页签应恢复为记录');
  assert.equal(h.run('state.refine.pane'), 'queue', '批量完善二级页签应恢复为队列（独立记忆）');
  assert.match(h.dom('#batchDrawer').innerHTML, /data-task-pane="records"/, '应渲染「记录」页签钮');
  assert.match(h.dom('#batchDrawer').innerHTML, /class="task-pane" data-pane="records"/, '「记录」分区应处于激活（无 hidden）');
});

t('R3 文件恢复机制保留（REQ-20260909-013：文件模块入口暂隐藏，直接驱动内部链路验证机制未删）：横幅层栈与文件（含 md 源码态）恢复逻辑不变', async () => {
  const h = setup();
  await waitBoot(h);
  // 模拟 applyViewSnapshot 的文件暂存（隐藏态被门控跳过），直接驱动 initFileBoard 消费
  h.run("state.banner.restoredLayers = ['', 'docs']; state.banner.restoredFile = 'docs/intro.md'; state.banner.mdSource = true;");
  await h.run('initFileBoard()');
  await waitUntil(() => h.run("state.banner.activeFile === 'docs/intro.md'"), 2000, '恢复打开文件');
  assert.equal(h.run('JSON.stringify(state.banner.layers)'), JSON.stringify(['', 'docs']), '层栈应按暂存展开');
  assert.equal(h.run('state.banner.mdSource'), true, 'md 源码视图态应恢复');
  assert.ok(h.requests.some((u) => u.includes('/api/fs?') && u.includes('docs')), '应拉取 docs 层条目');
  assert.ok(h.requests.some((u) => u.includes('/api/fs/file')), '应重新拉取文件内容');
});

t('R4 讨论恢复接缝（REQ-20260909-013：讨论模块暂隐藏——隐藏态跳过落位不委托；restoreView 委托代码保留待恢复）', async () => {
  const ss = sessionStorageStub();
  const snapOncall = { filter: 'archived', selectedId: 'DISC-20990909-001', tab: 'minutes' };
  const snap = {
    v: 1, view: 'oncall', reqFilter: 'submitted', searchQ: '',
    drawer: null, batchMode: 'refine', batchPane: 'overview', refinePane: 'overview',
    oncall: snapOncall, files: null,
  };
  putSnapshot({ sessionStorage: ss }, '/project/a', snap);
  let restored = null;
  const h = setup({ sessionStorage: ss });
  await waitBoot(h); // boot 期间 setView('oncall') 经 HIDDEN_VIEWS 兜底回落 status
  assert.equal(h.run('state.view'), 'status', '快照 view=oncall 应回落需求模块');
  // 注入 fake ATBOncall 再手动走一次恢复路径：隐藏态不得委托（不发起讨论内部请求）
  h.sandbox.ATBOncall = {
    snapshot: () => snapOncall,
    restoreView: (s) => { restored = s; },
    setQuery() {}, poll: async () => {}, closeDrawer() {}, openItem() {}, reveal: async () => {},
  };
  await h.run('applyViewSnapshot(readViewSnapshot(state.project))');
  assert.equal(restored, null, '隐藏态不应委托恢复讨论浏览态');
  // 委托接缝保留：恢复 HIDDEN_VIEWS（移除 oncall）后即恢复原行为
  assert.match(app, /window\.ATBOncall\?\.restoreView\?\.\(snap\.oncall\)/, 'restoreView 委托代码保留');
  assert.match(app, /!HIDDEN_VIEWS\.has\('oncall'\)[^\n]*snap\.oncall/, '讨论快照落位由 HIDDEN_VIEWS 门控');
});

t('R5 需求抽屉失效回落：条目被删不打开抽屉、无报错；页签文档被删回落基本信息', async () => {
  const ss = sessionStorageStub();
  putSnapshot({ sessionStorage: ss }, '/project/a', {
    v: 1, view: 'status', reqFilter: 'submitted', searchQ: '',
    drawer: { id: 'REQ-20990101-099', tab: 'test-cases.md' },
    batchMode: 'refine', batchPane: 'overview', refinePane: 'overview', oncall: null, files: null,
  });
  const h = setup({ sessionStorage: ss });
  await waitBoot(h);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(h.run('state.drawer.id'), null, '条目已不存在：抽屉保持空态');
  assert.equal(h.dom('#toast').textContent, '', '不应弹错误 toast');

  // 页签失效：licenses.md 不在条目 docs 内 → 回落基本信息
  const ss2 = sessionStorageStub();
  putSnapshot({ sessionStorage: ss2 }, '/project/a', {
    v: 1, view: 'status', reqFilter: 'submitted', searchQ: '',
    drawer: { id: 'REQ-20990101-001', tab: 'licenses.md' },
    batchMode: 'refine', batchPane: 'overview', refinePane: 'overview', oncall: null, files: null,
  });
  const h2 = setup({ sessionStorage: ss2 });
  await waitBoot(h2);
  await waitUntil(() => h2.run('state.drawer.item !== null'), 2000, '抽屉条目加载');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h2.run('state.drawer.tab'), 'info', '失效文档页签应回落基本信息');
});

t('R6 文件失效回落机制保留（REQ-20260909-013：入口暂隐藏，直接驱动内部链路）：目录层失效停在最后有效层；文件被删回默认引导且不报错', async () => {
  const h = setup();
  await waitBoot(h);
  h.run("state.banner.restoredLayers = ['', 'docs', 'docs/gone']; state.banner.restoredFile = 'docs/missing.md'; state.banner.mdSource = false;");
  await h.run('initFileBoard()');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(h.run('JSON.stringify(state.banner.layers)'), JSON.stringify(['', 'docs']), '失效层应截断在最后有效层');
  assert.equal(h.run('state.banner.activeFile'), null, '被删文件不应置为当前文件');
  assert.ok(h.dom('#fileViewer').innerHTML.includes(FILE_VIEWER_FALLBACK_HINT), '查看器应回默认引导文案');
  assert.equal(h.requests.some((u) => u.includes('/api/fs/file')), false, '不应请求已删除文件');
});

t('R7 URL 深链优先：?view=runs 覆盖快照 view=oncall（深链能力不回归）；REQ-20260909-013：隐藏模块深链回落需求', async () => {
  const ss = sessionStorageStub();
  putSnapshot({ sessionStorage: ss }, '/project/a', {
    v: 1, view: 'oncall', reqFilter: 'accepted', searchQ: '',
    drawer: null, batchMode: 'refine', batchPane: 'overview', refinePane: 'overview', oncall: null, files: null,
  });
  const h = setup({ search: '?project=%2Fproject%2Fa&view=runs', sessionStorage: ss });
  await waitBoot(h);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.run('state.view'), 'runs', 'URL 深链模块应优先于快照模块');
  assert.equal(h.run('state.reqFilter'), 'accepted', '模块内筛选档仍按快照恢复');

  // 隐藏模块深链回落（REQ-20260909-013）：?view=files 不进入已隐藏模块
  const h2 = setup({ search: '?project=%2Fproject%2Fa&view=files', sessionStorage: ss });
  await waitBoot(h2);
  assert.equal(h2.run('state.view'), 'status', 'view=files 深链应回落需求模块');
});

t('R8 项目隔离：快照键按项目路径，项目 A 刷新不得恢复项目 B 的状态', async () => {
  const ss = sessionStorageStub();
  putSnapshot({ sessionStorage: ss }, '/project/b', {
    v: 1, view: 'runs', reqFilter: 'done', searchQ: '别个项目',
    drawer: { id: 'REQ-20990101-001', tab: 'design.md' },
    batchMode: 'develop', batchPane: 'prompt', refinePane: 'records', oncall: null, files: null,
  });
  const h = setup({ sessionStorage: ss });
  await waitBoot(h);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(h.run('state.view'), 'status', '无本项目快照：默认需求模块');
  assert.equal(h.run('state.reqFilter'), 'submitted', '筛选档保持默认待接受');
  assert.equal(h.run('state.drawer.id'), null, '不恢复他项目的抽屉');
  assert.equal(h.requests.some((u) => u.includes('/api/search')), false, '不恢复他项目搜索词');
});

t('R9 快照写入：模块/筛选/抽屉/页签/搜索/任务页签/目录/文件交互后即时落盘（REQ-20260909-013：切模块样本改用任务模块，文件链路直接驱动）', async () => {
  const h = setup();
  await waitBoot(h);
  const read = () => JSON.parse(h.sessionStorage.getItem('atb.viewstate:/project/a') || 'null');
  h.run("setView('runs')"); // 讨论 / 文件模块暂隐藏，切模块样本改用任务模块
  assert.equal(read().view, 'runs', '切模块应写入快照');
  h.run("state.reqFilter = 'done'; renderBoard(); saveViewSnapshot()");
  assert.equal(read().reqFilter, 'done', '筛选档应写入快照');
  await h.run("openDrawer('REQ-20990101-001')");
  assert.deepEqual(read().drawer, { id: 'REQ-20990101-001', tab: 'info' }, '打开抽屉应写入快照');
  h.run("activateDrawerTab('design.md')");
  assert.equal(read().drawer.tab, 'design.md', '切页签应写入快照');
  h.run("activateTaskPane('refine', 'queue')");
  assert.equal(read().refinePane, 'queue', '批量完善二级页签应写入快照');
  h.run("activateTaskPane('develop', 'prompt')");
  assert.equal(read().batchPane, 'prompt', '批量开发二级页签应写入快照');
  h.run('closeDrawer()');
  assert.equal(read().drawer, null, '关闭抽屉应清空快照 drawer');
  h.dom('#searchInput').value = '关键词';
  await h.run('runSearch()');
  assert.equal(read().searchQ, '关键词', '搜索词应写入快照');
  await h.run('initFileBoard()'); // 文件入口暂隐藏，直接初始化文件横幅验证快照写入链路
  await waitUntil(() => h.run('state.banner.layers.length >= 1'), 2000, '文件横幅默认初始化');
  await h.run("openDirLayer('docs')");
  await h.run("openFile('docs/intro.md', { source: true })");
  assert.deepEqual(read().files, { layers: ['', 'docs'], activeFile: 'docs/intro.md', mdSource: true }, '文件层栈与文件应写入快照');
  // 讨论状态事件 → app.js 落盘（fake ATBOncall 提供当前态；事件接缝保留，落盘不因模块隐藏失效）
  h.sandbox.ATBOncall = { snapshot: () => ({ filter: 'archived', selectedId: 'DISC-1', tab: 'minutes' }), restoreView() {}, poll: async () => {}, setQuery() {} };
  h.windowListeners['atb:oncall-state']?.();
  assert.deepEqual(read().oncall, { filter: 'archived', selectedId: 'DISC-1', tab: 'minutes' }, 'atb:oncall-state 事件应触发落盘');
});

t('R10 空快照 = 现状：无 sessionStorage 快照刷新回到默认初始界面', async () => {
  const h = setup();
  await waitBoot(h);
  assert.equal(h.run('state.view'), 'status', '默认需求模块');
  assert.equal(h.run('state.reqFilter'), 'submitted', '默认待接受档');
  assert.equal(h.run('state.drawer.id'), null, '抽屉空态');
  assert.equal(h.dom('#searchInput').value, '', '搜索清空');
});

t('R11 损坏快照容错：非法 JSON / 未知版本按无快照处理，boot 正常', async () => {
  for (const bad of ['not-json{', '{"v":99,"view":"runs"}']) {
    const ss = sessionStorageStub();
    ss.setItem('atb.viewstate:/project/a', bad);
    const h = setup({ sessionStorage: ss });
    await waitBoot(h);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(h.run('state.view'), 'status', `坏快照（${bad.slice(0, 12)}…）不应恢复模块`);
    assert.equal(h.run('state.reqFilter'), 'submitted', '坏快照不应恢复筛选档');
  }
});

t('R12 静态契约：sessionStorage 通道 + boot 恢复时序 + 深链优先 + electron 零改动', () => {
  assert.match(app, /atb\.viewstate:/, '快照键应含项目路径前缀 atb.viewstate:');
  assert.match(app, /sessionStorage\.getItem\(viewSnapshotStorageKey\(/, '读取应走 sessionStorage');
  assert.match(app, /sessionStorage\.setItem\(viewSnapshotStorageKey\(/, '写入应走 sessionStorage');
  const bootSeg = app.slice(app.indexOf('async function boot()'), app.indexOf('boot();'));
  assert.ok(bootSeg, '缺少 boot 函数');
  assert.match(bootSeg, /await poll\(\)[\s\S]*?applyViewSnapshot/, '恢复应发生在首轮 poll 之后（数据到位再判定失效回落）');
  assert.match(bootSeg, /if \(!viewParam\) viewParam = restored\.view/, '无 URL 深链时采用快照模块（深链优先于快照）');
  const electronSrc = ['main.mjs', 'service.mjs', 'shell-css.mjs']
    .map((f) => fs.readFileSync(new URL(f, electronDir), 'utf8')).join('');
  assert.ok(!electronSrc.includes('atb.viewstate'), 'electron/ 壳层不应参与快照（恢复由页面完成，壳层零改动）');
});

/* ---------- O 组：oncall.js 恢复语义（独立沙箱加载 oncall.js） ---------- */

function setupOncall({ detail = null, detailOk = true } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#oncallView', element());
  document.nodes.set('#ocList', element());
  document.nodes.set('#ocDetail', element());
  document.nodes.set('#discMask', element());
  document.nodes.set('#oncallLightbox', element());
  document.nodes.set('#toast', element());
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  document.addEventListener = () => {};
  const dispatched = [];
  const sandbox = {
    document, console, URLSearchParams,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    marked: { parse: (s) => String(s || '') },
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('/api/discussion/board')) {
        return { ok: true, json: async () => ({ initialized: true, discussions: [disc('DISC-20990909-001'), disc('DISC-20990909-002', { status: 'archived' })] }) };
      }
      if (u.includes('/api/discussion/')) {
        if (!detailOk) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: '讨论不存在' }) };
        return { ok: true, json: async () => ({ discussion: detail || discDetail('DISC-20990909-001') }) };
      }
      return { ok: true, json: async () => ({}) };
    },
    navigator: { clipboard: { writeText: async () => {} } },
    dispatchEvent: (e) => dispatched.push(e),
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(oncallJs, sandbox, { filename: 'oncall.js' });
  return { sandbox, document, dispatched };
}

const disc = (id, over = {}) => ({
  id, title: `t-${id}`, status: 'discussing', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T01:00:00.000Z',
  phase: 'none', draftCount: 0, createdCount: 0, ...over,
});
const discDetail = (id, over = {}) => ({ ...disc(id), startPrompt: 's', finishPrompt: 'f', created: [], candidates: [], legacyRounds: [], ...over });

t('O1 restoreView：落位筛选档与详情页签，详情拉取后渲染对应分区', async () => {
  const h = setupOncall();
  await h.sandbox.ATBOncall.restoreView({ filter: 'archived', selectedId: 'DISC-20990909-001', tab: 'minutes' });
  assert.equal(h.sandbox.ATBOncall.snapshot().filter, 'archived', '筛选档应恢复为已归档');
  assert.equal(h.sandbox.ATBOncall.snapshot().selectedId, 'DISC-20990909-001', '详情应恢复');
  const html = h.document.querySelector('#ocDetail').innerHTML;
  assert.match(html, /class="tab drawer-tab active"[^>]*data-tab="minutes"/, '纪要页签应处于激活态');
  assert.equal(h.document.querySelector('#ocDetail').classList.contains('has-item'), true, '详情栏应进入打开态');
});

t('O2 restoreView 非法值回落：filter 回 discussing、tab 回讨论纪要（REQ-20260910-018 三页签默认）', async () => {
  const h = setupOncall();
  await h.sandbox.ATBOncall.restoreView({ filter: 'bogus', selectedId: 'DISC-20990909-001', tab: 'bogus' });
  const snap = h.sandbox.ATBOncall.snapshot();
  assert.equal(snap.filter, 'discussing', '非法筛选档应回落讨论中');
  const html = h.document.querySelector('#ocDetail').innerHTML;
  assert.match(html, /class="tab drawer-tab active"[^>]*data-tab="minutes"/, '非法页签应回落讨论纪要（旧 overview/drafts/prompt 快照同回落）');
});

t('O3 restoreView 失效回落：讨论已删 → 静默回列表（无 toast、无未捕获错误）', async () => {
  const h = setupOncall({ detailOk: false });
  await h.sandbox.ATBOncall.restoreView({ filter: 'discussing', selectedId: 'DISC-GONE', tab: 'minutes' });
  assert.equal(h.sandbox.ATBOncall.snapshot().selectedId, null, '详情应被静默关闭');
  assert.equal(h.document.querySelector('#ocDetail').classList.contains('has-item'), false, '详情栏应退出打开态');
  assert.equal(h.document.querySelector('#toast')?.textContent ?? '', '', '不应弹错误 toast');
});

t('O4 状态变化事件：openItem / closeDetail 派发 atb:oncall-state；页签切换挂事件接缝', async () => {
  const h = setupOncall();
  await h.sandbox.ATBOncall.poll('/project/a', true); // 先渲染列表与视图骨架
  h.sandbox.ATBOncall.openItem('DISC-20990909-001');
  await new Promise((r) => setTimeout(r, 20));
  const opened = h.dispatched.filter((e) => e.type === 'atb:oncall-state').pop();
  assert.ok(opened, 'openItem 应派发 atb:oncall-state');
  assert.equal(opened.detail.selectedId, 'DISC-20990909-001', '事件应携带当前详情');
  h.sandbox.ATBOncall.closeDrawer(); // 导出入口（内部走 closeDetail）
  const closed = h.dispatched.filter((e) => e.type === 'atb:oncall-state').pop();
  assert.equal(closed.detail.selectedId, null, 'closeDetail 后事件应携带空详情');
  assert.match(oncallJs, /state\.tab = b\.dataset\.tab;\s*\n\s*renderDetail\(\);\s*\n\s*emitState\(\);/, '详情页签切换应同步派发状态事件');
  assert.match(app, /addEventListener\('atb:oncall-state'/, 'app.js 应监听讨论状态事件落盘');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
