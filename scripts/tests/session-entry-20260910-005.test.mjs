#!/usr/bin/env node
// BUG-20260910-005「打开 XX 工作区」改为头部「去新建 XX 会话」超链接 —— 位置迁移 + 状态机 + 交互测试
// 覆盖 README 期望行为（界面展示/交互/正常/空态/加载/失败）与验收要点（静态可测部分；
// 实机客户端落点为人工项，见条目 test-report.md）
// 用法：node scripts/tests/session-entry-20260910-005.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(name) {
  const m = js.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

// ---------- vm 沙箱（复用 workspace-entry 的面板渲染模式） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
  };
}

function setupUI() {
  const document = element();
  document.createElement = element;
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    fetch: async () => ({ ok: true, json: async () => ({}) }) };
  vm.createContext(sandbox);
  vm.runInContext(js.split('\nboot();')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/p';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {};');
  return { sandbox, document, state, run };
}

const mkBatch = (extra = {}) => ({
  batchId: 'B-20990910-001', mode: 'zcode', agent: 'zcode', status: 'running',
  abortRequested: false, aborted: false, pauseRequested: false, developer: null,
  createdAt: '2026-09-10T00:00:00.000Z', lastActivityAt: '2026-09-10T00:10:00.000Z',
  candidates: [], prompt: '主调度提示词内容', ...extra,
});

const devRunData = (extra = {}) => ({
  batch: mkBatch(),
  current: null,
  counts: { total: 5, reported: 2, failed: 1, blockedRuns: 0, interrupted: 0, remaining: 2 },
  queue: [], pending: [], records: [], recordsTotal: 0, nextAction: 'stop', notice: null, stats: { candidates: 1, blocked: 0 },
  ...extra,
});

const refineRunData = (extra = {}) => ({
  batch: { ...mkBatch(), batchId: 'RFB-20990910-001' },
  current: null,
  counts: { total: 2, done: 1, failed: 0, skipped: 0, interrupted: 0, remaining: 1 },
  candidates: [], records: [], recordsTotal: 0, nextAction: 'stop', notice: null, stats: { candidates: 1 },
  ...extra,
});

function paneSlice(html, key) {
  const start = html.indexOf(`data-pane="${key}"`);
  assert.ok(start > 0, `应存在 ${key} 分区`);
  const next = ['overview', 'queue', 'prompt', 'records'].map((k) => html.indexOf(`data-pane="${k}"`, start + 1)).filter((p) => p > 0);
  return html.slice(start, next.length ? Math.min(...next) : undefined);
}

// 已知态（探测完成）下的头部入口渲染
const knownApps = (zcode = true, codex = true) => ({ zcode, codex, loaded: true, probing: false, failed: false });

// ---------- H1 位置与形态：一级页签旁的文字超链接，非页签样式 ----------

t('H1 头部位置：renderBatchDrawer 头部在 batch-modes 页签（批量开发之后）渲染 newSessionLinksHtml，两类面板共用，链接为 <a> 非页签胶囊', () => {
  const src = fnSrc('renderBatchDrawer');
  assert.match(src, /nav class="tabs batch-modes"/, '头部应保留一级页签 nav');
  const navPos = src.indexOf('batch-modes');
  const devPos = src.indexOf('data-bmode="develop"');
  const entryPos = src.indexOf('newSessionLinksHtml()');
  assert.ok(navPos >= 0 && devPos > navPos && entryPos > devPos, '入口应在「批量开发」页签之后（旁边）');
  assert.ok(entryPos < src.indexOf('drawer-body'), '入口在头部，先于内容区');
  // 已知态输出：两个文字超链接，Zcode 在前、Codex 在后，均非 .tab 样式
  const h = setupUI();
  h.state.workspaceApps = knownApps();
  const html = h.run('newSessionLinksHtml()');
  const z = html.match(/<a[^>]*data-new-session="zcode"[^>]*>[\s\S]*?<\/a>/);
  const c = html.match(/<a[^>]*data-new-session="codex"[^>]*>[\s\S]*?<\/a>/);
  assert.ok(z, '应存在 zcode 会话链接');
  assert.ok(c, '应存在 codex 会话链接');
  assert.ok(!z[0].includes('class="tab') && !c[0].includes('class="tab'), '链接不得使用页签样式类');
  assert.ok(html.indexOf('data-new-session="zcode"') < html.indexOf('data-new-session="codex"'), 'Zcode 在前、Codex 并列在后');
  assert.match(z[0], /去新建 Zcode 会话/);
  assert.match(c[0], /去新建 Codex 会话/);
});

t('H1b 外观区分：CSS 提供超链接样式（下划线链接、禁用置灰、可见说明），与页签胶囊区分；头部弹性同行布局', () => {
  assert.match(css, /\.ws-entry-link\s*\{[^}]*text-decoration:\s*underline/, '链接应为下划线文字超链接样式');
  assert.match(css, /\.ws-entry-link\.is-off\s*\{[^}]*cursor:\s*not-allowed/, '禁用态置灰且不可点样式');
  assert.match(css, /\.ws-entry-note\s*\{/, '可见说明（未检测到）样式存在');
  assert.match(css, /\.batch-drawer \.drawer-head\s*\{[^}]*display:\s*flex/, '头部应弹性布局使链接与页签同行');
});

// ---------- H2 正常态：可操作 + 提示 Agent 与当前项目 ----------

t('H2 正常态：检测到客户端且已选项目 → 链接带深链 href 与 title（Agent + 当前项目绝对目录）', () => {
  const h = setupUI();
  h.state.project = '/Users/x/我的 项目/atb';
  h.state.workspaceApps = knownApps();
  const html = h.run('newSessionLinksHtml()');
  const z = html.match(/<a[^>]*data-new-session="zcode"[^>]*>[\s\S]*?<\/a>/)[0];
  const c = html.match(/<a[^>]*data-new-session="codex"[^>]*>[\s\S]*?<\/a>/)[0];
  assert.ok(!z.includes('aria-disabled') && !c.includes('aria-disabled'), '正常态不禁用');
  const enc = encodeURIComponent('/Users/x/我的 项目/atb');
  assert.ok(z.includes(`href="zcode://workspace/open?path=${enc}"`), 'Zcode href 为 workspace/open 深链（路径全量编码）');
  assert.ok(c.includes(`href="codex://threads/new?path=${enc}"`), 'Codex href 为 threads/new 深链');
  assert.match(z, /title="[^"]*Zcode[^"]*\/Users\/x\/我的 项目\/atb[^"]*"/, 'Zcode title 应含 Agent 名与当前项目');
  assert.match(c, /title="[^"]*Codex[^"]*\/Users\/x\/我的 项目\/atb[^"]*"/, 'Codex title 应含 Agent 名与当前项目');
});

// ---------- H3 口径：不宣称自动新建/创建成功 ----------

t('H3 口径：Zcode 明确深链只打开工作区、会话需手动新建；Codex 明确不自动发送；提示文案只说「已请求打开」', () => {
  const h = setupUI();
  h.state.workspaceApps = knownApps();
  const html = h.run('newSessionLinksHtml()');
  const z = html.match(/<a[^>]*data-new-session="zcode"[^>]*>[\s\S]*?<\/a>/)[0];
  const c = html.match(/<a[^>]*data-new-session="codex"[^>]*>[\s\S]*?<\/a>/)[0];
  assert.match(z, /title="[^"]*打开工作区[^"]*手动新建[^"]*"/, 'Zcode title 应说明只打开工作区、需手动新建');
  assert.match(c, /title="[^"]*不会自动发送[^"]*"/, 'Codex title 应说明不自动发送提示词');
  assert.ok(!/自动新建/.test(z) && !/自动创建/.test(z + c), '不得宣称自动新建/创建会话');
  // 点击提示：只说已请求打开，不宣称创建成功（源码契约——只查字符串字面量，剔除注释；
  // REQ-20260911-008 起点击 toast 移至 copyPromptAndOpenSession，两处源码一并核对）
  const src = (fnSrc('bindBatchDrawer') + '\n' + fnSrc('copyPromptAndOpenSession'))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(src, /已请求打开/, '点击提示应含「已请求打开」');
  assert.doesNotMatch(src, /会话创建成功|已创建会话|已新建会话/, '不得宣称会话创建成功');
});

// ---------- H4 空态：未选择项目 ----------

t('H4 未选择项目：链接 aria-disabled 无 href，title 说明先选择项目；点击不导航、提示原因', async () => {
  const h = setupUI();
  h.state.project = null;
  h.state.workspaceApps = knownApps();
  const html = h.run('newSessionLinksHtml()');
  for (const agent of ['zcode', 'codex']) {
    const a = html.match(new RegExp(`<a[^>]*data-new-session="${agent}"[^>]*>[\\s\\S]*?</a>`))[0];
    assert.match(a, /aria-disabled="true"/, `${agent} 未选项目应禁用`);
    assert.ok(!a.includes('href='), `${agent} 禁用态不提供 href`);
    assert.match(a, /title="未选择项目[^"]*"/, `${agent} title 应说明未选项目`);
  }
  // 点击禁用链接：不触发深链，toast 说明先选择项目
  const { clicks } = bindHeader([{ agent: 'zcode' }], { project: null, apps: knownApps() });
  const r = await clicks.zcode();
  assert.equal(r.nav, '', '未选择项目点击不得导航');
  assert.match(r.toast, /未选择项目/, '应 toast 说明先选择项目');
});

// ---------- H5 空态：未检测到客户端 ----------

t('H5 未检测到：对应链接禁用 + 可见「（未检测到）」说明，另一端不受影响；title 写「未检测到」并留非默认路径余地，不写死未安装', async () => {
  const h = setupUI();
  h.state.workspaceApps = knownApps(true, false); // 仅 codex 缺位
  let html = h.run('newSessionLinksHtml()');
  const c = html.match(/<a[^>]*data-new-session="codex"[^>]*>[\s\S]*?<\/a>/)[0];
  const z = html.match(/<a[^>]*data-new-session="zcode"[^>]*>[\s\S]*?<\/a>/)[0];
  assert.match(c, /aria-disabled="true"/, 'codex 未检测到应禁用');
  assert.match(c, /（未检测到）/, '应有可见「未检测到」说明（不隐藏解释）');
  assert.match(c, /title="[^"]*未检测到 ChatGPT\.app[^"]*"/, 'title 应说明未检测到宿主 app');
  assert.match(c, /title="[^"]*非默认路径[^"]*"/, 'title 应留非默认路径余地');
  assert.ok(!c.includes('href='), '禁用态不提供 href');
  assert.ok(!z.includes('aria-disabled'), 'zcode 检测到不受影响');
  // 反向：仅 zcode 缺位
  h.state.workspaceApps = knownApps(false, true);
  html = h.run('newSessionLinksHtml()');
  const z2 = html.match(/<a[^>]*data-new-session="zcode"[^>]*>[\s\S]*?<\/a>/)[0];
  const c2 = html.match(/<a[^>]*data-new-session="codex"[^>]*>[\s\S]*?<\/a>/)[0];
  assert.match(z2, /aria-disabled="true"/);
  assert.match(z2, /title="[^"]*未检测到 ZCode\.app[^"]*"/);
  assert.ok(!c2.includes('aria-disabled'), 'codex 不受影响');
  // 点击禁用链接：不导航，toast 未检测到口径（含非默认路径余地，不作「一定未安装」的定论）
  const { clicks } = bindHeader([{ agent: 'codex' }], { project: '/p', apps: knownApps(true, false) });
  const r = await clicks.codex();
  assert.equal(r.nav, '', '未检测到点击不得导航');
  assert.match(r.toast, /未检测到 ChatGPT\.app/, '应 toast 未检测到宿主');
  assert.match(r.toast, /非默认路径/, '应留非默认路径余地（不把检测不到当定论）');
  assert.ok(!/一定未安装|确定未安装|尚未安装/.test(r.toast), 'toast 不得把检测不到写成一定未安装');
});

// ---------- H6 加载：探测中不把未知当未安装 ----------

t('H6 探测中与首帧未知：显示「正在检测」，不出现「未检测到」也不渲染可点链接', () => {
  const h = setupUI();
  h.state.workspaceApps = { zcode: undefined, codex: undefined, loaded: false, probing: true, failed: false };
  const probing = h.run('newSessionLinksHtml()');
  assert.match(probing, /正在检测/, '探测中应显示正在检测');
  assert.ok(!probing.includes('未检测到'), '不得把探测中当未检测到');
  assert.ok(!probing.includes('data-new-session'), '探测中不渲染会话链接');
  // 首帧（尚未开始探测、未失败）：同样显示正在检测，不闪「未检测到」
  h.state.workspaceApps = { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: false };
  const first = h.run('newSessionLinksHtml()');
  assert.match(first, /正在检测/, '首帧未知态按正在检测呈现');
  assert.ok(!first.includes('未检测到') && !first.includes('data-new-session'));
  // 探测不阻断页签与提示词复制：面板照常渲染（复制按钮仍在提示词分区）
  h.state.batchData = devRunData();
  h.state.workspaceApps = { zcode: undefined, codex: undefined, loaded: false, probing: true, failed: false };
  const panel = h.run('renderZcodeBatchPanel()');
  assert.ok(paneSlice(panel, 'prompt').includes('id="batchRecopy"'), '探测中提示词复制仍可用');
});

// ---------- H7 失败：说明 + 重新检测 + 手动指引，不算未安装 ----------

t('H7 探测失败：显示检测失败说明 + 「重新检测」链接 + 手动新建指引；不出现未检测到/未安装；失败后不自动重试，重试需 force', async () => {
  const h = setupUI();
  h.state.workspaceApps = { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: true };
  const html = h.run('newSessionLinksHtml()');
  assert.match(html, /检测失败/, '应显示检测失败说明');
  assert.match(html, /data-ws-retry/, '应提供重新检测入口');
  assert.match(html, /手动新建会话/, '应提供手动打开指引');
  assert.ok(!html.includes('未检测到') && !html.includes('未安装'), '失败不得写成未检测到/未安装');

  // 状态机：失败后再次绑定不自动重试；「重新检测」（force）重新探测并刷出链接
  const src = fnSrc('refreshWorkspaceApps');
  const mkSandbox = (apiImpl, renders) => {
    const state = { project: '/p', workspaceApps: { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: true } };
    const sandbox = { state, api: apiImpl, renderBatchDrawer: () => { renders.n++; } };
    vm.createContext(sandbox);
    return sandbox;
  };
  const call = (sandbox, force) => vm.runInContext(`(async () => { ${src}\n await refreshWorkspaceApps(${force ? 'true' : ''}); })();`, sandbox);
  let calls = 0;
  const renders = { n: 0 };
  const sb = mkSandbox(async () => { calls++; return { zcode: true, codex: false }; }, renders);
  await call(sb, false); // 非 force：failed 防重，不请求
  assert.equal(calls, 0, '失败后不得自动重试');
  await call(sb, true); // force：重新检测
  assert.equal(calls, 1, '重新检测应发起探测');
  assert.equal(sb.state.workspaceApps.failed, false, '重试成功后失败标记清除');
  assert.equal(sb.state.workspaceApps.loaded, true, '重试成功后置 loaded');
  // 绑定层：data-ws-retry 点击应走 force 重试
  const bind = fnSrc('bindBatchDrawer');
  assert.match(bind, /data-ws-retry/, '应绑定重新检测入口');
  assert.match(bind, /refreshWorkspaceApps\(true\)/, '重新检测应以 force 触发');
});

// ---------- H8 点击行为：单一深链路径，不携带 prompt ----------

t('H8 点击行为：zcode 走 workspace/open、codex 走 threads/new?path=（最新项目路径全量编码，无 prompt），并 toast「已请求打开」', async () => {
  const root = '/Users/x/我的 项目/agent-team-board';
  const { clicks } = bindHeader([{ agent: 'zcode' }, { agent: 'codex' }], { project: root, apps: knownApps() });
  const rz = await clicks.zcode({ preventDefault() {} });
  assert.equal(rz.nav, `zcode://workspace/open?path=${encodeURIComponent(root)}`, 'Zcode 深链零回归');
  assert.ok(!rz.nav.includes('prompt='), '不携带 prompt 参数');
  const rc = await clicks.codex({ preventDefault() {} });
  assert.equal(rc.nav, `codex://threads/new?path=${encodeURIComponent(root)}`, 'Codex 深链为 threads/new?path=');
  assert.ok(!rc.nav.includes('prompt='));
  assert.match(rz.toast, /已复制提示词并请求打开 Zcode/, 'REQ-20260911-008：应提示已复制提示词并请求打开 Zcode');
  assert.match(rc.toast, /已复制提示词并请求打开 Codex/, '应提示已复制提示词并请求打开 Codex');
  // preventDefault 被调用（统一走 location.href 单一路径，键盘 Enter 触发 click 同样生效）
  assert.equal(rz.prevented, true, '应阻止默认导航');
});

// ---------- H9 切换项目后使用最新目录 ----------

t('H9 切换项目：绑定一次后改 state.project 再点击，深链使用最新目录（不携带旧目录）', async () => {
  const { clicks, setProject } = bindHeader([{ agent: 'zcode' }, { agent: 'codex' }], { project: '/old/path', apps: knownApps() });
  setProject('/新 项目/x');
  assert.equal((await clicks.zcode()).nav, `zcode://workspace/open?path=${encodeURIComponent('/新 项目/x')}`, '点击时按最新项目构造深链');
  setProject('/Users/y/atb');
  assert.equal((await clicks.codex()).nav, `codex://threads/new?path=${encodeURIComponent('/Users/y/atb')}`, 'codex 同样使用最新项目');
});

// ---------- H10 不干扰页签/批次/队列 ----------

t('H10 互不干扰：链接点击不切换页签（不改 state.batch.mode）、不重渲染、不触发刷新；页签按钮绑定保留', async () => {
  const { clicks, spies } = bindHeader([{ agent: 'zcode' }], { project: '/p', apps: knownApps() });
  await clicks.zcode({ preventDefault() {} });
  assert.equal(spies.mode(), 'refine', '点击链接不得改变任务页签选中');
  assert.equal(spies.rendered, 0, '点击链接不得重渲染（不切页签不刷面板）');
  assert.equal(spies.refreshed, 0, '点击链接不得触发批次刷新');
  // 源码契约：链接处理器不含页签切换/批次操作
  const bind = fnSrc('bindBatchDrawer');
  const handler = bind.slice(bind.indexOf('[data-new-session]'), bind.indexOf('data-ws-retry'));
  assert.ok(handler, '应存在会话链接绑定');
  assert.doesNotMatch(handler, /state\.batch\.mode|data-bmode|refreshBatch\(|refreshRefine\(|renderBatchDrawer\(/, '点击处理器不得切换页签或触发刷新');
  // 页签按钮绑定仍保留（一级页签不受影响）
  assert.match(bind, /querySelectorAll\('\[data-bmode\]'\)/, '一级页签绑定保留');
});

// ---------- H11 旧入口清除：底部按钮不再出现 ----------

t('H11 旧底部入口清除：workspaceOpenRowHtml/data-open-ws/旧按钮 id 全部移除；提示词分区不再承载入口；复制按钮保留', () => {
  assert.ok(!js.includes('workspaceOpenRowHtml'), 'workspaceOpenRowHtml 应删除');
  assert.ok(!js.includes('data-open-ws'), '旧 data-open-ws 标记应清除');
  for (const id of ['batchOpenZcode', 'batchOpenCodex', 'refineOpenZcode', 'refineOpenCodex']) {
    assert.ok(!js.includes(id), `旧按钮 id ${id} 应清除`);
  }
  assert.ok(!js.includes('打开 Zcode 工作区</') && !js.includes('打开 Codex 工作区</'), '旧按钮文案应清除');
  const h = setupUI();
  h.state.workspaceApps = knownApps();
  h.state.batchData = devRunData();
  h.state.refine.data = refineRunData();
  const devPrompt = paneSlice(h.run('renderZcodeBatchPanel()'), 'prompt');
  const rfPrompt = paneSlice(h.run('renderRefinePanel()'), 'prompt');
  for (const p of [devPrompt, rfPrompt]) {
    assert.ok(!p.includes('data-new-session'), '提示词分区不得承载会话入口（避免重复）');
    assert.ok(!p.includes('dep-toolbar"><button'), '底部工具行按钮组应移除');
  }
  assert.ok(devPrompt.includes('id="batchPrompt"') && devPrompt.includes('id="batchRecopy"') && devPrompt.includes('id="batchResumeCopy"'), '开发提示词复制按钮保留');
  assert.ok(rfPrompt.includes('id="refinePrompt"') && rfPrompt.includes('id="refineRecopy"'), '完善提示词复制按钮保留');
});

// ---------- H12 探测状态机 refreshWorkspaceApps ----------

t('H12 refreshWorkspaceApps：探测中置 probing；成功置 loaded 并重渲染刷出链接；失败置 failed 不抛错不置 loaded；成功/失败均恰好重渲染一次', async () => {
  const src = fnSrc('refreshWorkspaceApps');
  const mkSandbox = (apiImpl) => {
    const renders = { n: 0 };
    const state = { project: '/p', workspaceApps: { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: false } };
    const sandbox = { state, api: apiImpl, renderBatchDrawer: () => { renders.n++; } };
    vm.createContext(sandbox);
    return { sandbox, renders, state };
  };
  // 成功：loaded + probing 复位 + 恰好一次重渲染（正在检测 → 链接）
  {
    const { sandbox, renders, state } = mkSandbox(async () => ({ zcode: true, codex: true }));
    let probingSeen = false;
    await vm.runInContext(`(async () => { ${src}
      const p = refreshWorkspaceApps();
      probingSeen = state.workspaceApps.probing;
      await p; })();`.replace('probingSeen =', 'globalThis.__seen ='), sandbox);
    assert.equal(state.workspaceApps.loaded, true, '成功置 loaded');
    assert.equal(state.workspaceApps.probing, false, '探测结束复位 probing');
    assert.equal(vm.runInContext('globalThis.__seen', sandbox), true, '探测期间应置 probing');
    assert.equal(renders.n, 1, '结束后重渲染一次刷出链接态');
  }
  // 失败：failed + 不置 loaded + 不抛错 + 重渲染一次
  {
    const { sandbox, renders, state } = mkSandbox(async () => { throw new Error('探测失败'); });
    await vm.runInContext(`(async () => { ${src}\n await refreshWorkspaceApps(); })();`, sandbox);
    assert.equal(state.workspaceApps.failed, true, '失败应置 failed');
    assert.equal(state.workspaceApps.loaded, false, '失败不置 loaded');
    assert.equal(state.workspaceApps.zcode, undefined, '保持未知，不当作未安装');
    assert.equal(renders.n, 1, '失败也重渲染一次刷出重试态');
  }
});

// ---------- H13 状态与绑定契约 ----------

t('H13 契约：state.workspaceApps 初始化含 probing/failed；绑定统一 data-new-session；绑定时触发一次探测；复制类绑定保留', () => {
  assert.match(js, /workspaceApps:\s*\{[^}]*zcode:\s*undefined,[^}]*codex:\s*undefined,[^}]*loaded:\s*false,[^}]*probing:\s*false,[^}]*failed:\s*false\s*\}/, '状态应初始化未知态（含 probing/failed）');
  const bind = fnSrc('bindBatchDrawer');
  assert.match(bind, /querySelectorAll\('\[data-new-session\]'\)/, '会话链接统一按 data-new-session 绑定');
  assert.match(bind, /refreshWorkspaceApps\(\);/, '绑定时应触发一次宿主探测');
  for (const id of ['batchRecopy', 'batchResumeCopy', 'refineRecopy']) {
    assert.ok(bind.includes(`'#${id}'`), `既有复制绑定 ${id} 保留`);
  }
});

/* ---------- 绑定沙箱：提取 bindBatchDrawer，模拟头部元素 ---------- */

function bindHeader(linkSpecs, { project, apps }) {
  // REQ-20260911-008：点击改为「先自动复制提示词再跳深链」，一并提取 copyPromptAndOpenSession
  // 真实源码（含 busy 防重复标记），桩掉 api / copyDispatchText / 渲染刷新。
  const src = fnSrc('bindBatchDrawer') + '\n' + fnSrc('copyPromptAndOpenSession');
  const drawer = {
    els: linkSpecs.map((s) => {
      const el = element();
      el.dataset.newSession = s.agent;
      return el;
    }),
    tabs: [],
    retry: null,
    querySelectorAll(sel) {
      if (sel === '[data-new-session]') return this.els;
      if (sel === '[data-bmode]') return this.tabs;
      return [];
    },
    querySelector(sel) {
      if (sel === '[data-ws-retry]') return this.retry;
      return null;
    },
  };
  const sandboxState = {
    project,
    workspaceApps: apps,
    batch: { mode: 'refine' },
    refine: { data: { batch: { prompt: '主调度提示词内容' } } },
    commit: { data: null },
  };
  const location = { href: '' };
  const spies = { rendered: 0, refreshed: 0, mode: () => sandboxState.batch.mode };
  const sandbox = {
    $: (s) => (s === '#batchDrawer' ? drawer : null),
    state: sandboxState,
    location,
    api: async () => ({ prompt: '主调度提示词内容' }), // develop 取材口径（不新建批次）
    copyDispatchText: async () => true,
    toast: (msg) => { sandbox.__toast = msg; },
    saveViewSnapshot: () => {}, activateTaskPane: () => {},
    renderBatchDrawer: () => { spies.rendered++; },
    refreshBatch: async () => { spies.refreshed++; },
    refreshWorkspaceApps: async () => {},
    createBatchAndCopy: async () => {}, copyBatchPrompt: async () => {}, toggleBatchPause: async () => {},
    deleteBatchById: async () => {}, retryRunFromRecord: async () => {}, createRefineBatchAndCopy: async () => {},
    toggleRefinePause: async () => {}, abortRefineTask: async () => {}, abortDevTask: async () => {},
    // BUG-20260910-014：bindBatchDrawer 直调的批量 Commit 面板共用绑定（沙箱无面板 DOM，桩掉）
    bindCommitWidgets: () => {},
    openDrawer: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`let sessionEntryBusy = false;\n${src}\nbindBatchDrawer();`, sandbox);
  const clicks = {};
  linkSpecs.forEach((s, i) => {
    clicks[s.agent] = async (ev) => {
      sandbox.__toast = '';
      sandbox.__prevented = false;
      if (ev && typeof ev.preventDefault === 'function') {
        const orig = ev.preventDefault.bind(ev);
        ev.preventDefault = () => { sandbox.__prevented = true; orig(); };
        drawer.els[i].listeners.click(ev);
      } else {
        drawer.els[i].listeners.click();
      }
      // 点击内含异步复制（REQ-20260911-008 先复制后跳转）：冲刷微任务后取最终导航与 toast
      for (let k = 0; k < 8; k++) await new Promise((r) => setTimeout(r, 0));
      return { nav: location.href, toast: sandbox.__toast || '', prevented: !!sandbox.__prevented };
    };
  });
  return {
    clicks,
    spies,
    setProject: (p) => { sandboxState.project = p; },
  };
}

// ---------- 运行器 ----------

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
