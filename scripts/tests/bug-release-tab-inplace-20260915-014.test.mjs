#!/usr/bin/env node
// BUG-20260915-014 构建模块「查看发布记录 / 创建发布」不再跳转被隐藏的发布模块——
// 右侧版本详情就地激活「正式发布」步，发布数据按项目 + 版本（bldId）隔离加载。
// BUG-20260928-012 起发布运行记录展示模块（列表卡片 / 运行详情 / 动作区）删除，本文件
// 断言按直线流程口径维护：就地激活、数据隔离与防串、加载 / 失败、失败结果面板与重试。
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
    stages: [], error: null,
    ...o,
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
  const gates = {}; // path → 手动放行（pending promise 的 release 函数）
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
      // BUG-20260916-001：构建发布改走独立 /api/build-publish/*（不再复用产品发布模块）；
      // BUG-20260928-002：官网仓库默认已配置（发布条禁用口径覆盖未配置分支在新测试文件）
      if (u.pathname === '/api/build-publish/state') return { ok: true, json: async () => ({ runs: JSON.parse(JSON.stringify(live.prel)), config: { homepageRepoRoot: '/tmp/hp' } }) };
      if (u.pathname === '/api/build-publish/from-build') {
        const id = `PREL-NEW-${calls.filter((c) => c.path === '/api/build-publish/from-build').length}`;
        live.prel.push(prelRun({ id, bldId: opts.body ? JSON.parse(opts.body).bldId : 'BLD-A', version: opts.body ? JSON.parse(opts.body).version : '9.9.9', status: 'draft' }));
        return { ok: true, status: 201, json: async () => ({ run: prelRun({ id, bldId: 'BLD-A', version: '9.9.9' }) }) };
      }
      const m = u.pathname.match(/^\/api\/build-publish\/run\/([^/]+)\/?([a-z]*)$/);
      if (m) {
        const [, id, action] = m;
        if (action === 'plan') return { ok: true, json: async () => ({ plan: { steps: ['步骤一：冻结核对', '步骤二：推送 main/dev'], warning: 'main 已前进' } }) };
        if (action) {
          const run = live.prel.find((r) => r.id === id);
          if (run) run.status = action === 'start' ? 'running' : action === 'precheck' ? 'draft' : run.status;
          // BUG-20260928-002：一键发布链路预检默认通过（指纹 token 供 start 守卫）
          return { ok: true, json: async () => ({ run: prelRun({ id, status: run?.status || 'draft', precheck: action === 'precheck' ? { ok: true, checks: [], fingerprint: 'fp-1' } : undefined }) }) };
        }
        const sum = live.prel.find((r) => r.id === id) || prelRun({ id });
        return { ok: true, json: async () => ({ run: sum, logs: [] }) };
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

/* ---------- R1 右侧详情「概况 / 发布」页签 ---------- */

t('R1a 详情标题下出现概况/发布页签，默认概况：原描述、关联条目、合并反馈在概况内；发布区内容不出现', async () => {
  const h = setup();
  await h.enter();
  const inner = h.inner();
  assert.match(inner, /data-step="plan"[^>]*aria-selected="true"/, '概况页签默认激活');
  assert.match(inner, /data-step="release"[^>]*aria-selected="false"/, '发布页签存在且未激活');
  assert.match(inner, />选择条目与提交<\/button>/, '「选择条目与提交」步文案（REQ-20260926-002 五步重定义）');
  assert.match(inner, />发布<\/button>/, '「发布」步文案（REQ-20260926-002 五步重定义）');
  assert.match(inner, /bld-desc-block/, '版本计划步含描述块');
  assert.match(h.inner(), /关联条目与 commit/, '第一步（选择条目与提交）含关联条目列表（link 并入 plan）');
  assert.doesNotMatch(inner, /bld-rel-pane/, '概况不渲染发布区内容');
  assert.doesNotMatch(inner, /正在加载发布记录|尚未发布|发布记录读取失败/, '概况不出发布区状态内容');
});

t('R1b 切到发布页签再切回概况：发布区出现/消失；左侧版本列表与模块页签不受影响', async () => {
  const h = setup();
  await h.enter();
  h.run(`window.ATBBuild.setStep('release')`);
  await h.tick();
  let inner = h.inner();
  assert.match(inner, /data-step="release"[^>]*aria-selected="true"/, '发布页签激活');
  assert.match(inner, /bld-rel-pane/, '发布区渲染');
  assert.match(inner, /data-ver-id="BLD-A"/, '左侧版本列表仍在');
  assert.match(inner, /data-bld-tab="versions"/, '模块页签不受影响');
  h.run(`window.ATBBuild.setStep('plan')`);
  inner = h.inner();
  assert.match(inner, /data-step="plan"[^>]*aria-selected="true"/, '切回概况');
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
  assert.match(inner, /data-step="release"[^>]*aria-selected="true"/, '发布页签就地激活');
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
  h.run(`window.ATBBuild.setStep('plan')`);
  assert.match(h.inner(), /bld-desc-block/, '概况内容切回可见');
});

/* ---------- R3 直线发布落点与失败路径（BUG-20260928-012 口径） ---------- */

t('R3a 发布成功：留在构建模块，落点发布页签执行中（补填 → 检查 → 确认 → 启动）；链路按序且带指纹 token', async () => {
  const h = setup({ prelRuns: [] });
  await h.enter();
  h.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  h.el('#bldRelVersion').value = '1.3.0';
  await h.run(`window.ATBBuild.doPublishCheck()`);
  await h.tick();
  assert.match(h.inner(), /发布二次确认（BLD-A）/, '检查通过进入二次确认');
  await h.run(`window.ATBBuild.doPublishConfirm()`);
  await h.tick();
  const inner = h.inner();
  assert.doesNotMatch(inner, /发布二次确认（BLD-A）/, '确认后弹窗关闭');
  assert.match(inner, /data-step="release"[^>]*aria-selected="true"/, '落点为发布页签');
  assert.match(inner, /rel-card sel" data-ver-id="BLD-A"/, '版本选中保持');
  assert.ok(!inner.includes('data-rel-run='), '运行记录列表不渲染（模块删除）');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*发布中…\s*</, '落点为执行中（按钮发布中…）');
  // 直线链路顺序：创建草稿 → 预检（检查阶段）→ 确认后启动（不再走预览发布计划读取步骤）
  const flow = h.calls.filter((c) => c.method === 'POST' && /build-publish/.test(c.path)).map((c) => c.path);
  assert.deepEqual(flow, ['/api/build-publish/from-build', '/api/build-publish/run/PREL-NEW-1/precheck', '/api/build-publish/run/PREL-NEW-1/start'], '链路按序执行');
  const start = h.calls.find((c) => c.path.endsWith('/start'));
  assert.equal(start?.body?.token, 'fp-1', 'start 携带预检指纹 token（服务端守卫不变）');
});

t('R3b 检查失败（创建 409）：检查未通过弹窗反馈服务端原因、不进入二次确认；检查 busy 中重复触发不产生第二次请求', async () => {
  const h = setup();
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  h.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  h.el('#bldRelVersion').value = '1.3.0';
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    h.calls.push({ path: u.pathname, method: (opts.method || 'GET').toUpperCase(), body: null });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/build-publish/state') return { ok: true, json: async () => ({ runs: h.live.prel, config: { homepageRepoRoot: '/tmp/hp' } }) };
    if (u.pathname === '/api/build-publish/from-build') return { ok: false, status: 409, json: async () => ({ error: '已有进行中的产品发布（PREL-20260915-001）' }) };
    return { ok: true, json: async () => ({}) };
  };
  await h.run(`window.ATBBuild.doPublishCheck()`);
  const inner = h.inner();
  assert.match(inner, /检查未通过/, '检查未通过弹窗');
  assert.match(inner, /已有进行中的产品发布（PREL-20260915-001）/, '服务端原因可见');
  assert.match(inner, /role="alert"/, '失败反馈可被发现');
  assert.ok(!inner.includes('发布二次确认'), '不进入二次确认');
  // 检查防重复：from-build 挂起期间再次触发检查，不产生第二个请求
  let release;
  h.run(`window.ATBBuild.closePublishFlow()`);
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    if (u.pathname === '/api/build-publish/from-build') return new Promise((res) => { release = () => res({ ok: true, status: 201, json: async () => ({ run: prelRun({ id: 'PREL-NEW-X', version: '2.0.0' }) }) }); });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/build-publish/state') return { ok: true, json: async () => ({ runs: h.live.prel, config: { homepageRepoRoot: '/tmp/hp' } }) };
    if (u.pathname.endsWith('/precheck')) return { ok: true, json: async () => ({ run: prelRun({ id: 'PREL-NEW-X', version: '2.0.0', precheck: { ok: true, checks: [], fingerprint: 'fp-1' } }) }) };
    return { ok: true, json: async () => ({}) };
  };
  h.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  h.el('#bldRelVersion').value = '2.0.0';
  const p = h.run(`window.ATBBuild.doPublishCheck()`);
  await h.run(`window.ATBBuild.doPublishCheck()`); // busy 中重复触发
  assert.equal(h.calls.filter((c) => c.path === '/api/build-publish/from-build').length, 1, '检查执行中重复触发不发出第二个请求');
  release();
  await p;
});

/* ---------- R4 项目与版本隔离 ---------- */

t('R4a 发布数据仅含当前版本（bldId 过滤）：其他版本的运行不混入结果面板', async () => {
  const h = setup({ prelRuns: [
    prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0', status: 'succeeded' }),
    prelRun({ id: 'PREL-B1', bldId: 'BLD-B', version: '2.0.0', status: 'failed', error: { message: 'B 版本失败信息' } }),
  ] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  const inner = h.inner();
  assert.match(inner, /✓ 发布成功[\s\S]{0,30}v1\.0\.0/, 'A 版本成功结果面板（自己的运行驱动）');
  assert.ok(!inner.includes('B 版本失败信息'), 'B 版本失败运行不混入 A 面板');
  assert.ok(!inner.includes('data-rel-run='), '运行记录列表不渲染（模块删除）');
});

t('R4b 切换版本清除旧数据：旧版本结果不再出现，空版本显示尚未发布', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0', status: 'succeeded' })] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  assert.match(h.inner(), /✓ 发布成功/, 'A 版本成功结果已加载');
  h.run(`window.ATBBuild.openReleaseTab('BLD-B')`);
  await h.tick();
  const inner = h.inner();
  assert.doesNotMatch(inner, /✓ 发布成功/, '切换版本后旧结果清除');
  assert.match(inner, /data-rel-ver="BLD-B"/, '发布区归属新版本');
  assert.match(inner, /尚未发布/, 'B 版本空态（直线流程说明）');
});

t('R4c 切换项目重置页签与发布数据；旧项目结果不残留', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0', status: 'succeeded' })] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick();
  assert.match(h.inner(), /✓ 发布成功/, 'A 项目结果已加载');
  // 切项目：页签回概况、发布数据重置
  await h.run(`window.ATBBuild.enter('/p/other')`);
  const inner = h.inner();
  assert.match(inner, /data-step="plan"[^>]*aria-selected="true"/, '切项目后页签回概况');
  assert.doesNotMatch(inner, /✓ 发布成功/, '旧项目发布数据清除');
});

t('R4d 旧项目慢返回不覆盖新内容（seq 防串：迟到的 state 响应被丢弃）', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-A1', bldId: 'BLD-A', version: '1.0.0', status: 'succeeded' })] });
  let releaseA;
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/build-publish/state' && !releaseA) {
      return new Promise((res) => { releaseA = () => res({ ok: true, json: async () => ({ runs: h.live.prel, config: { homepageRepoRoot: '/tmp/hp' } }) }); });
    }
    if (u.pathname === '/api/build-publish/state') return { ok: true, json: async () => ({ runs: [], config: { homepageRepoRoot: '/tmp/hp' } }) };
    return { ok: true, json: async () => ({}) };
  };
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`); // A 的 state 挂起
  await h.run(`window.ATBBuild.openReleaseTab('BLD-B')`); // 立即切 B（空数据返回）
  await h.tick(4);
  assert.match(h.inner(), /尚未发布/, 'B 版本空态');
  releaseA(); // A 的慢返回
  await h.tick(4);
  assert.doesNotMatch(h.inner(), /✓ 发布成功/, '旧版本慢返回不覆盖 B 的空态');
  assert.match(h.inner(), /data-rel-ver="BLD-B"/, '发布区仍归属 B');
});

/* ---------- R5 状态反馈 ---------- */

t('R5a 加载：发布区显示加载提示；页签与版本列表仍可用（不以旧记录顶替）', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-A1', bldId: 'BLD-B' })] });
  let release;
  h.gates['/api/build-publish/state'] = () => new Promise((r) => { release = r; });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  const inner = h.inner();
  assert.match(inner, /正在加载发布记录…/, '加载提示');
  assert.match(inner, /data-ver-id="BLD-A"/, '版本列表仍渲染');
  assert.match(inner, /data-step="plan"/, '页签仍渲染');
  assert.doesNotMatch(inner, /PREL-A1/, '不以旧版本记录顶替');
  release();
  await h.tick();
});

t('R5b 读取失败：显示「发布记录读取失败」与只读重试；重试只发 GET state；概况仍可访问；成功后离开失败态', async () => {
  const h = setup();
  let fail = true;
  h.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    h.calls.push({ path: u.pathname, method: (opts.method || 'GET').toUpperCase() });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: h.live.versions }) };
    if (u.pathname === '/api/build-publish/state') {
      if (fail) return { ok: false, status: 500, json: async () => ({ error: '数据库锁定' }) };
      return { ok: true, json: async () => ({ runs: h.live.prel, config: { homepageRepoRoot: '/tmp/hp' } }) };
    }
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
  h.run(`window.ATBBuild.setStep('plan')`);
  assert.match(h.inner(), /bld-desc-block/, '概况不受阻');
  // 重试成功恢复（离开失败态；默认 draft 运行不上屏 → 空闲说明）
  h.run(`window.ATBBuild.setStep('release')`);
  await h.tick();
  fail = false;
  h.el('#bldRelRetry').listeners.click();
  await h.tick();
  inner = h.inner();
  assert.ok(!inner.includes('发布记录读取失败'), '重试成功离开失败态');
  assert.match(inner, /尚未发布/, '恢复为空闲态（draft 运行不上屏）');
  assert.ok(h.calls.filter((c) => c.path === '/api/build-publish/state').length >= 3, '重试重发了 state 读取');
});

t('R5c 空态：无记录显示「尚未发布」与直线流程说明；「发布」为唯一入口（BUG-20260928-002 / 012 口径）', async () => {
  const h = setup({ prelRuns: [] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`); // merged
  await h.tick();
  let inner = h.inner();
  assert.match(inner, /尚未发布/, '空态文案（直线流程口径）');
  assert.match(inner, /先按检查规则检查/, '检查前置口径说明');
  assert.ok(!inner.includes('data-rel-create'), '空态不再有「创建并预检」入口');
  const pubBtn = inner.match(/data-rel-publish="BLD-A"[^>]*/);
  assert.ok(pubBtn, '空态提供唯一「发布」入口');
  assert.ok(!/disabled/.test(pubBtn[0]), '已合并且已配置版本发布可用（空态直线发布）');
  h.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  assert.match(h.inner(), /发布（BLD-A）/, '已合并可打开发布弹窗（无版本号先补填）');
  // 未合并版本（BLD-B draft）
  h.run(`window.ATBBuild.openReleaseTab('BLD-B')`);
  await h.tick();
  inner = h.inner();
  const btn = h.inner().match(/data-rel-publish="BLD-B"[^>]*/);
  assert.ok(btn && /disabled/.test(btn[0]), '未合并版本发布禁用');
  assert.match(inner, /请先完成合并入 main/, '禁用提示先合并');
});

t('R5d 失败结果面板：错误信息与失败阶段可见并提供「重试」；运行详情字段（ID / 阶段列表 / Web App 目标）不再上屏', async () => {
  const h = setup({ prelRuns: [
    prelRun({ id: 'PREL-FAIL', bldId: 'BLD-A', version: '1.4.0', status: 'failed', error: { message: '官网构建退出码 1' }, stages: [{ key: 'site-deploy', label: '官网构建部署', status: 'failed', error: 'hugo 构建失败：退出码 1' }] }),
  ] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick(4);
  const inner = h.inner();
  assert.match(inner, /✕ 发布失败：官网构建退出码 1/, '失败结果面板与错误信息');
  assert.match(inner, /失败阶段：官网构建部署/, '失败阶段可见');
  assert.match(inner, /data-rel-retry-publish="BLD-A"/, '失败面板提供「重试」');
  assert.ok(!inner.includes('aria-label="运行详情"'), '运行详情面板不再渲染（模块删除）');
  assert.ok(!inner.includes('Web App'), 'Web App 目标行不再上屏');
  assert.ok(!inner.includes('官网与文档'), '官网目标行不再上屏');
  assert.doesNotMatch(inner, /class="st[^"]*">已发布<\/span>/, '失败运行不显示为已发布');
});

/* ---------- R6 动作入口（BUG-20260928-012：随运行详情模块删除） ---------- */

t('R6 运行详情动作入口不再渲染：预检 / 重新冻结 / 预览发布计划 / 重试失败阶段 / 取消后续阶段 / 刷新状态整体移除', async () => {
  const h = setup({ prelRuns: [prelRun({ id: 'PREL-D', bldId: 'BLD-A', status: 'draft' })] });
  await h.enter();
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick(4);
  const inner = h.inner();
  assert.ok(!inner.includes('data-rel-act'), '动作区行为标记不再渲染');
  assert.ok(!inner.includes('预检</button>'), '「预检」按钮不再渲染');
  assert.ok(!inner.includes('重新冻结'), '「重新冻结」按钮不再渲染');
  assert.ok(!inner.includes('预览发布计划'), '「预览发布计划」按钮不再渲染');
  assert.ok(!inner.includes('重试失败阶段'), '「重试失败阶段」按钮不再渲染');
  assert.ok(!inner.includes('取消后续阶段'), '「取消后续阶段」按钮不再渲染');
  assert.ok(!inner.includes('刷新状态'), '「刷新状态」按钮不再渲染');
  // 检查 / 执行动作收口到直线流程（检查弹窗与失败重试），服务端能力不变
  assert.match(buildJs, /doPublishCheck/, '检查接缝（doPublishCheck）');
  assert.match(buildJs, /doPublishConfirm/, '确认执行接缝（doPublishConfirm）');
  assert.match(buildJs, /retryPublish/, '失败重试接缝（retryPublish）');
  assert.ok(!buildJs.includes('function relAction'), 'relAction（详情动作分发）移除');
  assert.ok(!buildJs.includes('function openRelPlan'), 'openRelPlan（计划确认）移除');
});

/* ---------- R7 i18n ---------- */

t('R7a 就地发布区文案入 EN、含插值句入 EN_DYNAMIC（值无中文）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['概况', '发布', '正在加载发布记录…', '尚未发布。',
    '请先完成合并入 main', '发布二次确认', '确认发布', '发布计划',
    '✓ 发布成功', '✕ 发布失败', '（本地时间）', '重试重新走发布流程（检查 → 确认，不跳过确认）。']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  // BUG-20260928-012 直线流程动态文案（旧「发布已启动见运行详情 / 预检未通过」句随模块删除清理）
  for (const k of ['发布记录读取失败：◇', '发布二次确认（◇）', '发布（◇）', '即将发布版本 v◇。',
    '发布时间：◇（本地时间）', '✓ 发布成功（v◇）', '✕ 发布失败：◇', '✕ 发布中止：◇', '发布中止：◇']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
  for (const gone of ['✓ 发布已启动（◇）：执行进度见下方运行详情', '预检未通过：◇：◇']) {
    assert.ok(!EN_DYNAMIC[gone] && !EN[gone], `已删除模块的词条应清理：${gone}`);
  }
});

/* ---------- 静态契约 ---------- */

t('S1 静态契约：五步导航 / 发布入口 / 读取重试绑定存在；运行选择与动作绑定移除；不再派发跨模块跳转', () => {
  assert.match(buildJs, /view\.querySelectorAll\('\[data-step\]'\)/, 'bindCommon 绑定五步导航切换');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-rel-publish\]'\)/, 'bindCommon 绑定唯一「发布」入口');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-rel-retry-publish\]'\)/, 'bindCommon 绑定失败重试入口');
  assert.match(buildJs, /#bldRelRetry/, 'bindCommon 绑定读取重试');
  assert.ok(!buildJs.includes("querySelectorAll('[data-rel-run]')"), '运行选择绑定移除（模块删除）');
  assert.ok(!buildJs.includes("querySelectorAll('[data-rel-act]')"), '发布动作绑定移除（模块删除）');
  assert.ok(!buildJs.includes("querySelectorAll('[data-publish-open]')"), '目录打开绑定移除（模块删除）');
  assert.doesNotMatch(buildJs, /atb:goto-view/, 'build.js 不再派发跨模块跳转（缺陷根因移除）');
  const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  assert.match(css, /\.bld-detail-tabs/, '样式：详情页签');
  assert.match(css, /\.bld-rel-pane/, '样式：发布区容器');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
