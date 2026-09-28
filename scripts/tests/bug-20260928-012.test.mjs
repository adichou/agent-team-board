#!/usr/bin/env node
// BUG-20260928-012 发布页面取消草稿模块：删除发布运行记录展示模块（列表卡片 / 运行详情），
// 发布交互收敛为「检查提示 → 二次确认 → 执行 → 出结果」一条直线；成功显示发布时间（本地
// 时区格式化），失败显示错误信息与「重试」；targets 摘要对象渲染缺陷（[object Object]）
// 随模块删除消除，release.js 同构摘要改为按状态标签显示。假 DOM 口径同 build-ui.test.mjs。
// 用法：node scripts/tests/bug-20260928-012.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');
const releaseJs = fs.readFileSync(path.join(webRoot, 'release.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 假 DOM（口径同 bug-20260928-002.test.mjs） ---------- */

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

// /api/build-publish 运行记录（state 与 run 详情共用形状；precheck 由用例按需附加）
function relRun(o = {}) {
  return {
    id: 'BPUB-20260928-0001', productId: 'proj', bldId: 'BLD-A', bldName: 'v1.2',
    version: '1.2.0', status: 'draft',
    createdAt: '2026-09-28T08:00:00.000Z', updatedAt: '2026-09-28T08:30:00.000Z',
    targets: { webapp: { status: 'pending' }, site: { status: 'pending' } },
    stages: [], logs: [], error: null,
    ...o,
  };
}

function relDetail(run) {
  return { run: JSON.parse(JSON.stringify(run)), logs: run.logs || [], directories: {} };
}

function setup({ versions = [ver('BLD-A', 'v1.2', 'merged'), ver('BLD-B', 'v2.0', 'draft')], runs = [], config = { homepageRepoRoot: '/tmp/hp' }, precheckChecks = null } = {}) {
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
        if (action === 'plan') return { ok: true, json: async () => ({ plan: { token: 'fp-1', steps: ['步骤一'] } }) };
        if (action === 'precheck') {
          const run = cur();
          run.precheck = precheckChecks
            ? JSON.parse(JSON.stringify(precheckChecks))
            : { ok: true, checks: [{ label: '发布文档', ok: true }, { label: '挑选条目', ok: true }], fingerprint: 'fp-1' };
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

const harness = setup;

async function openRel(hh, id = 'BLD-A') {
  await hh.enter();
  hh.run(`window.ATBBuild.openReleaseTab('${id}')`);
  await hh.tick();
}

// 直线发布：点击「发布」→（检查）→ 二次确认 →（确认执行）
async function startPublish(hh, id = 'BLD-A') {
  hh.run(`window.ATBBuild.openPublishConfirm('${id}')`);
  await hh.tick();
}
async function confirmPublish(hh) {
  await hh.run(`window.ATBBuild.doPublishConfirm()`);
  await hh.tick();
}

/* ---------- M1 模块删除 ---------- */

t('M1a 草稿态运行存在：发布页签不再渲染记录列表 / 运行详情 / 摘要 / 取消草稿入口，无 [object Object]', async () => {
  const hh = harness({ runs: [relRun({ id: 'BPUB-DRAFT', status: 'draft', targets: { webapp: { status: 'pending' }, site: { status: 'pending' } } })] });
  await openRel(hh, 'BLD-A');
  await hh.tick();
  const inner = hh.inner();
  assert.ok(!inner.includes('aria-label="发布记录"'), '不再渲染发布记录列表');
  assert.ok(!inner.includes('data-rel-run='), '不再渲染运行卡片（data-rel-run）');
  assert.ok(!inner.includes('aria-label="运行详情"'), '不再渲染运行详情面板');
  assert.ok(!inner.includes('[object Object]'), '不再出现 [object Object] 摘要');
  assert.ok(!inner.includes('Web App'), '不再出现 Web App 目标摘要行');
  assert.ok(!inner.includes('取消草稿'), '不新增「取消草稿」入口');
  assert.ok(!inner.includes('data-rel-act'), '不再渲染运行详情动作区');
  assert.match(inner, /尚未发布/, '空闲（未发布）直线流程说明');
});

t('M1b 运行详情既有动作入口整体移除（预检 / 重新冻结 / 预览发布计划 / 刷新状态 / 取消后续阶段 / 目录）', () => {
  for (const gone of ['renderRelDetailPane', 'relAction', 'openRelPlan', 'confirmRelStart', 'selectReleaseRun',
    'openPublishDirectory', 'renderPublishDirectories', 'data-rel-act', 'data-publish-open', 'data-rel-detail-retry',
    'bldRelPlanCancel', 'bldRelPlanConfirm', 'renderRelPlanModal']) {
    assert.ok(!buildJs.includes(gone), `${gone} 应随模块删除移除`);
  }
  assert.ok(!buildJs.includes("r.targets?.webapp] || r.targets?.webapp"), 'build.js 不再把 targets 对象当状态字符串拼接');
});

t('M1c release.js 摘要按状态标签显示（targets.webapp.status），字段缺失显示「未提供」', () => {
  assert.match(releaseJs, /TARGET_STATUS_LABEL\[r\.targets\?\.webapp\?\.status\] \|\| '未提供'/, 'Web App 摘要按状态标签渲染');
  assert.match(releaseJs, /TARGET_STATUS_LABEL\[r\.targets\?\.site\?\.status\] \|\| '未提供'/, '官网摘要按状态标签渲染');
  assert.ok(!releaseJs.includes('TARGET_STATUS_LABEL[r.targets?.webapp] ||'), '不再把对象整体作回退拼接');
  assert.ok(!releaseJs.includes('TARGET_STATUS_LABEL[r.targets?.site] ||'), '不再把对象整体作回退拼接');
});

/* ---------- M2 发布直线流程 ---------- */

t('M2a 点击「发布」先检查：弹「发布前检查」并自动创建草稿 + 预检；通过后弹二次确认；确认前不发 start', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  let release;
  hh.gates['/api/build-publish/from-build'] = () => new Promise((r) => { release = r; });
  hh.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  await hh.tick();
  let inner = hh.inner();
  assert.match(inner, /发布前检查/, '检查弹窗标题');
  assert.match(inner, /正在按检查规则检查…/, '检查中提示');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '检查中「发布」按钮禁用');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*发布中…\s*</, '检查中按钮文案「发布中…」');
  release();
  await hh.tick();
  inner = hh.inner();
  assert.match(inner, /发布二次确认（BLD-A）/, '检查通过后进入二次确认弹窗');
  assert.match(inner, /即将发布版本 v1\.2\.0。/, '二次确认提示即将发布的版本号');
  assert.match(inner, /检查已全部通过/, '检查通过说明');
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/start')).length, 0, '确认前不发出 start');
  const posts = hh.calls.filter((c) => c.method === 'POST' && /build-publish/.test(c.path)).map((c) => c.path);
  assert.deepEqual(posts, ['/api/build-publish/from-build', '/api/build-publish/run/BPUB-NEW-1/precheck'], '检查 = 创建草稿 + 预检');
});

t('M2b 检查未通过：列出失败项并明确提示本次不进入发布；不进入二次确认、不发 start', async () => {
  const hh = harness({ runs: [], precheckChecks: { ok: false, checks: [{ label: '发布文档', ok: true }, { label: '挑选条目', ok: false, detail: '条目 REQ-20260928-001 的提交（aaaaaaaaaaaa）未包含在主分支（含重放证据核对）' }], fingerprint: null } });
  await openRel(hh, 'BLD-A');
  await startPublish(hh, 'BLD-A');
  const inner = hh.inner();
  assert.match(inner, /检查未通过/, '检查未通过弹窗');
  assert.match(inner, /挑选条目/, '失败项 label 可见');
  assert.match(inner, /未包含在主分支/, '失败项 detail 可见');
  assert.match(inner, /存在不通过项，本次不进入发布/, '明确提示不进入发布');
  assert.ok(!inner.includes('发布二次确认'), '不进入二次确认');
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/start')).length, 0, '不发 start');
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/precheck')).length, 1, '检查只执行一次');
});

t('M2c 检查未通过关闭弹窗后可重新发布：再次点击「发布」重新走检查', async () => {
  const hh = harness({ runs: [], precheckChecks: { ok: false, checks: [{ label: '发布文档', ok: false, detail: '发布文档未全部审核通过' }], fingerprint: null } });
  await openRel(hh, 'BLD-A');
  await startPublish(hh, 'BLD-A');
  hh.el('#bldRelBack').listeners.click();
  let inner = hh.inner();
  assert.ok(!inner.includes('检查未通过'), '关闭后弹窗消失');
  assert.doesNotMatch(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '「发布」按钮恢复可用');
  // 修复阻塞项后重新检查通过 → 进入二次确认
  hh.run('window.__fix = true');
  const pre = hh.calls.filter((c) => c.path.endsWith('/precheck')).length;
  await startPublish(hh, 'BLD-A');
  inner = hh.inner();
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/precheck')).length, pre + 1, '重新点击「发布」重新执行检查');
});

t('M2d 确认后执行：确认 → start（token = 预检指纹）；执行期间无中间进度界面；结束后成功面板显示发布时间（本地时间）', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  await startPublish(hh, 'BLD-A');
  await confirmPublish(hh);
  const start = hh.calls.find((c) => c.path.endsWith('/start'));
  assert.deepEqual(start.body, { token: 'fp-1' }, 'start 携带预检指纹 token（服务端守卫不变）');
  let inner = hh.inner();
  assert.ok(!inner.includes('发布二次确认'), '确认后弹窗关闭');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '执行中按钮禁用');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*发布中…\s*</, '执行中按钮文案「发布中…」');
  assert.ok(!inner.includes('执行中'), '无「执行中」中间进度界面');
  assert.ok(!inner.includes('阶段</strong>'), '无分阶段进度列表');
  assert.ok(!inner.includes('aria-label="运行详情"'), '无运行详情面板');
  // 执行结束（轮询单轮发现 succeeded）→ 成功面板 + 发布时间本地时间
  const run = hh.live.runs.find((r) => r.id === 'BPUB-NEW-1');
  run.status = 'succeeded';
  run.updatedAt = '2026-09-28T09:41:05.000Z';
  await hh.run('window.ATBBuild.releasePoll()');
  await hh.tick(10);
  inner = hh.inner();
  assert.match(inner, /✓ 发布成功/, '成功结果面板');
  const expected = hh.run(`window.ATBBuild.fmtTimeLocal('2026-09-28T09:41:05.000Z')`);
  assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(expected), '本地时间格式 YYYY-MM-DD HH:mm:ss');
  assert.match(inner, new RegExp(`发布时间：${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}（本地时间）`), '发布时间按本地时区格式化并标注');
  assert.match(inner, /发布成功：版本计划标签已更新为「已发布」，发布计划已锁定/, '锁定说明保留');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*已发布\s*</, '已发布按钮文案');
});

t('M2e 失败结果面板：显示错误信息与「重试」；重试重新走同一发布流程（检查 → 确认 → 执行）并再次到达结果态', async () => {
  const failedRun = relRun({ id: 'BPUB-F', status: 'failed', version: '1.2.0', error: { message: '官网部署失败：仓库推送被拒绝', stage: 'site-deploy' }, stages: [{ key: 'site-deploy', label: '官网构建与部署', status: 'failed' }] });
  const hh = harness({ runs: [failedRun] });
  await openRel(hh, 'BLD-A');
  let inner = hh.inner();
  assert.match(inner, /✕ 发布失败/, '失败结果面板');
  assert.match(inner, /官网部署失败：仓库推送被拒绝/, '失败错误信息可见');
  assert.match(inner, /官网构建与部署/, '失败阶段可见');
  assert.match(inner, /data-rel-retry-publish/, '「重试」按钮存在');
  const posts0 = hh.calls.filter((c) => c.method === 'POST').length;
  hh.run(`window.ATBBuild.retryPublish()`);
  await hh.tick();
  inner = hh.inner();
  assert.equal(hh.calls.filter((c) => c.method === 'POST').length, posts0 + 1, '重试重新走检查（对可续跑运行预检，不重复创建）');
  assert.match(inner, /发布前检查|发布二次确认/, '重试回到直线流程（检查）');
  await confirmPublish(hh);
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/start')).length, 1, '重试链路确认后执行 start');
  // 重试成功 → 结果态翻转为成功面板
  const run = hh.live.runs.find((r) => r.id === 'BPUB-F');
  run.status = 'succeeded';
  run.updatedAt = '2026-09-28T10:00:00.000Z';
  await hh.run('window.ATBBuild.releasePoll()');
  await hh.tick(10);
  assert.match(hh.inner(), /✓ 发布成功/, '重试后再次到达成功结果态');
});

t('M2f 存量计划无 version 字段：先弹发行版本号补填；空值提示且不发请求；填写后进入检查并按填入版本创建', async () => {
  const hh = harness({ runs: [], versions: [ver('BLD-A', 'v1.2', 'merged', [verItem(1)], { version: undefined }), ver('BLD-B', 'v2.0', 'draft')] });
  await openRel(hh, 'BLD-A');
  hh.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  await hh.tick(2);
  let inner = hh.inner();
  assert.match(inner, /发行版本号（与版本显示名分开）/, '无版本号时提供补填输入');
  const posts0 = hh.calls.filter((c) => c.method === 'POST').length;
  hh.el('#bldRelVersion').value = '';
  await hh.run(`window.ATBBuild.doPublishCheck()`);
  await hh.tick();
  inner = hh.inner();
  assert.match(inner, /请填写发行版本号（如 1\.2\.0）/, '空值提示');
  assert.equal(hh.calls.filter((c) => c.method === 'POST').length, posts0, '空值不发任何执行请求');
  hh.el('#bldRelVersion').value = '3.0.0';
  await hh.run(`window.ATBBuild.doPublishCheck()`);
  await hh.tick();
  const create = hh.calls.find((c) => c.path === '/api/build-publish/from-build');
  assert.equal(create.body.version, '3.0.0', '按补填版本号创建草稿');
  assert.match(hh.inner(), /发布二次确认（BLD-A）/, '检查通过后进入二次确认');
});

t('M2g 防重复：检查 busy 中重复确认不产生第二组请求；busy 中取消 / 遮罩点击不关闭弹窗', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  let release;
  hh.gates['/api/build-publish/from-build'] = () => new Promise((r) => { release = r; });
  hh.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  await hh.tick();
  hh.el('#bldPublishWrap').listeners.click({ target: { id: 'bldPublishWrap' } });
  assert.match(hh.inner(), /发布前检查/, 'busy 中遮罩点击不关闭');
  hh.el('#bldRelCancel').listeners.click();
  assert.match(hh.inner(), /发布前检查/, 'busy 中取消不关闭');
  await hh.run(`window.ATBBuild.doPublishCheck()`);
  assert.equal(hh.calls.filter((c) => c.path === '/api/build-publish/from-build').length, 1, 'busy 中重复触发不发出第二个请求');
  release();
  await hh.tick();
  assert.match(hh.inner(), /发布二次确认/, '检查完成后进入二次确认');
  // 确认 busy 防重复（gate start）
  let release2;
  hh.gates['/api/build-publish/run/BPUB-NEW-1/start'] = () => new Promise((r) => { release2 = r; });
  const p = hh.run(`window.ATBBuild.doPublishConfirm()`);
  await hh.tick();
  await hh.run(`window.ATBBuild.doPublishConfirm()`);
  assert.equal(hh.calls.filter((c) => c.path.endsWith('/start')).length, 1, '执行中重复确认不发出第二个 start');
  release2();
  await p;
  await hh.tick();
});

t('M2h 检查请求失败（如创建 409）：链路中止、检查未通过弹窗反馈服务端原因；不继续预检', async () => {
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

t('M2i 草稿复用口径不变：同发行版本号存在可续跑运行（failed）时不再创建；版本号不匹配则新建', async () => {
  const hh = harness({ runs: [relRun({ id: 'BPUB-F', status: 'failed', version: '1.2.0' })] });
  await openRel(hh, 'BLD-A');
  await startPublish(hh, 'BLD-A');
  await confirmPublish(hh);
  assert.equal(hh.calls.filter((c) => c.path === '/api/build-publish/from-build').length, 0, '同版本号可复用时不再创建新草稿');
  const posts = hh.calls.filter((c) => c.method === 'POST' && /run/.test(c.path)).map((c) => c.path);
  assert.ok(posts.includes('/api/build-publish/run/BPUB-F/precheck'), '对既有运行预检');
  assert.ok(posts.includes('/api/build-publish/run/BPUB-F/start'), '确认后对既有运行启动');
  const h2 = harness({ runs: [relRun({ id: 'BPUB-OLD', status: 'failed', version: '0.9.0' })] });
  await openRel(h2, 'BLD-A');
  await startPublish(h2, 'BLD-A');
  await confirmPublish(h2);
  assert.equal(h2.calls.filter((c) => c.path === '/api/build-publish/from-build').length, 1, '版本号不匹配时按确认版本新建草稿');
});

t('M2j 恢复场景：进入发布步发现既有 running 运行：按钮「发布中…」禁用、无中间进度；轮询结束后直接出结果', async () => {
  const hh = harness({ runs: [relRun({ id: 'BPUB-R', status: 'running' })] });
  await openRel(hh, 'BLD-A');
  await hh.tick();
  let inner = hh.inner();
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '发布中禁用');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*发布中…\s*</, '发布中按钮文案');
  assert.ok(!inner.includes('执行中'), '无「执行中」中间进度界面');
  assert.ok(!inner.includes('aria-label="运行详情"'), '无运行详情面板');
  const run = hh.live.runs.find((r) => r.id === 'BPUB-R');
  run.status = 'failed';
  run.error = { message: 'Web App 版本回验失败', stage: 'webapp-verify' };
  await hh.run('window.ATBBuild.releasePoll()');
  await hh.tick(10);
  inner = hh.inner();
  assert.match(inner, /✕ 发布失败/, '轮询结束后直接显示失败结果');
  assert.match(inner, /Web App 版本回验失败/, '失败错误信息可见');
  assert.match(inner, /data-rel-retry-publish/, '失败面板提供重试');
});

/* ---------- M3 其余状态与页签 ---------- */

t('M3a 空闲（未发布）：直线流程说明 + 唯一可点击的「发布」入口；无记录列表 / 详情', async () => {
  const hh = harness({ runs: [] });
  await openRel(hh, 'BLD-A');
  const inner = hh.inner();
  const pubBtns = inner.match(/data-rel-publish="[^"]*"/g) || [];
  assert.equal(pubBtns.length, 1, '「发布」按钮唯一');
  assert.ok(!/data-rel-publish="BLD-A"[^>]*disabled/.test(inner), '已合并 + 已配置时可点击');
  assert.match(inner, /尚未发布/, '空闲说明');
  assert.match(inner, /先按检查规则检查/, '直线流程口径说明');
  assert.ok(!inner.includes('aria-label="发布记录"'), '无发布记录列表');
});

t('M3b 禁用口径保留：未合并 / 未配置 / 发布中 / 已发布分别禁用并就近说明；未配置保留「前往设置」', async () => {
  let hh = harness({ runs: [] });
  await openRel(hh, 'BLD-B');
  let inner = hh.inner();
  assert.match(inner, /data-rel-publish="BLD-B"[^>]*disabled/, '未合并版本发布禁用');
  assert.match(inner, /请先完成合并入 main/, '未合并就近说明');
  hh = harness({ runs: [], config: {} });
  await openRel(hh, 'BLD-A');
  inner = hh.inner();
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '未配置官网仓库发布禁用');
  assert.match(inner, /请先配置官网仓库/, '未配置就近说明');
  assert.match(inner, /data-publish-settings>[^<]*前往设置/, '未配置保留「前往设置」');
  hh = harness({ runs: [relRun({ id: 'BPUB-S', status: 'succeeded', updatedAt: '2026-09-28T09:41:00.000Z' })] });
  await openRel(hh, 'BLD-A');
  await hh.tick();
  inner = hh.inner();
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*disabled/, '已发布禁用');
  assert.match(inner, /data-rel-publish="BLD-A"[^>]*>\s*已发布\s*</, '已发布按钮文案');
});

t('M3c 加载 / 读取失败：加载提示；失败显示原因与只读重试（不发写请求）', async () => {
  let hh = harness({ runs: [] });
  await hh.enter();
  let release;
  hh.gates['/api/build-publish/state'] = () => new Promise((r) => { release = r; });
  hh.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  assert.match(hh.inner(), /正在加载发布记录…/, '加载提示');
  release();
  await hh.tick();
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
  const inner = hh.inner();
  assert.match(inner, /发布记录读取失败：数据库锁定/, '失败显示原因');
  assert.match(inner, /id="bldRelRetry"/, '只读重试入口');
  assert.equal(hh.calls.filter((c) => c.method === 'POST').length, 0, '读取失败路径不发任何写请求');
});

/* ---------- M4 i18n（BUG-20260912-001 中英文同步） ---------- */

t('M4a 新增静态文案入 EN、含插值句入 EN_DYNAMIC，值不含中文', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of ['发布前检查', '正在按检查规则检查…', '发布检查中…', '检查未通过', '存在不通过项，本次不进入发布；请处理后重新点击「发布」。',
    '检查已全部通过。', '开始检查', '返回', '✓ 发布成功', '✕ 发布失败', '重试', '（本地时间）', '尚未发布。',
    '重试重新走发布流程（检查 → 确认 → 执行）。',
    '点击「发布」：先按检查规则检查，有不通过项会明确提示且不进入发布；全部通过并二次确认后执行，执行结果直接在本页显示（成功显示发布时间，失败显示原因与重试）。',
    '✕ 检查未通过，未进入发布', '✓ 检查已全部通过，请二次确认', '✓ 发布已开始，执行结束后在本页显示结果']) {
    assert.ok(EN[k], `EN 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不含中文：${k}`);
  }
  for (const k of ['发布时间：◇（本地时间）', '✓ 发布成功（v◇）', '✕ 发布失败：◇', '发布二次确认（◇）', '即将发布版本 v◇。',
    '发布（◇）', '✕ 发布检查失败：◇']) {
    assert.ok(EN_DYNAMIC[k], `EN_DYNAMIC 应含「${k}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN_DYNAMIC[k]), `EN_DYNAMIC 值不含中文：${k}`);
  }
  // 旧模块删除后不再渲染的词条清理（不残留死词条；release.js 仍在用的词条不在清理范围）
  for (const gone of ['当前版本暂无发布记录。点击「发布」直接弹出二次确认，确认后自动创建发布草稿并预检、随后直接启动发布。',
    '✓ 发布已启动（◇）：执行进度见下方运行详情', '发布时间：◇', '预检未通过：◇：◇',
    '预检未通过：请处理阻塞项后重试', '启动中…', '当前版本暂无发布记录']) {
    assert.ok(!EN_DYNAMIC[gone] && !EN[gone], `已删除模块的词条应清理：${gone}`);
  }
});

/* ---------- S 静态契约 ---------- */

t('S1 静态契约：直线流程状态与轮询接线存在；from-build / precheck / start 服务端链路不变；本地时间格式化接缝', () => {
  assert.match(buildJs, /releaseFlow/, '发布直线流程会话态（releaseFlow）');
  assert.match(buildJs, /releasePoll/, '发布执行轮询（releasePoll）');
  assert.match(buildJs, /stopReleasePoll/, '轮询停止接缝（切步 / 切版本 / 切项目）');
  assert.match(buildJs, /fmtTimeLocal/, '本地时间格式化（发布时间）');
  assert.match(buildJs, /\/api\/build-publish\/from-build/, '检查阶段创建草稿仍走 from-build');
  assert.match(buildJs, /\/precheck/, '检查仍走服务端预检');
  assert.ok(buildJs.includes('doPublishConfirm'), '二次确认执行接缝（doPublishConfirm）');
  assert.ok(buildJs.includes('retryPublish'), '失败重试接缝（retryPublish）');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
