#!/usr/bin/env node
// BUG-20260928-002 「正式发布」步发布区收敛：唯一「发布」主按钮（堆叠创建入口删除）。
// BUG-20260928-012 起发布交互为直线流程（点击「发布」→ 按检查规则提示 → 二次确认 →
// 执行 → 出结果；运行记录展示模块删除），本文件断言按该口径维护：唯一入口、检查 /
// 确认 / 执行链路（from-build → precheck → start，token = 预检指纹）、防重复、复用
// 口径、检查未通过不进入执行、已发布态从简（发布时间本地时区）。假 DOM 口径同
// build-ui.test.mjs。用法：node scripts/tests/bug-20260928-002.test.mjs

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
  return { itemId: `REQ-20260928-0${String(i).padStart(2, '0')}`, title: `条目 ${i}`, commit: H('a').slice(0, 39) + String(i % 10), mergedAt: null, mergeError: null };
}

function ver(id, name, status = 'merged', items = [verItem(1), verItem(2)], extra = {}) {
  return {
    id, name, description: `描述 ${name}`, status, version: '1.2.0',
    items,
    createdAt: '2026-09-28T01:00:00.000Z', updatedAt: '2026-09-28T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
    ...extra,
  };
}

// /api/build-publish 运行记录（summary 与详情共用形状；precheck 由用例按需附加）
function relRun(o = {}) {
  return {
    id: 'BPUB-20260928-0001', productId: 'proj', bldId: 'BLD-A', bldName: 'v1.2',
    version: '1.2.0', status: 'draft',
    createdAt: '2026-09-28T08:00:00.000Z', updatedAt: '2026-09-28T08:30:00.000Z',
    targets: { webapp: { status: 'pending' }, site: { status: 'pending' } },
    stages: [], logs: [],
    ...o,
  };
}

function relDetail(run) {
  return {
    run: {
      ...run,
      frozen: { mainSha: H('c'), devSha: H('d'), remote: 'origin', homepage: { repoRoot: '/tmp/hp' } },
      stages: run.stages || [],
      precheck: run.precheck || null,
    },
    logs: run.logs || [],
    directories: {},
  };
}

function setup({ versions = [ver('BLD-A', 'v1.2', 'merged'), ver('BLD-B', 'v2.0', 'draft')], runs = [], config = { homepageRepoRoot: '/tmp/hp' }, precheckOk = true } = {}) {
  const live = { versions: JSON.parse(JSON.stringify(versions)), runs: JSON.parse(JSON.stringify(runs)), config: JSON.parse(JSON.stringify(config)) };
  const state = () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: live.versions });
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const calls = [];
  const gates = {}; // path → 挂起放行函数
  const mkRun = (body) => {
    const id = `BPUB-NEW-${calls.filter((c) => c.path === '/api/build-publish/from-build').length}`;
    const run = relRun({ id, version: body.version, status: 'draft' });
    live.runs.push(JSON.parse(JSON.stringify(run)));
    return run;
  };
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
      if (gates[u.pathname]) await gates[u.pathname]();
      if (u.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state())) };
      if (u.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (u.pathname === '/api/build-publish/state') return { ok: true, json: async () => ({ runs: JSON.parse(JSON.stringify(live.runs)), config: JSON.parse(JSON.stringify(live.config)) }) };
      if (u.pathname === '/api/build-publish/from-build') {
        const run = mkRun(opts.body ? JSON.parse(opts.body) : { version: '9.9.9' });
        return { ok: true, status: 201, json: async () => ({ run }) };
      }
      const m = u.pathname.match(/^\/api\/build-publish\/run\/([^/]+)\/?([a-z]*)$/);
      if (m) {
        const [, id, action] = m;
        const cur = () => live.runs.find((r) => r.id === id) || relRun({ id });
        if (action === 'plan') return { ok: true, json: async () => ({ plan: { token: 'fp-1', steps: ['步骤一（不应再走预览步骤）'] } }) };
        if (action === 'precheck') {
          const run = cur();
          run.precheck = precheckOk === true
            ? { ok: true, checks: [{ label: '发布文档', ok: true }], fingerprint: 'fp-1' }
            : (typeof precheckOk === 'object' ? precheckOk : { ok: false, checks: precheckOk || [{ label: '工作区', ok: false, detail: '源码工作区有未提交修改' }], fingerprint: null });
          if (run.precheck.ok && run.status === 'failed') run.status = 'draft';
          return { ok: true, json: async () => ({ run: JSON.parse(JSON.stringify(run)) }) };
        }
        if (action === 'start') {
          const run = cur();
          run.status = 'running';
          return { ok: true, json: async () => ({ run: JSON.parse(JSON.stringify(run)) }) };
        }
        return { ok: true, json: async () => relDetail(cur()) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, live, calls, gates, tick,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    el: (sel) => vm.runInContext(`document.querySelector('#buildView').querySelector(${JSON.stringify(sel)})`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/proj')`, sandbox); },
  };
}

// 进入项目并就地激活「正式发布」步（等发布数据读取完成）
const harness = setup;

async function openRel(hh, id = 'BLD-A') {
  await hh.enter();
  hh.run(`window.ATBBuild.openReleaseTab('${id}')`);
  await hh.tick();
}

// 直线发布（BUG-20260928-012）：点击「发布」（自动检查）→ 二次确认 →（确认执行）
async function startPublish(hh, id = 'BLD-A') {
  hh.run(`window.ATBBuild.openPublishConfirm('${id}')`);
  await hh.tick();
}
async function confirmPublish(hh) {
  await hh.run(`window.ATBBuild.doPublishConfirm()`);
  await hh.tick();
}
async function publish(hh, id = 'BLD-A') {
  await startPublish(hh, id);
  await confirmPublish(hh);
}

/* ---------- R1 收敛为唯一发布入口 ---------- */

t('R1a 空态：堆叠区域删除，「发布」为唯一发布入口（唯一、可点击）；空态说明保留直线流程口径', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  const inner = hh.inner();
  assert.ok(!inner.includes('data-rel-create'), '空态不再有「创建并预检」入口（data-rel-create）');
  assert.ok(!inner.includes('创建并预检'), '空态不再出现「创建并预检」文案');
  assert.doesNotMatch(buildJs, />本版本发布</, '不再渲染「本版本发布」标题（随区域收敛移除）');
  const pubBtns = inner.match(/data-rel-publish="[^"]*"/g) || [];
  assert.equal(pubBtns.length, 1, '同屏「发布」按钮唯一');
  assert.match(pubBtns[0], /data-rel-publish="BLD-A"/, '发布按钮绑定当前版本');
  assert.ok(!/data-rel-publish="BLD-A"[^>]*disabled/.test(inner), '已合并 + 已配置时发布可点击（空态直线发布）');
  assert.match(inner, /尚未发布/, '空态说明保留（直线流程口径）');
  assert.match(inner, /先按检查规则检查/, '先按检查规则检查的口径说明');
});

t('R1b 有记录态（草稿残留）：发布按钮置顶唯一；运行记录列表 / 详情动作区不再渲染（BUG-20260928-012 模块删除）', async () => {
  const hh = harness({ runs: [relRun({ id: 'BPUB-D', status: 'draft', precheck: null })] });
  await openRel(hh, 'BLD-A');
  await hh.tick();
  const inner = hh.inner();
  const pubBtns = inner.match(/data-rel-publish="[^"]*"/g) || [];
  assert.equal(pubBtns.length, 1, '有记录态同屏「发布」按钮仍唯一');
  assert.ok(!inner.includes('创建并预检'), '不再有「创建并预检」入口');
  assert.ok(!inner.includes('aria-label="发布记录"'), '发布记录列表不再渲染（模块删除）');
  assert.ok(!inner.includes('aria-label="运行详情"'), '运行详情不再渲染（模块删除）');
  assert.ok(!inner.includes('data-rel-act'), '运行详情动作区不再渲染');
  assert.ok(!inner.includes('[object Object]'), '无 targets 对象摘要（随模块删除消除）');
});

t('R1c 禁用口径：未合并 / 发布中 / 已发布分别禁用并就近显示原因；未配置官网仓库不再禁用（REQ-20260929-002）', async () => {
  // 未合并（BLD-B 为 draft 未合并）
  let hh = harness({ runs: [] });
  await openRel(hh, 'BLD-B');
  let inner = hh.inner();
  assert.match(inner, /data-rel-publish="BLD-B"[^>]*disabled/, '未合并版本发布禁用');
  assert.match(inner, /请先完成合并入 main/, '未合并就近说明原因');
  // REQ-20260929-002：未配置官网仓库不再禁用（发布不依赖官网配置），无「前往设置」入口
  hh = harness({ runs: [], config: {} });
  await openRel(hh, 'BLD-A');
  inner = hh.inner();
  assert.doesNotMatch(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '未配置官网仓库发布不再禁用');
  assert.ok(!inner.includes('请先配置官网仓库'), '无未配置禁用说明');
  assert.ok(!inner.includes('前往设置'), '无「前往设置」入口');
  // 发布中
  hh = harness({ runs: [relRun({ id: 'BPUB-R', status: 'running' })] });
  await openRel(hh, 'BLD-A');
  await hh.tick();
  inner = hh.inner();
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '发布中禁用');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*发布中…\s*</, '发布中按钮文案');
  // 已发布
  hh = harness({ runs: [relRun({ id: 'BPUB-S', status: 'succeeded', updatedAt: '2026-09-28T09:41:00.000Z' })] });
  await openRel(hh, 'BLD-A');
  await hh.tick();
  inner = hh.inner();
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '已发布禁用（不可再发布）');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*已发布\s*</, '已发布按钮文案');
});

/* ---------- R2 直线流程：检查 → 二次确认 → 执行 ---------- */

t('R2a 点击「发布」先检查：弹「发布前检查」（自动创建草稿并预检）；检查通过弹二次确认；取消关闭且不发出执行请求', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  await startPublish(hh, 'BLD-A');
  let inner = hh.inner();
  assert.match(inner, /发布二次确认（BLD-A）/, '检查通过后进入二次确认弹窗（带版本计划号）');
  assert.match(inner, /即将发布版本 v1\.2\.0。/, '极简文案：仅提示即将发布的版本号');
  assert.match(inner, /检查已全部通过/, '检查通过说明');
  assert.match(inner, /id="bldRelGo"[^>]*>确认发布/, '确认发布按钮');
  assert.match(inner, /id="bldRelCancel"[^>]*>取消/, '取消按钮');
  assert.ok(!inner.includes('创建产品发布'), '不再出现旧创建弹层');
  assert.ok(!inner.includes('发布计划确认'), '不再走「预览发布计划」弹窗');
  // 取消：不发任何执行请求（检查阶段的创建 / 预检不算执行——start 才是执行）
  const starts0 = hh.calls.filter((c) => c.path.endsWith('/start')).length;
  hh.el('#bldRelCancel').listeners.click();
  inner = hh.inner();
  assert.ok(!inner.includes('发布二次确认'), '取消后弹窗关闭');
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/start')).length, starts0, '取消不发出任何执行请求（start）');
});

t('R2b 链路：检查（创建草稿 → 预检）→ 读取发布计划 → 二次确认 → 启动（token = 预检指纹）；成功后弹窗关闭并刷新', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  await publish(hh, 'BLD-A');
  const flow = hh.calls.filter((c) => /\/api\/build-publish/.test(c.path) && c.method === 'POST').map((c) => c.path);
  assert.deepEqual(flow, ['/api/build-publish/from-build', '/api/build-publish/run/BPUB-NEW-1/precheck', '/api/build-publish/run/BPUB-NEW-1/start'], '链路顺序：创建草稿 → 预检（检查阶段）→ 确认后启动');
  // REQ-20260929-002：检查通过后拉取发布计划（GET plan，二次确认弹窗展示服务端步骤数据）
  assert.equal(hh.calls.filter((c) => /\/plan$/.test(c.path)).length, 1, '检查通过后读取发布计划一次（确认弹窗展示步骤）');
  const start = hh.calls.find((c) => c.path.endsWith('/start'));
  assert.deepEqual(start.body, { token: 'fp-1' }, 'start 携带预检指纹 token（服务端守卫口径不变）');
  const create = hh.calls.find((c) => c.path === '/api/build-publish/from-build');
  assert.equal(create.body.version, '1.2.0', '检查阶段按计划版本号创建草稿');
  const inner = hh.inner();
  assert.ok(!inner.includes('发布二次确认'), '确认后弹窗关闭');
  assert.ok(!inner.includes('aria-label="发布记录"'), '启动后不渲染运行记录列表（模块删除）');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '启动后按钮禁用');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*发布中…\s*</, '启动后按钮文案为发布中');
});

t('R2c 复用口径：同发行版本号存在可续跑草稿（failed）时不再重复创建；版本号不匹配则新建', async () => {
  const hh = harness({ runs: [relRun({ id: 'BPUB-F', status: 'failed', version: '1.2.0' })] });
  await openRel(hh, 'BLD-A');
  await publish(hh, 'BLD-A');
  assert.equal(hh.calls.filter((c) => c.path === '/api/build-publish/from-build').length, 0, '同版本号可复用时不再创建新草稿');
  const flow = hh.calls.filter((c) => c.method === 'POST' && /run/.test(c.path)).map((c) => c.path);
  assert.deepEqual(flow, ['/api/build-publish/run/BPUB-F/precheck', '/api/build-publish/run/BPUB-F/start'], '检查与启动均对既有运行');
  // 版本号不匹配（存量 0.9.0 vs 计划 1.2.0）→ 新建草稿
  const h2 = harness({ runs: [relRun({ id: 'BPUB-OLD', status: 'failed', version: '0.9.0' })] });
  await openRel(h2, 'BLD-A');
  await publish(h2, 'BLD-A');
  assert.equal(h2.calls.filter((c) => c.path === '/api/build-publish/from-build').length, 1, '版本号不匹配时按确认版本新建草稿');
  assert.equal(h2.calls.filter((c) => c.path.endsWith('/start')).length, 1, '新建后链路照常启动');
});

t('R2d 检查未通过：列出失败项并明确提示本次不进入发布；不 start、不进入二次确认、不静默', async () => {
  const hh = harness({ runs: [], precheckOk: false });
  await openRel(hh, 'BLD-A');
  await startPublish(hh, 'BLD-A');
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/start')).length, 0, '检查未通过时发布中止，不发出 start');
  const inner = hh.inner();
  assert.match(inner, /检查未通过/, '检查未通过弹窗（明确提示）');
  assert.match(inner, /<strong>工作区<\/strong>[\s\S]{0,80}源码工作区有未提交修改/, '失败项 label 与 detail 可见（不静默）');
  assert.match(inner, /存在不通过项，本次不进入发布/, '明确提示不进入发布');
  assert.ok(!inner.includes('发布二次确认'), '不进入二次确认');
});

t('R2e 创建失败（如已有活动发布）：链路中止、检查未通过弹窗反馈服务端原因；不继续预检', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  hh.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    const method = (opts.method || 'GET').toUpperCase();
    hh.calls.push({ path: u.pathname, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: hh.live.versions }) };
    if (u.pathname === '/api/build-publish/from-build') return { ok: false, status: 409, json: async () => ({ error: '项目已有活动发布，请等待结束' }) };
    return { ok: true, json: async () => ({}) };
  };
  await startPublish(hh, 'BLD-A');
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/precheck')).length, 0, '创建失败后不继续预检');
  const inner = hh.inner();
  assert.match(inner, /检查未通过/, '检查未通过弹窗承载失败反馈');
  assert.match(inner, /项目已有活动发布，请等待结束/, '服务端原因可见');
});

t('R2f 防重复：检查 / 执行 busy 中重复触发不产生第二组请求；busy 中遮罩 / 取消不关闭弹窗', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  let release;
  hh.gates['/api/build-publish/from-build'] = () => new Promise((r) => { release = r; });
  hh.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  await hh.tick();
  // busy 中：遮罩与取消点击不关闭弹窗
  hh.el('#bldPublishWrap').listeners.click({ target: { id: 'bldPublishWrap' } });
  assert.match(hh.inner(), /发布前检查/, 'busy 中遮罩点击不关闭');
  hh.el('#bldRelCancel').listeners.click();
  assert.match(hh.inner(), /发布前检查/, 'busy 中取消不关闭');
  // busy 中重复触发检查：不发出第二个 from-build
  await hh.run(`window.ATBBuild.doPublishCheck()`);
  assert.equal(hh.calls.filter((c) => c.path === '/api/build-publish/from-build').length, 1, '检查执行中重复触发不发出第二个请求');
  release();
  await hh.tick();
  assert.match(hh.inner(), /发布二次确认（BLD-A）/, '检查完成后进入二次确认');
  // 确认执行 busy 防重复（gate start）
  let release2;
  hh.gates['/api/build-publish/run/BPUB-NEW-1/start'] = () => new Promise((r) => { release2 = r; });
  const p = hh.run(`window.ATBBuild.doPublishConfirm()`);
  await hh.tick();
  await hh.run(`window.ATBBuild.doPublishConfirm()`);
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/start')).length, 1, '执行中重复确认不发出第二个 start');
  release2();
  await p;
  await hh.tick();
  assert.ok(!hh.inner().includes('发布二次确认'), '完成后弹窗关闭');
});

t('R2g 存量计划无 version 字段：先弹发行版本号补填；空值提示且不发请求；填写后按填入版本创建', async () => {
  const hh = harness({ runs: [], versions: [ver('BLD-A', 'v1.2', 'merged', [verItem(1)], { version: undefined }), ver('BLD-B', 'v2.0', 'draft')] });
  await openRel(hh, 'BLD-A');
  hh.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  await hh.tick(2);
  let inner = hh.inner();
  assert.match(inner, /发行版本号（与版本显示名分开）/, '无版本号时弹窗提供补填输入');
  assert.ok(!inner.includes('即将发布版本'), '不显示版本号文案（待补填）');
  // 空值确认：提示且不发请求
  const posts0 = hh.calls.filter((c) => c.method === 'POST').length;
  hh.el('#bldRelVersion').value = '';
  await hh.run(`window.ATBBuild.doPublishCheck()`);
  await hh.tick();
  inner = hh.inner();
  assert.match(inner, /请填写发行版本号（如 1\.2\.0）/, '空值提示');
  assert.equal(hh.calls.filter((c) => c.method === 'POST').length, posts0, '空值不发任何执行请求');
  assert.match(inner, /发布（BLD-A）/, '弹窗保留可补填');
  // 填写后走链路
  hh.el('#bldRelVersion').value = '3.0.0';
  await hh.run(`window.ATBBuild.doPublishCheck()`);
  await hh.tick();
  const create = hh.calls.find((c) => c.path === '/api/build-publish/from-build');
  assert.equal(create.body.version, '3.0.0', '按补填版本号创建草稿');
});

/* ---------- R3 已发布态与状态反馈 ---------- */

t('R3a 已发布态从简：发布成功结果面板（发布时间本地时区 + 锁定说明），不堆叠记录 / 详情', async () => {
  const hh = harness({ runs: [relRun({ id: 'BPUB-S', status: 'succeeded', updatedAt: '2026-09-28T09:41:00.000Z' })] });
  await openRel(hh, 'BLD-A');
  await hh.tick();
  const inner = hh.inner();
  assert.match(inner, /✓ 发布成功/, '发布成功结果面板');
  const expected = hh.run(`window.ATBBuild.fmtTimeLocal('2026-09-28T09:41:00.000Z')`);
  assert.match(inner, new RegExp(`发布时间：${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}（本地时间）`), '发布时间按本地时区格式化并标注');
  assert.match(inner, /发布成功：版本计划标签已更新为「已发布」，发布计划已锁定、不允许再修改/, '发布成功说明（标签 + 锁定）');
  assert.match(inner, /如需调整请新建版本/, '锁定口径说明（不新增解锁路径）');
  assert.ok(!inner.includes('aria-label="发布记录"'), '不再堆叠发布记录列表');
  assert.ok(!inner.includes('aria-label="运行详情"'), '不再堆叠运行详情');
  assert.ok(!inner.includes('data-rel-run="BPUB-S"'), '发布记录卡片不再渲染');
});

t('R3b 加载 / 读取失败布局正常：加载提示；失败显示原因与只读重试（重试只重新读取记录）', async () => {
  // 加载中
  let hh = harness({ runs: [relRun({ id: 'BPUB-X', bldId: 'BLD-B' })] });
  await hh.enter();
  let release;
  hh.gates['/api/build-publish/state'] = () => new Promise((r) => { release = r; });
  hh.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  let inner = hh.inner();
  assert.match(inner, /正在加载发布记录…/, '加载提示');
  release();
  await hh.tick();
  // 读取失败 → 只读重试
  hh = harness({ runs: [] });
  await hh.enter();
  hh.sandbox.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'http://local');
    const method = (opts.method || 'GET').toUpperCase();
    hh.calls.push({ path: u.pathname, method, body: null });
    if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: hh.live.versions }) };
    if (u.pathname === '/api/build-publish/state') return { ok: false, status: 500, json: async () => ({ error: '数据库锁定' }) };
    return { ok: true, json: async () => ({}) };
  };
  hh.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await hh.tick();
  inner = hh.inner();
  assert.match(inner, /发布记录读取失败：数据库锁定/, '失败显示原因');
  assert.match(inner, /id="bldRelRetry"/, '只读重试入口');
  const posts = hh.calls.filter((c) => c.method === 'POST').length;
  assert.equal(posts, 0, '读取失败路径不发任何写请求');
});

/* ---------- R4 i18n（BUG-20260912-001 中英文同步） ---------- */

t('R4a 直线流程文案入 EN、含插值句入 EN_DYNAMIC，值不含中文', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['发布前检查', '正在按检查规则检查…', '检查未通过', '存在不通过项，本次不进入发布；请处理后重新点击「发布」。',
    '检查已全部通过。', '开始检查', '✓ 发布成功', '✕ 发布失败', '（本地时间）', '尚未发布。',
    '✓ 发布已开始，执行结束后在本页显示结果',
    '发布二次确认', '确认发布', '发布中…', '发布计划',
    '请填写发行版本号（如 1.2.0）', '发行版本号（与版本显示名分开）', '1.2.0（实际对外发行号）',
    '当前版本未合并，请先完成合并入 main。',
    '发布成功：版本计划标签已更新为「已发布」，发布计划已锁定、不允许再修改（关联条目与提交 / 合并入 main / AI 完善 / 文档合并等不可再调整，如需调整请新建版本）。',
    '仅已合并（merged）的版本计划可发布：请先完成「合并入 main」']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  for (const k of ['发布二次确认（◇）', '即将发布版本 v◇。', '发布（◇）', '发布时间：◇（本地时间）', '发布中止：◇', '✕ 发布中止：◇',
    '✕ 发布失败：◇', '✕ 发布检查失败：◇', '创建失败（◇）', '预检失败（◇）', '发布启动失败（◇）']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
});

/* ---------- S 静态契约 ---------- */

t('S1 静态契约：唯一发布入口绑定存在；重复「创建并预检」入口与旧堆叠模板整体移除；链路仍走独立 from-build', () => {
  assert.match(buildJs, /view\.querySelectorAll\('\[data-rel-publish\]'\)/, 'bindCommon 绑定唯一「发布」入口');
  assert.ok(!buildJs.includes('relCreateBtnHtml'), 'relCreateBtnHtml（重复创建入口模板）移除');
  assert.ok(!buildJs.includes('data-rel-create'), 'data-rel-create 行为标记移除');
  assert.ok(!buildJs.includes('data-ver-release'), 'data-ver-release（旧创建入口键）移除');
  assert.ok(!buildJs.includes('请先创建并预检'), '「请先创建并预检」不再作为发布按钮前置原因');
  assert.ok(!buildJs.includes('请重新预检并处理阻塞项'), '旧预检类原因文案移除（检查反馈在直线流程弹窗）');
  assert.match(buildJs, /\/api\/build-publish\/from-build/, '检查阶段创建草稿仍走独立 from-build 接口（服务端链路不变）');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
