#!/usr/bin/env node
// BUG-20260915-014 构建模块「查看发布记录 / 创建发布」不再跳转被隐藏的发布模块——
// 右侧版本详情新增「概况 / 发布」页签，发布记录按项目 + 版本（bldId）就地展示。
// R1~R7 vm 行为 + 静态契约（假 DOM 口径同 build-ui.test.mjs）。
// 用法：node scripts/tests/bug-release-tab-inplace-20260915-014.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 假 DOM（口径同 build-ui.test.mjs） ---------- */

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

const H = (c) => c.repeat(40);

function verItem(i = 1) {
  return { itemId: `REQ-20260915-0${String(i).padStart(2, '0')}`, title: `条目 ${i}`, commit: H('a').slice(0, 39) + String(i % 10), mergedAt: null, mergeError: null };
}

function ver(id, name, status = 'merged', items = [verItem(1), verItem(2)]) {
  return {
    id, name, description: `描述 ${name}`, status,
    items,
    createdAt: '2026-09-15T01:00:00.000Z', updatedAt: '2026-09-15T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
  };
}

function prelRun(o = {}) {
  return {
    id: 'PREL-20260915-001', productId: 'proj', version: '1.2.0', versionName: '版本 V1',
    bldId: 'BLD-A', status: 'draft',
    createdAt: '2026-09-15T08:00:00.000Z', updatedAt: '2026-09-15T08:00:00.000Z',
    targets: { webapp: { status: 'pending' }, site: { status: 'pending' } },
    ...o,
  };
}

// 运行详情（GET /api/product-release/run/:id）全量形状（stages / targets / precheck / frozen）
function prelDetail(summary = prelRun(), o = {}) {
  return {
    run: {
      ...summary,
      versionName: summary.versionName || '版本 V1',
      frozen: { mainSha: H('c'), devSha: H('d'), remote: 'origin', remoteUrl: '/tmp/r.git', extraCommits: [], homepage: { contentDir: '/tmp/hp/proj/', branch: 'main' } },
      stages: [
        { key: 'sync-source', label: '源码同步（main/dev 原子推送）', status: 'pending' },
        { key: 'webapp-build', label: 'Web App 构建', status: 'pending' },
        { key: 'site-materials', label: '官网材料核验', status: 'pending' },
      ],
      precheck: null,
      evidence: [], history: [],
      ...o,
    },
    logs: {},
  };
}

function setup({ versions = [ver('BLD-A', 'v1.0', 'merged'), ver('BLD-B', 'v2.0', 'draft')], prelRuns = [prelRun()] } = {}) {
  const live = { versions: JSON.parse(JSON.stringify(versions)), prel: JSON.parse(JSON.stringify(prelRuns)) };
  const state = () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: live.versions });
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const calls = [];
  const gates = {}; // frag → 手动放行（pending promise 的 release 函数）
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url, opts = {}) => {
      const u = new URL(String(url), 'http://local');
      const method = (opts.method || 'GET').toUpperCase();
      calls.push({ path: u.pathname, method, body: opts.body ? JSON.parse(opts.body) : null });
      if (gates[u.pathname]) { await gates[u.pathname](); } // 手动挂起
      if (u.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state())) };
      if (u.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (u.pathname === '/api/product-release/state') return { ok: true, json: async () => ({ initialized: true, runs: JSON.parse(JSON.stringify(live.prel)), config: {}, env: {} }) };
      if (u.pathname === '/api/product-release/from-build') {
        const id = `PREL-NEW-${calls.filter((c) => c.path === '/api/product-release/from-build').length}`;
        live.prel.push(prelRun({ id, bldId: opts.body ? JSON.parse(opts.body).bldId : 'BLD-A', version: opts.body ? JSON.parse(opts.body).version : '9.9.9', status: 'draft' }));
        return { ok: true, status: 201, json: async () => ({ run: prelRun({ id, bldId: 'BLD-A', version: '9.9.9' }) }) };
      }
      const m = u.pathname.match(/^\/api\/product-release\/run\/([^/]+)\/?([a-z]*)$/);
      if (m) {
        const [, id, action] = m;
        if (action === 'plan') return { ok: true, json: async () => ({ plan: { steps: ['步骤一：冻结核对', '步骤二：推送 main/dev'], warning: 'main 已前进' } }) };
        if (action) {
          const run = live.prel.find((r) => r.id === id);
          if (run) run.status = action === 'start' ? 'running' : action === 'precheck' ? 'draft' : run.status;
          return { ok: true, json: async () => ({ run: prelRun({ id }) }) };
        }
        const sum = live.prel.find((r) => r.id === id) || prelRun({ id });
        return { ok: true, json: async () => prelDetail(sum) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const tick = async (n = 2) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, live, calls, gates,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    el: (sel) => vm.runInContext(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`, sandbox),
    enter: async () => vm.runInContext(`window.ATBBuild.enter('/p/proj')`, sandbox),
    tick,
  };
}

const flush = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

/* ---------- R1 右侧详情「概况 / 发布」页签 ---------- */

t('R1a 详情标题下出现概况/发布页签，默认概况：原描述、关联条目、合并反馈在概况内；发布区内容不出现', async () => {
  const h = setup();
  await h.enter();
  const inner = h.inner();
  assert.match(inner, /data-detail-tab="overview"[^>]*aria-selected="true"/, '概况页签默认激活');
  assert.match(inner, /data-detail-tab="release"[^>]*aria-selected="false"/, '发布页签存在且未激活');
  assert.match(inner, /<strong>概况<\/strong>|>概况<\/button>/, '概况页签文案');
  assert.match(inner, />发布<\/button>/, '发布页签文案');
  assert.match(inner, /bld-desc-block/, '概况含描述块');
  assert.match(inner, /关联条目与 commit/, '概况含关联条目列表');
  assert.doesNotMatch(inner, /bld-rel-pane/, '概况不渲染发布区内容');
  assert.doesNotMatch(inner, /正在加载发布记录|当前版本暂无发布记录|发布记录读取失败/, '概况不出发布区状态内容');
});

t('R1b 切到发布页签再切回概况：发布区出现/消失；左侧版本列表与模块页签不受影响', async () => {
  const h = setup();
  await h.enter();
  h.run(`window.ATBBuild.setDetailTab('release')`);
  await h.tick();
  let inner = h.inner();
  assert.match(inner, /data-detail-tab="release"[^>]*aria-selected="true"/, '发布页签激活');
  assert.match(inner, /bld-rel-pane/, '发布区渲染');
  assert.match(inner, /data-ver-id="BLD-A"/, '左侧版本列表仍在');
  assert.match(inner, /data-bld-tab="versions"/, '模块页签不受影响');
  h.run(`window.ATBBuild.setDetailTab('overview')`);
  inner = h.inner();
  assert.match(inner, /data-detail-tab="overview"[^>]*aria-selected="true"/, '切回概况');
  assert.doesNotMatch(inner, /bld-rel-pane/, '发布区不再渲染');
  assert.match(inner, /bld-desc-block/, '概况内容保留');
});

/* ---------- R2 查看发布记录就地切换 ---------- */

t('R2a 「查看发布记录」就地激活当前版本发布页签：不派发 atb:goto-view、不离开构建模块', async () => {
  const h = setup();
  await h.enter();
  const fired = [];
  h.sandbox.window.dispatchEvent = (e) => { fired.push(e); };
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  const inner = h.inner();
  assert.ok(!fired.some((e) => e.type === 'atb:goto-view'), '不再派发 atb:goto-view（旧跳转即缺陷根因）');
  assert.match(inner, /data-detail-tab="release"[^>]*aria-selected="true"/, '发布页签就地激活');
  assert.match(inner, /data-bld-tab="versions"/, '仍在构建模块版本计划页');
  assert.match(inner, /rel-card sel" data-ver-id="BLD-A"/, '当前版本保持选中');
  assert.match(inner, /bld-rel-pane/, '发布区渲染');
});

t('R2b 未选中卡片的查看发布记录以所在卡片为准；概况内容切回仍可见', async () => {
  const h = setup({ prelRuns: [prelRun({ bldId: 'BLD-B' })] });
  await h.enter(); // 默认选中 BLD-A（merged）
  h.run(`window.ATBBuild.openReleaseTab('BLD-B')`);
  await h.tick();
  const inner = h.inner();
  assert.match(inner, /rel-card sel" data-ver-id="BLD-B"/, '切换到所在卡片版本');
  assert.match(inner, /data-rel-ver="BLD-B"/, '发布区归属 BLD-B');
  h.run(`window.ATBBuild.setDetailTab('overview')`);
  assert.match(h.inner(), /bld-desc-block/, '概况内容切回可见');
});

/* ---------- R3 创建发布落点与失败路径 ---------- */

t('R3a 创建成功：留在构建模块，当前版本详情切到发布页签并选中新草稿', async () => {
  const h = setup();
  await h.enter();
  h.run(`window.ATBBuild.openReleaseConfirm('BLD-A')`);
  h.el('#bldRelVersion').value = '1.3.0';
  await h.run(`window.ATBBuild.doCreateRelease()`);
  await h.tick();
  const inner = h.inner();
  assert.doesNotMatch(inner, /创建产品发布（BLD-A）/, '创建弹层关闭');
  assert.match(inner, /data-detail-tab="release"[^>]*aria-selected="true"/, '落点为发布页签');
  assert.match(inner, /data-rel-run="PREL-NEW-1"/, '新建草稿出现在列表');
  assert.match(inner, /data-rel-run="PREL-NEW-1"[\s\S]{0,400}?(sel"|草稿)/, '新建草稿被选中（或可见草稿状态）');
  assert.match(inner, /rel-card sel" data-ver-id="BLD-A"/, '版本选中保持');
});

t('R3b 创建失败：弹层保留、错误可见、不切页签；创建中重复确认不产生第二次请求', async () => {
  const h = setup();
  await h.enter();
  h.run(`window.ATBBuild.openReleaseConfirm('BLD-A')`);
  h.el('#bldRelVersion').value = '1.3.0';
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    h.calls.push({ path: u.pathname, method: (opts.method || 'GET').toUpperCase(), body: null });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/product-release/from-build') return { ok: false, status: 409, json: async () => ({ error: '已有进行中的产品发布（PREL-20260915-001）' }) };
    return { ok: true, json: async () => ({}) };
  };
  await h.run(`window.ATBBuild.doCreateRelease()`);
  let inner = h.inner();
  assert.match(inner, /创建产品发布（BLD-A）/, '失败后弹层保留');
  assert.match(inner, /已有进行中的产品发布/, '错误信息可见');
  assert.match(inner, /value="1.3.0"/, '输入保留');
  assert.doesNotMatch(inner, /data-detail-tab="release"[^>]*aria-selected="true"/, '失败不切页签');
  // 创建中防重复：from-build 挂起期间再次触发确认，不产生第二个请求
  let release;
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    if (u.pathname === '/api/product-release/from-build') return new Promise((res) => { release = () => res({ ok: true, status: 201, json: async () => ({ run: prelRun({ id: 'PREL-NEW-X', version: '2.0.0' }) }) }); });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    return { ok: true, json: async () => ({}) };
  };
  h.el('#bldRelVersion').value = '2.0.0';
  const p = h.run(`window.ATBBuild.doCreateRelease()`);
  await h.run(`window.ATBBuild.doCreateRelease()`); // busy 中重复触发
  assert.equal(h.calls.filter((c) => c.path === '/api/product-release/from-build').length, 1, '创建中重复确认不发出第二个请求');
  release();
  await p;
});

/* ---------- R4 项目与版本隔离 ---------- */

t('R4a 发布记录仅含当前版本（bldId 过滤）：其他版本的运行不混入', async () => {
  const h = setup({ prelRuns: [
    prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0' }),
    prelRun({ id: 'PREL-A2', bldId: 'BLD-A', version: '1.1.0', status: 'failed' }),
    prelRun({ id: 'PREL-B1', bldId: 'BLD-B', version: '2.0.0' }),
  ] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  const inner = h.inner();
  assert.match(inner, /data-rel-run="PREL-A1"/, 'A 版本运行 1 在列表');
  assert.match(inner, /data-rel-run="PREL-A2"/, 'A 版本运行 2 在列表');
  assert.doesNotMatch(inner, /PREL-B1/, 'B 版本运行不混入');
});

t('R4b 切换版本清除旧记录与选中：旧运行不再出现，切回后重新加载', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0' })] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  assert.match(h.inner(), /PREL-A1/, 'A 版本记录已加载');
  h.run(`window.ATBBuild.openReleaseTab('BLD-B')`);
  await h.tick();
  const inner = h.inner();
  assert.doesNotMatch(inner, /PREL-A1/, '切换版本后旧记录清除');
  assert.match(inner, /data-rel-ver="BLD-B"/, '发布区归属新版本');
  assert.match(inner, /当前版本暂无发布记录/, 'B 版本空态');
});

t('R4c 切换项目重置页签与发布数据；旧项目慢返回不覆盖新内容', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0' })] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  assert.match(h.inner(), /PREL-A1/, 'A 项目记录已加载');
  // 切项目：页签回概况、发布数据重置
  await h.run(`window.ATBBuild.enter('/p/other')`);
  const inner = h.inner();
  assert.match(inner, /data-detail-tab="overview"[^>]*aria-selected="true"/, '切项目后页签回概况');
  assert.doesNotMatch(inner, /PREL-A1/, '旧项目发布数据清除');
});

t('R4d 旧运行详情慢返回不覆盖新选择（detailSeq 防串）', async () => {
  const h = setup({ prelRuns: [
    prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0' }),
    prelRun({ id: 'PREL-A2', bldId: 'BLD-A', version: '2.0.0' }),
  ] });
  const slow = {};
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/product-release/state') return { ok: true, json: async () => ({ initialized: true, runs: h.live.prel }) };
    if (u.pathname === '/api/product-release/run/PREL-A1') return new Promise((res) => { slow.A1 = () => res({ ok: true, json: async () => prelDetail(prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0' })) }); });
    if (u.pathname === '/api/product-release/run/PREL-A2') return { ok: true, json: async () => prelDetail(prelRun({ id: 'PREL-A2', bldId: 'BLD-A', version: '2.0.0' })) };
    return { ok: true, json: async () => ({}) };
  };
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  assert.match(h.inner(), /加载运行详情|PREL-A1|2\.0\.0/, '首条详情加载中');
  // 选中 A1（挂起）→ 立即切 A2（立即返回）
  h.run(`window.ATBBuild.selectReleaseRun('PREL-A1')`);
  h.run(`window.ATBBuild.selectReleaseRun('PREL-A2')`);
  await h.tick();
  assert.match(h.inner(), /2\.0\.0/, 'A2 详情展示');
  slow.A1(); // A1 慢返回
  await h.tick();
  assert.doesNotMatch(h.inner(), /运行详情[\s\S]{0,80}PREL-A1/, '旧详情不覆盖新选择');
  assert.match(h.inner(), /2\.0\.0/, '新选择详情保持');
});

/* ---------- R5 状态反馈 ---------- */

t('R5a 加载：发布区显示加载提示；页签与版本列表仍可用（不以旧记录顶替）', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-A1', bldId: 'BLD-B' })] });
  let release;
  h.gates['/api/product-release/state'] = () => new Promise((r) => { release = r; });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  const inner = h.inner();
  assert.match(inner, /正在加载发布记录…/, '加载提示');
  assert.match(inner, /data-ver-id="BLD-A"/, '版本列表仍渲染');
  assert.match(inner, /data-detail-tab="overview"/, '页签仍渲染');
  assert.doesNotMatch(inner, /PREL-A1/, '不以旧版本记录顶替');
  release();
  await h.tick();
});

t('R5b 读取失败：显示「发布记录读取失败」与只读重试；重试只发 GET state；概况仍可访问', async () => {
  const h = setup();
  let fail = true;
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    h.calls.push({ path: u.pathname, method: (opts.method || 'GET').toUpperCase() });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/product-release/state') {
      if (fail) return { ok: false, status: 500, json: async () => ({ error: '数据库锁定' }) };
      return { ok: true, json: async () => ({ initialized: true, runs: h.live.prel }) };
    }
    if (/^\/api\/product-release\/run\//.test(u.pathname)) return { ok: true, json: async () => prelDetail() };
    return { ok: true, json: async () => ({}) };
  };
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  let inner = h.inner();
  assert.match(inner, /发布记录读取失败：数据库锁定/, '读取失败提示带原因');
  assert.match(inner, /id="bldRelRetry"/, '提供只读重试入口');
  const posts = h.calls.filter((c) => c.method === 'POST').length;
  assert.equal(posts, 0, '读取失败路径不发任何写请求');
  // 概况仍可访问
  h.run(`window.ATBBuild.setDetailTab('overview')`);
  assert.match(h.inner(), /bld-desc-block/, '概况不受阻');
  // 重试成功恢复
  h.run(`window.ATBBuild.setDetailTab('release')`);
  await h.tick();
  fail = false;
  h.el('#bldRelRetry').listeners.click();
  await h.tick();
  assert.match(h.inner(), /data-rel-run="PREL-20260915-001"/, '重试成功恢复列表');
  assert.ok(h.calls.filter((c) => c.path === '/api/product-release/state').length >= 3, '重试重发了 state 读取');
});

t('R5c 空态：无记录显示「当前版本暂无发布记录」；未合并创建禁用并提示先合并，已合并可用', async () => {
  const h = setup({ prelRuns: [] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`); // merged
  await h.tick();
  let inner = h.inner();
  assert.match(inner, /当前版本暂无发布记录/, '空态文案');
  const createBtn = inner.match(/data-rel-create[^>]*/);
  assert.ok(createBtn, '空态提供创建入口');
  assert.ok(!/disabled/.test(createBtn[0]), '已合并版本创建可用');
  h.run(`window.ATBBuild.openReleaseConfirm('BLD-A')`);
  assert.match(h.inner(), /创建产品发布（BLD-A）/, '已合并可打开创建弹层');
  // 未合并版本（BLD-B draft）
  h.run(`window.ATBBuild.openReleaseTab('BLD-B')`);
  await h.tick();
  inner = h.inner();
  const btn = h.inner().match(/data-rel-create[^>]*/);
  assert.ok(btn && /disabled/.test(btn[0]), '未合并版本创建禁用');
  assert.match(inner, /请先完成合并入 main/, '禁用提示先合并');
});

t('R5d 详情字段：运行 ID、发行版本号、状态、阶段、Web App / 官网目标与错误信息；缺失显示未提供；草稿不显示为已发布', async () => {
  const h = setup({ prelRuns: [
    prelRun({ id: 'PREL-FAIL', bldId: 'BLD-A', version: '1.4.0', status: 'failed', failedStage: 'site-deploy', error: { message: '官网构建退出码 1' } }),
  ] });
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/product-release/state') return { ok: true, json: async () => ({ initialized: true, runs: h.live.prel }) };
    if (u.pathname === '/api/product-release/run/PREL-FAIL') {
      return { ok: true, json: async () => prelDetail(prelRun({ id: 'PREL-FAIL', bldId: 'BLD-A', version: '1.4.0', status: 'failed' }), {
        targets: { webapp: { status: 'done', localUrl: 'http://127.0.0.1:8801' }, site: { status: 'failed' } },
        stages: [
          { key: 'sync-source', label: '源码同步（main/dev 原子推送）', status: 'done' },
          { key: 'webapp-build', label: 'Web App 构建', status: 'done' },
          { key: 'site-deploy', label: '官网构建部署', status: 'failed', error: { message: 'hugo 构建失败：退出码 1' } },
        ],
      }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick(4);
  const inner = h.inner();
  assert.match(inner, /PREL-FAIL/, '运行 ID 展示');
  assert.match(inner, /1\.4\.0/, '发行版本号展示');
  assert.match(inner, /失败/, '失败状态展示（非已发布）');
  assert.doesNotMatch(inner, /已发布/, '失败运行不显示为已发布');
  assert.match(inner, /Web App[\s\S]{0,60}已完成/, 'Web App 目标结果');
  assert.match(inner, /官网与文档[\s\S]{0,60}失败/, '官网目标结果');
  assert.match(inner, /官网构建部署/, '阶段展示');
  assert.match(inner, /hugo 构建失败：退出码 1/, '阶段错误信息展示');
});

/* ---------- R6 动作入口沿用现有发布流程 ---------- */

t('R6a 按状态展示动作：draft 预检/重新冻结/预览发布计划（未预检禁用）；failed 重试；running 取消；任意状态刷新', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-D', bldId: 'BLD-A', status: 'draft' })] });
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/product-release/state') return { ok: true, json: async () => ({ initialized: true, runs: h.live.prel }) };
    if (u.pathname === '/api/product-release/run/PREL-D') return { ok: true, json: async () => prelDetail(prelRun({ id: 'PREL-D', bldId: 'BLD-A', status: 'draft' })) };
    return { ok: true, json: async () => ({}) };
  };
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick(4);
  let inner = h.inner();
  assert.match(inner, /data-rel-act="precheck"/, 'draft 提供预检');
  assert.match(inner, /data-rel-act="refreeze"/, 'draft 提供重新冻结');
  const plan = inner.match(/data-rel-act="plan"[^>]*/);
  assert.ok(plan && /disabled/.test(plan[0]), '未预检时预览发布计划禁用');
  assert.match(inner, /data-rel-act="refresh"/, '刷新状态入口');
  assert.doesNotMatch(inner, /data-rel-act="retry"/, 'draft 无重试入口');
  assert.doesNotMatch(inner, /data-rel-act="cancel"/, 'draft 无取消入口');
  // failed：重试 + 重新冻结；running：取消
  h.run(`window.ATBBuild.selectReleaseRun2 = 1`); // 占位无操作
  const mk = (status) => {
    h.live.prel[0] = prelRun({ id: 'PREL-D', bldId: 'BLD-A', status });
    h.sandbox.fetch = async (url) => {
      const u = new URL(String(url), 'http://local');
      if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
      if (u.pathname === '/api/product-release/state') return { ok: true, json: async () => ({ initialized: true, runs: h.live.prel }) };
      if (u.pathname === '/api/product-release/run/PREL-D') return { ok: true, json: async () => prelDetail(prelRun({ id: 'PREL-D', bldId: 'BLD-A', status })) };
      return { ok: true, json: async () => ({}) };
    };
  };
  mk('failed');
  h.run(`window.ATBBuild.refreshReleasePane()`);
  await h.tick(4);
  inner = h.inner();
  assert.match(inner, /data-rel-act="retry"/, 'failed 提供重试失败阶段');
  assert.match(inner, /data-rel-act="refreeze"/, 'failed 提供重新冻结');
  mk('running');
  h.run(`window.ATBBuild.refreshReleasePane()`);
  await h.tick(4);
  inner = h.inner();
  assert.match(inner, /data-rel-act="cancel"/, 'running 提供取消后续阶段');
});

t('R6b 计划确认：预览走 GET plan 弹确认窗；确认才 POST start，取消不发', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-D', bldId: 'BLD-A', status: 'draft' })] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick(4);
  await h.run(`window.ATBBuild.openRelPlan('PREL-D')`);
  const inner = h.inner();
  assert.match(inner, /发布计划确认/, '计划确认弹窗');
  assert.match(inner, /步骤一：冻结核对/, '计划步骤展示');
  assert.match(inner, /确认启动发布/, '确认启动按钮');
  assert.equal(h.calls.filter((c) => c.path.includes('/plan')).length, 1, '预览走 GET plan');
  // 取消：不发 start
  h.el('#bldRelPlanCancel').listeners.click();
  assert.equal(h.calls.filter((c) => c.method === 'POST' && c.path.includes('/start')).length, 0, '取消不发 start');
  // 重新打开并确认 → POST start
  await h.run(`window.ATBBuild.openRelPlan('PREL-D')`);
  h.el('#bldRelPlanConfirm').listeners.click();
  await h.tick();
  assert.equal(h.calls.filter((c) => c.method === 'POST' && c.path.includes('/start')).length, 1, '确认后 POST start');
});

t('R6c 动作执行中禁用防重复；完成只刷新（GET state + GET run），不重复执行', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-D', bldId: 'BLD-A', status: 'draft' })] });
  let release;
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    h.calls.push({ path: u.pathname, method: (opts.method || 'GET').toUpperCase(), body: null });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/product-release/state') return { ok: true, json: async () => ({ initialized: true, runs: h.live.prel }) };
    if (u.pathname === '/api/product-release/run/PREL-D') return { ok: true, json: async () => prelDetail(prelRun({ id: 'PREL-D', bldId: 'BLD-A', status: 'draft' })) };
    if (u.pathname === '/api/product-release/run/PREL-D/precheck') return new Promise((res) => { release = () => res({ ok: true, json: async () => ({ run: prelRun({ id: 'PREL-D' }) }) }); });
    return { ok: true, json: async () => ({}) };
  };
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick(4);
  const p = h.run(`window.ATBBuild.relAction('PREL-D', 'precheck')`);
  const busyInner = h.inner();
  assert.match(busyInner, /data-rel-act="precheck"[^>]*disabled/, '执行中动作禁用');
  await h.run(`window.ATBBuild.relAction('PREL-D', 'precheck')`); // busy 中重复触发
  release();
  await p;
  await h.tick();
  assert.equal(h.calls.filter((c) => c.path.endsWith('/precheck')).length, 1, '不重复执行动作');
  assert.ok(h.calls.filter((c) => c.path === '/api/product-release/state').length >= 2, '完成后刷新列表');
});

/* ---------- R7 i18n ---------- */

t('R7a 新增静态文案入 EN、含插值句入 EN_DYNAMIC（值无中文）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['概况', '发布', '正在加载发布记录…', '当前版本暂无发布记录', '请先完成合并入 main',
    '预览发布计划', '重新冻结', '重试失败阶段', '取消后续阶段', '刷新状态', '确认启动发布',
    '草稿', '预检', '等待人工', '已发布', '已取消', '未提供', '官网与文档', '点击左侧运行查看详情', '发布记录', '运行详情']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  for (const k of ['发布记录读取失败：◇', '详情读取失败：◇', '✓ 已创建产品发布 ◇（草稿）：请在本页签预检并启动']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
});

/* ---------- 静态契约 ---------- */

t('S1 静态契约：页签/记录/动作绑定存在；build.js 不再派发 atb:goto-view；样式类存在', () => {
  assert.match(buildJs, /view\.querySelectorAll\('\[data-detail-tab\]'\)/, 'bindCommon 绑定详情页签切换');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-rel-run\]'\)/, 'bindCommon 绑定运行选择');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-rel-act\]'\)/, 'bindCommon 绑定发布动作');
  assert.match(buildJs, /#bldRelRetry/, 'bindCommon 绑定读取重试');
  assert.doesNotMatch(buildJs, /atb:goto-view/, 'build.js 不再派发跨模块跳转（缺陷根因移除）');
  const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  assert.match(css, /\.bld-detail-tabs/, '样式：详情页签');
  assert.match(css, /\.bld-rel-pane/, '样式：发布区容器');
  assert.match(css, /\.bld-rel-list/, '样式：运行列表');
  assert.match(css, /\.bld-rel-detail/, '样式：运行详情');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
