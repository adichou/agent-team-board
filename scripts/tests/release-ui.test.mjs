#!/usr/bin/env node
// REQ-20260910-029 发布模块 —— 前端契约 + 行为测试 U1~U5、D1
// U1/U2/U8 为源码静态契约（index.html / app.js / release.js / style.css / ui-demo.html），
// U3~U5 为 vm 行为（加载实际 release.js，fetch stub 返回列表 / 详情 / 操作端点）。
// 用法：node scripts/tests/release-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const itemDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-029');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const relJs = fs.readFileSync(path.join(webRoot, 'release.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const demo = fs.readFileSync(path.join(itemDir, 'ui-demo.html'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 接缝（marketing-ui.test.mjs 同法） ---------- */
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    href: '',
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

const GIT_RUN = {
  id: 'REL-20260910-001', target: 'git', status: 'succeeded',
  createdAt: '2026-09-10T10:00:00.000Z',
  label: 'main',
  config: { remote: 'origin', sourceBranch: 'main', targetBranch: 'main', tagName: 'v1.2.0', checkCommand: 'npm test' },
  stages: [
    { key: 'freeze', label: '配置冻结', status: 'done' },
    { key: 'local-precheck', label: '本地预检', status: 'done' },
    { key: 'fetch-remote', label: '获取远端', status: 'done' },
    { key: 'quality-check', label: '质量检查', status: 'done' },
    { key: 'plan', label: '推送计划', status: 'done', result: { commits: ['abc1234 second'] } },
    { key: 'push', label: '执行推送', status: 'done' },
    { key: 'verify', label: '结果核验', status: 'done', result: { remoteOid: 'abc', frozenOid: 'abc' } },
  ],
  evidence: [], history: [{ at: '2026-09-10T10:05:00.000Z', action: 'verify', by: 'board' }],
};
const APPLE_RUN = {
  id: 'REL-20260910-002', target: 'apple', status: 'waiting-manual',
  createdAt: '2026-09-10T11:00:00.000Z',
  label: '1.2.0 (42)',
  config: { projectPath: 'App.xcodeproj', scheme: 'App', platform: 'ios', version: '1.2.0', build: '42' },
  stages: [
    { key: 'locate', label: '定位应用与材料', status: 'done' },
    { key: 'env-credentials', label: '环境与凭据', status: 'done' },
    { key: 'materials', label: '资料与合规', status: 'done' },
    { key: 'build', label: '版本与构建', status: 'done', result: { artifact: { path: '/tmp/xc/App.ipa', digest: 'sha256:ab' } } },
    { key: 'upload', label: '上传 TestFlight', status: 'done' },
    { key: 'submission-check', label: '提审前检查', status: 'done' },
    { key: 'review-data', label: '准备审核数据', status: 'done', result: { ascEntry: 'https://appstoreconnect.apple.com/apps/1', versionCreated: true, verified: true } },
    { key: 'track', label: '人工提审与跟踪', status: 'pending' },
  ],
  evidence: [], history: [],
};
const FAILED_RUN = {
  id: 'REL-20260910-003', target: 'git', status: 'failed',
  createdAt: '2026-09-10T12:00:00.000Z',
  label: 'release',
  config: { remote: 'origin', sourceBranch: 'main', targetBranch: 'release', tagName: null, checkCommand: 'npm test' },
  stages: [
    { key: 'freeze', label: '配置冻结', status: 'done' },
    { key: 'local-precheck', label: '本地预检', status: 'failed', error: { message: '工作区有未提交修改：a.txt', kind: 'dirty' } },
    { key: 'fetch-remote', label: '获取远端', status: 'pending' },
    { key: 'quality-check', label: '质量检查', status: 'pending' },
    { key: 'plan', label: '推送计划', status: 'pending' },
    { key: 'push', label: '执行推送', status: 'pending' },
    { key: 'verify', label: '结果核验', status: 'pending' },
  ],
  evidence: [], history: [],
};

function statePayload(runs = [APPLE_RUN, GIT_RUN, FAILED_RUN], env = { git: { repo: true, remotes: ['origin'] }, apple: { ascConfigured: true } }) {
  return { initialized: true, runs, env };
}

function detailPayload(run) {
  return { run, logs: { 'local-precheck': ['2026-09-10T12:00:01Z 工作区不干净'] } };
}

function setup({ state, detail, post = {} } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  document.nodes.set('#releaseView', element());
  document.addEventListener = () => {};
  const calls = [];
  const sandbox = {
    document, console, URLSearchParams, encodeURIComponent, decodeURIComponent,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date, Math, JSON,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '' },
    fetch: async (url, opts) => {
      const u = String(url);
      const method = (opts?.method || 'GET').toUpperCase();
      calls.push({ url: u, method, body: opts?.body ? JSON.parse(opts.body) : null });
      for (const [frag, resp] of Object.entries(post)) {
        if (u.includes(frag)) {
          return { ok: !!resp.ok, status: resp.ok ? (resp.status || 200) : (resp.status || 400), json: async () => resp.json || {} };
        }
      }
      const m = u.match(/\/api\/release\/run\/([^?]+)/);
      if (m && method === 'GET') {
        const found = [GIT_RUN, APPLE_RUN, FAILED_RUN].find((r) => r.id === decodeURIComponent(m[1]));
        return { ok: true, status: 200, json: async () => detailPayload(detail || found || APPLE_RUN) };
      }
      return { ok: true, status: 200, json: async () => (typeof state === 'function' ? state() : (state || statePayload())) };
    },
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(relJs, sandbox, { filename: 'release.js' });
  return { ...sandbox, calls };
}

const viewHtml = (h) => h.document.querySelector('#releaseView').innerHTML;
const node = (h, sel) => h.document.querySelector('#releaseView').querySelector(sel) || h.document.nodes.get(sel);

/* ---------- 静态契约 ---------- */

t('U1 骨架：发布入口随 REQ-20260911-002 暂态隐藏（导航无 data-view="release"）；容器与脚本接入保留', () => {
  const navMatch = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);
  assert.ok(navMatch, '应存在模块导航');
  const nav = navMatch[0];
  // REQ-20260911-002：发布入口暂态隐藏（恢复步骤见条目 design.md）；恢复后原序为 营销 → 发布 → 设置
  assert.doesNotMatch(nav, /data-view="release"/, '发布页签随入口暂态隐藏（REQ-20260911-002，模块代码保留）');
  assert.ok(html.includes('id="releaseView"'), '应存在发布视图容器');
  assert.match(html, /release\.js/, 'index.html 引入 release.js');
  const scriptIdx = html.indexOf('<script src="/release.js">');
  const appIdx = html.indexOf('<script src="/app.js">');
  assert.ok(scriptIdx > -1 && appIdx > scriptIdx, 'release.js 在 app.js 之前加载');
});

t('U2 app.js / style.css 契约：VIEWS、setView、快照、项目切换重置、样式与窄屏', () => {
  assert.match(app, /VIEWS = \[[^\]]*'release'/, 'VIEWS 含 release');
  assert.match(app, /\$\('#releaseView'\)\.classList\.toggle\('hidden', v !== 'release'\)/, 'setView 切换发布容器');
  assert.match(app, /ATBRelease\?\.enter\(/, '进入发布视图时激活模块');
  assert.match(app, /ATBRelease\?\.reset\?\.\(/, '切换项目重置发布模块');
  assert.match(app, /release: window\.ATBRelease\?\.snapshot\?\.\(\)/, '刷新快照含 release 节');
  assert.match(app, /ATBRelease\?\.restoreView\?/, '快照恢复委托发布模块');
  // REQ-20260911-002：发布入口暂态隐藏——MODULE_SUB 键移出，视图经 setView 兜底回落（恢复见条目 design.md）
  assert.match(app, /HIDDEN_VIEWS = new Set\(\[[^\]]*'release'/, '发布视图进 HIDDEN_VIEWS 暂态隐藏开关');
  assert.doesNotMatch(app.match(/const MODULE_SUB = \{[\s\S]*?\};/)[0], /release:\s*'/, 'release 副标题键随入口暂隐藏移出');

  assert.match(css, /\.release-view\s*\{/, '.release-view 容器样式');
  assert.match(css, /@media[^{]*max-width[^{]*\{[\s\S]*?\.rel-split\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/, '窄屏断点内分栏改上下排列');
  const relCss = css.slice(css.indexOf('.release-view'));
  assert.match(relCss, /var\(--panel\)/, '发布样式使用主题变量（深浅色自动适配）');
});

t('D1 ui-demo.html 离线可开且覆盖验收状态', () => {
  // 离线：无外部网络资源引用（脚本 / 样式 / 图片）
  const external = demo.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || [];
  assert.equal(external.length, 0, `不应有外部资源引用：${external.join(', ')}`);
  // 布局与交互要点
  for (const kw of ['新建发布', '发布', '营销', '设置', '阶段', '概览', '阶段日志', '产物', '操作历史']) {
    assert.ok(demo.includes(kw), `演示应包含「${kw}」`);
  }
  // 状态切换控制（正常 / 空 / 加载 / 失败 / 等待人工）
  for (const kw of ['空态', '加载', '失败', '待人工提审', '重试', '取消']) {
    assert.ok(demo.includes(kw), `演示控制条应覆盖「${kw}」状态`);
  }
  // 首期未开放的目标类型
  assert.match(demo, /网站|网络存储/, '扩展目标类型呈现');
  assert.match(demo, /首期未开放|暂未开放/, '标注首期未开放');
});

/* ---------- vm 行为 ---------- */

t('U3 运行列表 + 筛选 + 详情页签 + 新建面板类型选择与动态字段', async () => {
  const h = setup();
  await h.ATBRelease.enter('/p');
  let v = viewHtml(h);
  assert.ok(v.includes('REL-20260910-002'), '运行列表渲染');
  assert.ok(v.includes('Git') && v.includes('Apple'), '目标类型标识');
  assert.ok(v.includes('成功') || v.includes('已成功'), '状态呈现');

  // 筛选（目标 / 状态）
  const selT = node(h, '#relFilterTarget');
  selT.value = 'git';
  selT.listeners.change();
  assert.ok(!viewHtml(h).includes('REL-20260910-002'), '目标筛选生效');
  const selS = node(h, '#relFilterStatus');
  selT.value = '';
  selT.listeners.change();
  selS.value = 'waiting-manual';
  selS.listeners.change();
  v = viewHtml(h);
  assert.ok(v.includes('REL-20260910-002') && !v.includes('REL-20260910-001'), '状态筛选生效');

  // 点击运行 → 详情（阶段进度 + 页签）
  const list = node(h, '.rel-list');
  list.listeners.click({ target: { closest: () => ({ dataset: { runId: 'REL-20260910-002' } }) } });
  await new Promise((r) => setTimeout(r, 0));
  v = viewHtml(h);
  for (const kw of ['概览', '阶段日志', '产物', '操作历史']) assert.ok(v.includes(kw), `详情页签「${kw}」`);
  assert.ok(v.includes('待人工提审'), '等待人工状态');
  node(h, '[data-rel-tab="logs"]').listeners.click();
  assert.ok(viewHtml(h).length > 0, '页签切换后内容渲染');

  // 新建面板：类型选择 + 动态字段；web/storage 置灰首期未开放
  node(h, '#relNewBtn').listeners.click();
  v = viewHtml(h);
  assert.match(v, /首期未开放/, '扩展目标类型标注');
  const typeSel = node(h, '#relNewType');
  typeSel.value = 'git';
  typeSel.listeners.change();
  const fields = node(h, '#relNewFields').innerHTML;
  for (const kw of ['remote', '源分支', '目标分支', '校验命令']) assert.ok(fields.includes(kw), `Git 动态字段「${kw}」`);
  typeSel.value = 'apple';
  typeSel.listeners.change();
  const af = node(h, '#relNewFields').innerHTML;
  for (const kw of ['project', 'scheme', 'version', 'build']) assert.ok(af.includes(kw), `Apple 动态字段「${kw}」`);
});

t('U4 草稿保存 / 预检 / 计划确认后启动；重试 / 取消 / 刷新按钮按状态出现', async () => {
  const draftRun = { ...GIT_RUN, id: 'REL-20260910-009', status: 'draft', stages: GIT_RUN.stages.map((s) => ({ ...s, status: 'pending' })) };
  const plannedRun = {
    ...draftRun, status: 'draft',
    stages: draftRun.stages.map((s) => (s.key === 'plan' ? { ...s, status: 'done', result: { commits: ['abc1234 second'], planHash: 'h1' } } : (s.key === 'freeze' || s.key === 'local-precheck' || s.key === 'fetch-remote' || s.key === 'quality-check' ? { ...s, status: 'done' } : s))),
  };
  let current = plannedRun;
  const h = setup({
    state: () => statePayload([current]),
    detail: current,
    post: {
      '/api/release/run?': { ok: true, status: 201, json: { run: draftRun } },
      '/api/release/run/precheck': { ok: true, json: { run: plannedRun } },
      '/api/release/run/start': { ok: true, status: 200, json: { run: { ...current, status: 'running' } } },
    },
  });
  await h.ATBRelease.enter('/p');
  node(h, '#relNewBtn').listeners.click();
  const typeSel = node(h, '#relNewType');
  typeSel.value = 'git';
  typeSel.listeners.change();
  node(h, '#relNewRemote').value = 'origin';
  node(h, '#relNewSourceBranch').value = 'main';
  node(h, '#relNewTargetBranch').value = 'main';
  node(h, '#relNewCheckCommand').value = 'npm test';

  // 保存草稿
  node(h, '#relNewSave').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  const save = h.calls.find((c) => c.url.includes('/api/release/run') && c.method === 'POST' && c.body && c.body.target === 'git');
  assert.ok(save, '保存草稿提交 POST /api/release/run');
  assert.equal(save.body.config.sourceBranch, 'main');

  // 预检（不推送）
  node(h, '#relNewPrecheck').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(h.calls.some((c) => c.url.includes('/api/release/run/precheck')), '预检调用');

  // 启动发布：先展示计划再授权（确认前不调用 start）
  node(h, '#relNewStart').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.calls.filter((c) => c.url.includes('/api/release/run/start')).length, 0, '计划确认前不启动');
  assert.ok(node(h, '#relPlanModal').innerHTML.includes('main') || node(h, '#relPlanModal').classList.contains('hidden') === false, '展示发布计划');
  node(h, '#relPlanConfirm').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.calls.filter((c) => c.url.includes('/api/release/run/start')).length, 1, '确认后启动（用户授权该明确计划）');

  // 详情操作区按状态出现：失败 → 重试；运行中/等待 → 取消 / 刷新；等待人工 → 打开 ASC
  const hf = setup({ state: () => statePayload([FAILED_RUN]), detail: FAILED_RUN });
  await hf.ATBRelease.enter('/p');
  node(hf, '.rel-list').listeners.click({ target: { closest: () => ({ dataset: { runId: FAILED_RUN.id } }) } });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(node(hf, '#relActRetry'), '失败运行提供「重试失败阶段」');
  node(hf, '#relActRetry').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(hf.calls.some((c) => c.url.includes('/api/release/run/retry')), '重试调用');

  const hw = setup({ state: () => statePayload([APPLE_RUN]), detail: APPLE_RUN });
  await hw.ATBRelease.enter('/p');
  node(hw, '.rel-list').listeners.click({ target: { closest: () => ({ dataset: { runId: APPLE_RUN.id } }) } });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(node(hw, '#relActAsc'), '等待人工提供「打开 ASC」');
  assert.ok(viewHtml(hw).includes('appstoreconnect.apple.com'), 'ASC 入口链接');
  assert.ok(node(hw, '#relActRefresh'), '提供「刷新状态」');
  node(hw, '#relActRefresh').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(hw.calls.some((c) => c.url.includes('/api/release/run/refresh')), '刷新调用');
});

t('U5 空态与配置指引、加载态、失败红显原因', async () => {
  // 空态：无运行 + 无 remote / 无 ASC 凭据 → 配置指引而非空列表
  const he = setup({ state: statePayload([], { git: { repo: false, remotes: [] }, apple: { ascConfigured: false } }) });
  await he.ATBRelease.enter('/p');
  const v = viewHtml(he);
  assert.match(v, /新建发布/, '空态提供新建入口');
  assert.match(v, /remote/, '无 Git remote 配置指引');
  assert.match(v, /appstoreconnect|ASC/, 'ASC 凭据配置指引');

  // 加载态
  let resolveState;
  const hl = setup({ state: () => new Promise((r) => { resolveState = r; }) });
  const entered = hl.ATBRelease.enter('/p');
  await new Promise((r) => setTimeout(r, 0));
  assert.match(viewHtml(hl), /加载/, '列表与详情拉取时显示加载指示');
  resolveState(statePayload([GIT_RUN]));
  await entered;

  // 失败态：失败阶段红显原因
  const hfail = setup({ state: () => statePayload([FAILED_RUN]), detail: FAILED_RUN });
  await hfail.ATBRelease.enter('/p');
  node(hfail, '.rel-list').listeners.click({ target: { closest: () => ({ dataset: { runId: FAILED_RUN.id } }) } });
  await new Promise((r) => setTimeout(r, 0));
  const dv = viewHtml(hfail);
  assert.ok(dv.includes('未提交修改'), '失败阶段展示原因');
  assert.ok(node(hfail, '.rel-stages').innerHTML.includes('failed') || dv.includes('未提交修改'), '失败阶段红显（st-failed）');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}\n    ${String(e.stack).split('\n').slice(1, 3).join('\n    ')}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
