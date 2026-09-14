#!/usr/bin/env node
// REQ-20260910-002 任务模块会话/工作区入口 —— lib 纯函数 + 服务端 + vm 行为测试
// 覆盖 test-cases.md W1–W12（E1–E3 人工项见 test-report.md）
// BUG-20260910-005：入口自提示词分区底部迁至头部一级页签旁（「去新建 XX 会话」超链接），
// W4–W11 已按迁移后形态更新；深链构造 / 宿主探测 / 服务端端点（W1–W3）不变。
// 用法：node scripts/tests/workspace-entry-20260910-002.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as dispatch from '../lib/dispatch.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const serverPath = path.join(pluginRoot, 'scripts', 'server.mjs');
const serverSrc = fs.readFileSync(serverPath, 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fnSrc(name) {
  const m = js.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

// ---------- W1 lib 深链构造：编码与路径注入转义 ----------

t('W1 buildZcodeWorkspaceUrl / buildCodexWorkspaceUrl：前缀正确，中文/空格/保留字符全量 encodeURIComponent', () => {
  assert.equal(typeof dispatch.buildZcodeWorkspaceUrl, 'function', 'buildZcodeWorkspaceUrl 应保留');
  assert.equal(typeof dispatch.buildCodexWorkspaceUrl, 'function', 'buildCodexWorkspaceUrl 应存在');
  const root = '/Users/x/我的 项目/a&b?c#d%e\'f/g';
  const z = dispatch.buildZcodeWorkspaceUrl(root);
  const c = dispatch.buildCodexWorkspaceUrl(root);
  assert.equal(z, `zcode://workspace/open?path=${encodeURIComponent(root)}`, 'zcode 深链与官方 workspace/open 路由一致');
  assert.equal(c, `codex://threads/new?path=${encodeURIComponent(root)}`, 'codex 深链为 threads/new?path=（不传 prompt）');
  // 注入转义：结构性分隔符与空白不得裸出现在 query 中（' 为 encodeURIComponent 不编码的
  // 非保留字符，RFC 3986 sub-delims，不会破坏 URL 结构，放行）
  for (const url of [z, c]) {
    const q = url.split('?')[1];
    assert.ok(!/[&?#\s]/.test(q), `query 不得含未转义分隔符：${q}`);
    assert.ok(q.startsWith('path='), '唯一参数为 path');
  }
  assert.ok(!c.includes('prompt='), 'codex 深链不得携带 prompt 参数（不注入/不发送）');
});

// ---------- W2 lib 宿主探测 ----------

t('W2 detectWorkspaceApps：darwin 注入 exists 探测两宿主；非 darwin 一律 false；默认实现走真实 fs', () => {
  assert.equal(typeof dispatch.detectWorkspaceApps, 'function', 'detectWorkspaceApps 应存在');
  const darwin = dispatch.detectWorkspaceApps({ exists: (p) => p === '/Applications/ChatGPT.app', platform: 'darwin' });
  assert.deepEqual(darwin, { zcode: false, codex: true }, '按注入 exists 返回存在性');
  const both = dispatch.detectWorkspaceApps({ exists: () => true, platform: 'darwin' });
  assert.deepEqual(both, { zcode: true, codex: true });
  const none = dispatch.detectWorkspaceApps({ exists: () => false, platform: 'darwin' });
  assert.deepEqual(none, { zcode: false, codex: false });
  assert.deepEqual(dispatch.detectWorkspaceApps({ exists: () => true, platform: 'linux' }), { zcode: false, codex: false }, '非 darwin 一律 false（桌面 app 为 macOS 专属）');
  const real = dispatch.detectWorkspaceApps(); // 默认实现：真实 fs，不抛错即通过
  assert.equal(typeof real.zcode, 'boolean');
  assert.equal(typeof real.codex, 'boolean');
});

// ---------- W3 服务端端点 ----------

async function startServer() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-wsentry-')));
  core.initData(root);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const registry = path.join(os.tmpdir(), `atb-registry-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: registry },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const base = `http://127.0.0.1:${port}`;
  const get = (p) => new Promise((resolve, reject) => {
    const r = http.request(`${base}${p}`, { method: 'GET', timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
  for (let i = 0; i < 60; i++) {
    try { const h = await get('/api/health'); if (h.status === 200) break; } catch {}
    await sleep(150);
  }
  return { child, get, stop: () => child.kill('SIGTERM') };
}

t('W3 GET /api/workspace/apps：200 且 { zcode: boolean, codex: boolean }（只读探测，不断言本机具体值）', async () => {
  assert.match(serverSrc, /GET' && pathname === '\/api\/workspace\/apps'/, '服务端应有该路由');
  const s = await startServer();
  try {
    const r = await s.get('/api/workspace/apps');
    assert.equal(r.status, 200, `应 200（实际 ${r.status}）`);
    assert.equal(typeof r.json?.zcode, 'boolean', 'zcode 应为 boolean');
    assert.equal(typeof r.json?.codex, 'boolean', 'codex 应为 boolean');
    assert.deepEqual(Object.keys(r.json).sort(), ['codex', 'zcode'], '响应仅含两宿主字段');
  } finally { s.stop(); }
});

// ---------- vm 沙箱（全量加载渲染代码，复用 tasks-tabs 模式） ----------

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

// ---------- W4 批量开发渲染（BUG-20260910-005：入口迁至头部，提示词分区不再承载） ----------

t('W4 批量开发提示词分区：不含会话/工作区入口（已迁至一级页签旁），复制按钮与提示词全文保留', () => {
  const h = setupUI();
  h.state.batchData = devRunData();
  const html = h.run('renderZcodeBatchPanel()');
  const prompt = paneSlice(html, 'prompt');
  assert.ok(!prompt.includes('data-new-session'), '提示词分区不得渲染会话入口（BUG-20260910-005 迁至头部）');
  assert.ok(!prompt.includes('data-open-ws'), '旧工作区按钮标记不得残留');
  assert.ok(prompt.includes('id="batchRecopy"') && prompt.includes('id="batchResumeCopy"'), '重新复制 / 复制续接提示词保留');
  assert.ok(prompt.includes('id="batchPrompt"'), '提示词全文保留');
});

// ---------- W5 批量完善渲染 ----------

t('W5 批量完善提示词分区：同样不含会话入口；「重新复制」与提示词全文保留', () => {
  const h = setupUI();
  h.state.refine.data = refineRunData();
  const html = h.run('renderRefinePanel()');
  const prompt = paneSlice(html, 'prompt');
  for (const id of ['refineRecopy', 'refinePrompt']) {
    assert.ok(prompt.includes(`id="${id}"`), `提示词分区应含 ${id}`);
  }
  assert.ok(!prompt.includes('data-new-session'), '提示词分区不得渲染会话入口');
});

// ---------- W6 空态 ----------

t('W6 缺 prompt 空态保留空态说明；启动区不出现任何会话入口', () => {
  const h = setupUI();
  h.state.refine.data = refineRunData({ batch: { ...mkBatch(), batchId: 'RFB-20990910-009', prompt: '' } });
  const noPrompt = h.run('renderRefinePanel()');
  assert.match(paneSlice(noPrompt, 'prompt'), /暂无调度提示词/, '空态说明保留');
  assert.ok(!paneSlice(noPrompt, 'prompt').includes('data-new-session'), '空态不得渲染会话按钮');
  // 完善启动态
  h.state.refine.data = { batch: null, candidates: [{ id: 'REQ-20990910-003', type: 'requirement', title: 't', reasons: [] }] };
  const rfStart = h.run('renderRefinePanel()');
  assert.ok(!rfStart.includes('data-new-session'), '完善启动区不加会话入口');
  // 开发启动态
  h.state.batchData = { batch: null, stats: { candidates: 2, blocked: 0 }, pending: [] };
  const devStart = h.run('renderZcodeBatchPanel()');
  assert.ok(!devStart.includes('data-new-session'), '开发启动区不加会话入口');
});

// ---------- W7 未选项目（BUG-20260910-005：入口为头部 newSessionLinksHtml 渲染） ----------

t('W7 未选项目：头部两个会话链接均禁用（aria-disabled）且 title 含「未选择项目」；有项目时为可点链接且 title 含项目路径', () => {
  const h = setupUI();
  h.state.workspaceApps = { zcode: true, codex: true, loaded: true, probing: false, failed: false };
  h.state.project = null;
  const noProj = h.run('newSessionLinksHtml()');
  for (const agent of ['zcode', 'codex']) {
    const a = noProj.match(new RegExp(`<a[^>]*data-new-session="${agent}"[^>]*>`))[0];
    assert.match(a, /aria-disabled="true"/, `${agent} 应禁用`);
    assert.match(a, /title="未选择项目[^"]*"/, `${agent} title 应说明未选项目`);
  }
  h.state.project = '/project/p';
  const ok = h.run('newSessionLinksHtml()');
  for (const agent of ['zcode', 'codex']) {
    const a = ok.match(new RegExp(`<a[^>]*data-new-session="${agent}"[^>]*>`))[0];
    assert.ok(!a.includes('aria-disabled'), `有项目时 ${agent} 不禁用`);
    assert.ok(!/未选择项目/.test(a), `有项目时 ${agent} title 不含未选项目说明`);
    assert.match(a, /href="(zcode|codex):\/\//, `${agent} 提供深链 href`);
  }
  assert.match(ok.match(/<a[^>]*data-new-session="zcode"[^>]*>/)[0], /title="[^"]*\/project\/p[^"]*"/, '正常 title 含当前项目');
});

// ---------- W8 通道不可用（明确 false 才禁用，仅影响对应链接） ----------

t('W8 探测明确 false 才禁用：codex=false 仅禁 Codex 链接，zcode=false 仅禁 Zcode 链接；未检测到有可见说明', () => {
  const h = setupUI();
  h.state.workspaceApps = { zcode: true, codex: false, loaded: true, probing: false, failed: false };
  let html = h.run('newSessionLinksHtml()');
  const c = html.match(/<a[^>]*data-new-session="codex"[^>]*>[\s\S]*?<\/a>/)[0];
  const z = html.match(/<a[^>]*data-new-session="zcode"[^>]*>[\s\S]*?<\/a>/)[0];
  assert.match(c, /aria-disabled="true"/, 'Codex 链接应禁用');
  assert.match(c, /title="[^"]*ChatGPT\.app[^"]*"/, '禁用 title 应说明 ChatGPT.app 缺位');
  assert.match(c, /（未检测到）/, '未检测到应有可见说明');
  assert.ok(!z.includes('aria-disabled'), 'Zcode 链接不受影响');
  h.state.workspaceApps = { zcode: false, codex: true, loaded: true, probing: false, failed: false };
  html = h.run('newSessionLinksHtml()');
  const z2 = html.match(/<a[^>]*data-new-session="zcode"[^>]*>[\s\S]*?<\/a>/)[0];
  const c2 = html.match(/<a[^>]*data-new-session="codex"[^>]*>[\s\S]*?<\/a>/)[0];
  assert.match(z2, /aria-disabled="true"/, 'Zcode 链接应禁用');
  assert.match(z2, /title="[^"]*ZCode\.app[^"]*"/, '禁用 title 应说明 ZCode.app 缺位');
  assert.ok(!c2.includes('aria-disabled'), 'Codex 链接不受影响');
});

// ---------- W9 点击行为（提取 bindBatchDrawer；BUG-20260910-005 起为头部 data-new-session 链接） ----------

function bindClicks(entries, projectPath) {
  // REQ-20260911-008：点击改为「先自动复制提示词再跳深链」，一并提取 copyPromptAndOpenSession
  // 真实源码（含 busy 防重复标记），桩掉 api / copyDispatchText。
  const src = fnSrc('bindBatchDrawer') + '\n' + fnSrc('copyPromptAndOpenSession');
  const drawer = {
    querySelectorAll: (sel) => (sel === '[data-new-session]' ? entries.map((e) => e.el) : []),
    querySelector: () => null,
  };
  const location = {};
  const sandbox = {
    $: (s) => (s === '#batchDrawer' ? drawer : null),
    state: { project: projectPath, workspaceApps: { zcode: undefined, codex: undefined, loaded: true, probing: false, failed: false }, batch: { mode: 'refine' }, refine: { data: { batch: { prompt: '主调度提示词' } } }, commit: { data: null } },
    location,
    api: async () => ({ prompt: '主调度提示词' }),
    copyDispatchText: async () => true,
    toast: () => {}, saveViewSnapshot: () => {}, activateTaskPane: () => {},
    createBatchAndCopy: async () => {}, copyBatchPrompt: async () => {}, toggleBatchPause: async () => {},
    deleteBatchById: async () => {}, retryRunFromRecord: async () => {}, createRefineBatchAndCopy: async () => {},
    toggleRefinePause: async () => {}, abortRefineTask: async () => {}, abortDevTask: async () => {},
    // BUG-20260910-014：bindBatchDrawer 直调的批量 Commit 面板共用绑定（沙箱无面板 DOM，桩掉）
    bindCommitWidgets: () => {},
    openDrawer: () => {}, renderBatchDrawer: () => {}, refreshBatch: async () => {}, refreshWorkspaceApps: async () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`let sessionEntryBusy = false;\n${src}\nbindBatchDrawer();`, sandbox);
  return { location };
}

const mkWsBtn = (agent, disabled = false) => {
  const el = element();
  el.dataset.newSession = agent;
  el.disabled = disabled;
  return { el, agent, disabled };
};

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

t('W9 点击行为：zcode 走 workspace/open（既有零回归）、codex 走 threads/new?path=（无 prompt）；未选项目不触发深链', async () => {
  const root = '/Users/x/我的 项目/agent-team-board';
  const buttons = [mkWsBtn('zcode'), mkWsBtn('codex')];
  const { location } = bindClicks(buttons, root);
  buttons[0].el.listeners.click();
  await settle(); // REQ-20260911-008：先复制提示词，微任务冲刷后深链生效
  assert.equal(location.href, `zcode://workspace/open?path=${encodeURIComponent(root)}`, 'Zcode 深链构造零回归');
  buttons[1].el.listeners.click();
  await settle();
  assert.equal(location.href, `codex://threads/new?path=${encodeURIComponent(root)}`, 'Codex 深链为 threads/new?path=');
  assert.ok(!location.href.includes('prompt='), '不携带 prompt 参数');
  // 未选项目防御：state.project 为空时点击不得触发深链
  const b2 = mkWsBtn('zcode');
  const { location: loc2 } = bindClicks([b2], null);
  b2.el.listeners.click();
  await settle();
  assert.equal(loc2.href ?? '', '', 'state.project 为空时点击不得触发深链');
});

// ---------- W10 refreshWorkspaceApps 行为（BUG-20260910-005：结束后总是重渲染刷出链接态） ----------

t('W10 refreshWorkspaceApps：loaded 防重只请求一次；成功/失败均重渲染一次；api 失败置 failed 且不抛错', async () => {
  const src = fnSrc('refreshWorkspaceApps');
  // 用例 1：两宿主均存在 → 只请求一次、重渲染一次（正在检测 → 链接）
  {
    let calls = 0; let rendered = 0;
    const state = { workspaceApps: { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: false }, project: '/p' };
    const sandbox = { state, api: async () => { calls++; return { zcode: true, codex: true }; }, renderBatchDrawer: () => { rendered++; } };
    vm.createContext(sandbox);
    await vm.runInContext(`(async () => { ${src}\n await refreshWorkspaceApps(); await refreshWorkspaceApps(); })();`, sandbox);
    assert.equal(calls, 1, 'loaded 防重：只请求一次');
    assert.equal(rendered, 1, '探测结束重渲染一次（刷出链接态）');
    assert.equal(state.workspaceApps.zcode, true);
    assert.equal(state.workspaceApps.codex, true);
    assert.equal(state.workspaceApps.loaded, true);
  }
  // 用例 2：codex 缺位 → 重渲染刷出禁用态
  {
    let rendered = 0;
    const state = { workspaceApps: { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: false }, project: '/p' };
    const sandbox = { state, api: async () => ({ zcode: true, codex: false }), renderBatchDrawer: () => { rendered++; } };
    vm.createContext(sandbox);
    await vm.runInContext(`(async () => { ${src}\n await refreshWorkspaceApps(); })();`, sandbox);
    assert.equal(rendered, 1, '探测结束应重渲染刷出禁用态');
    assert.equal(state.workspaceApps.codex, false);
  }
  // 用例 3：端点失败 → 置 failed、保持未知、不抛错、loaded 不置位
  {
    const state = { workspaceApps: { zcode: undefined, codex: undefined, loaded: false, probing: false, failed: false }, project: '/p' };
    const sandbox = { state, api: async () => { throw new Error('探测失败'); }, renderBatchDrawer: () => {} };
    vm.createContext(sandbox);
    await vm.runInContext(`(async () => { ${src}\n await refreshWorkspaceApps(); })();`, sandbox);
    assert.equal(state.workspaceApps.loaded, false, '失败不置 loaded');
    assert.equal(state.workspaceApps.failed, true, '失败应置 failed（供重试态渲染）');
    assert.equal(state.workspaceApps.zcode, undefined, '保持未知，不当作未安装');
  }
});

// ---------- W11 零回归源码契约 ----------

t('W11 零回归：复制类绑定保留；提示词生成函数不动；深链与既有行内构造一致；绑定统一走 data-new-session', () => {
  const bind = fnSrc('bindBatchDrawer');
  assert.match(bind, /querySelectorAll\('\[data-new-session\]'\)/, '会话链接统一按 data-new-session 绑定');
  for (const id of ['batchRecopy', 'batchResumeCopy', 'refineRecopy']) {
    assert.ok(bind.includes(`'#${id}'`), `既有复制绑定 ${id} 保留`);
  }
  assert.match(bind, /zcode:\/\/workspace\/open\?path=\$\{encodeURIComponent\(state\.project\)\}/, 'zcode 深链构造与现状一致');
  assert.match(bind, /codex:\/\/threads\/new\?path=\$\{encodeURIComponent\(state\.project\)\}/, 'codex 深链构造');
  // 提示词文本生成函数不被本条改动（仍由 lib 批次模块产出）
  assert.equal(typeof batch.generatePrompt, 'function', 'batch.generatePrompt 保留');
  assert.equal(typeof refine.buildRefinePrompt, 'function', 'refine.buildRefinePrompt 保留');
  // bindBatchDrawer 触发一次探测（fire-and-forget）
  assert.match(bind, /refreshWorkspaceApps\(\);/, '绑定时应触发一次宿主探测');
  // 状态记忆：state.workspaceApps 初始化存在（含 probing/failed 状态机字段）
  assert.match(js, /workspaceApps:\s*\{[^}]*loaded:\s*false,[^}]*probing:\s*false,[^}]*failed:\s*false\s*\}/, 'state.workspaceApps 应初始化为未知态');
});

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
