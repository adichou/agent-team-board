#!/usr/bin/env node
// REQ-20260914-005 回退 BUG-20260914-015 + 快捷入口按钮去「开始」 —— 回退契约与新文案测试
// 覆盖 test-cases.md 用例 R1-R5（R6 由同步改词后的存量测试与全量套件守）：
//   R1 服务端 /api/tasks/state 移除（404）
//   R2 app.js 回退符号零残留 + quick.disabled = false 恢复
//   R3 前端新文案恒可点（vm 模拟 DOM，沿用 lane-quick-entry-20260909-007 模式）
//   R4 i18n 4 条执行中词条移除 + 3 个键改新词
//   R5 index.html 静态节点 aria-label / 可见文案新词
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runAtb = (args, cwd) => new Promise((resolve) => {
  const p = spawn(process.execPath, [atb, ...args], { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
  p.on('close', (code) => resolve(code));
});

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 4000,
    }, (rs) => {
      let data = '';
      rs.on('data', (c) => { data += c; });
      rs.on('end', () => {
        try { resolve({ status: rs.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: rs.statusCode, json: null, raw: data }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

// ---------- R1 服务端：/api/tasks/state 移除（真 server + atb CLI fixture） ----------

t('R1 服务端回退：GET /api/tasks/state 返回 404（已初始化与未初始化项目均如此），其余接口行为不变', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-qrv-a-')));
  await runAtb(['init'], root);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-qrv-reg-'));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');
    // 已初始化项目：路由移除 → 404
    let r = await req(port, 'GET', `/api/tasks/state?project=${encodeURIComponent(root)}`);
    assert.equal(r.status, 404, '已初始化项目请求 /api/tasks/state 应 404');
    // 未初始化裸目录：同样 404
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-qrv-bare-'));
    r = await req(port, 'GET', `/api/tasks/state?project=${encodeURIComponent(bare)}`);
    assert.equal(r.status, 404, '未初始化项目请求 /api/tasks/state 应 404');
    // 相邻接口不回归：/api/tasks/settings 仍可用
    r = await req(port, 'GET', `/api/tasks/settings?project=${encodeURIComponent(root)}`);
    assert.equal(r.status, 200, '/api/tasks/settings 相邻接口行为不变');
  } finally {
    server.kill('SIGKILL');
  }
});

// ---------- R2 app.js 源码契约：回退符号零残留 + 恒不禁用恢复 ----------

t('R2 app.js 回退契约：taskRun / refreshTaskRunState / /api/tasks/state / 执行中文案零残留；quick.disabled = false 与「仅导航」注释恢复；poll() 不再调用运行态刷新', () => {
  for (const gone of ['state.taskRun', 'taskRun:', 'refreshTaskRunState', '/api/tasks/state', 'AI 分析中', 'AI 开发中']) {
    assert.ok(!source.includes(gone), `BUG-20260914-015 符号不得残留：${gone}`);
  }
  const syncFn = source.slice(source.indexOf('function syncAcceptance()'), source.indexOf('function syncAcceptance()') + 5000);
  assert.match(syncFn, /quick\.disabled = false;\s*\/\/ 仅导航：批量操作进行中也不禁用，任务创建由面板内「启动」承接/, '应恢复恒不禁用与「仅导航」注释');
  const pollFn = source.slice(source.indexOf('async function poll()'), source.indexOf('async function poll()') + 4000);
  assert.ok(!pollFn.includes('refreshTaskRunState'), 'poll() 不得再调用 refreshTaskRunState');
  const swFn = source.slice(source.indexOf('async function switchProject('), source.indexOf('async function switchProject(') + 3000);
  assert.ok(!swFn.includes('taskRun'), 'switchProject() 不得残留 taskRun 重置');
  // 新文案落入快捷入口配置（两条导航 title 沿用不变）
  assert.ok(source.includes("{ label: '▶ AI 分析', title: '进入任务模块 AI 分析面板：对已接受未完善条目批量补全文档（与勾选无关）' }"), '已接受档文案应为「▶ AI 分析」');
  assert.ok(source.includes("{ label: '▶ AI 开发', title: '进入任务模块 AI 开发面板：以已计划队列（最旧优先）为范围，由面板内「启动」创建任务' }"), '已计划档文案应为「▶ AI 开发」');
  assert.ok(!source.includes('▶ 开始 AI 分析') && !source.includes('▶ 开始 AI 开发'), '旧文案不得残留');
});

// ---------- R3 前端行为（vm 模拟 DOM）：新文案、恒可点 ----------

const item = (id, status = 'accepted', extra = {}) => ({
  id, type: 'requirement', status, owner: null, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const sample = () => [
  item('REQ-20990101-001'),
  item('REQ-20990101-005', 'planned'),
];

function element() {
  const nodes = new Map();
  const classes = new Set();
  const el = {
    dataset: {}, innerHTML: '', textContent: '', disabled: false, checked: false, indeterminate: false,
    title: '', value: '', children: [], listeners: {}, attrs: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
  return el;
}

function setup() {
  const document = element();
  document.createElement = element;
  const requests = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }), confirm: () => true },
    fetch: async (url) => {
      requests.push(String(url));
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: sample() };
  run('poll = async () => {}; refreshDrawer = async () => {}; refreshHealth = async () => {}; updateBoardTabs = () => {}; markActiveTab = () => {};');
  return { sandbox, document, state, run, requests };
}

const hidden = (h, sel) => h.document.querySelector(sel).classList.contains('hidden');

t('R3 前端新文案恒可点：已接受档「▶ AI 分析」、已计划档「▶ AI 开发」，四路批量 pending 均不禁用，title 为导航说明', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已接受档显示');
  assert.equal(btn.textContent, '▶ AI 分析', '已接受档新文案');
  assert.equal(btn.disabled, false, '已接受档恒可点');
  assert.match(btn.title, /进入任务模块 AI 分析面板/, 'title 保持导航说明');
  for (const mod of ['acceptance', 'plan', 'impl', 'reject']) {
    h.state[mod].pending = true;
    h.run('syncAcceptance()');
    assert.equal(btn.disabled, false, `${mod} 批量进行中不禁用`);
    h.state[mod].pending = false;
  }
  h.run("state.reqFilter = 'planned'");
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '已计划档显示');
  assert.equal(btn.textContent, '▶ AI 开发', '已计划档新文案');
  assert.equal(btn.disabled, false, '已计划档恒可点');
  assert.match(btn.title, /进入任务模块 AI 开发面板/, 'title 保持导航说明');
});

// ---------- R4 i18n：4 条执行中词条移除 + 3 个键改新词 ----------

t('R4 i18n 回退与改词：「AI 分析中 / AI 开发中」及两条执行中 title 词条移除；「▶ 开始 AI 分析 / ▶ 开始 AI 开发 / 开始 AI 分析」键改「▶ AI 分析 / ▶ AI 开发 / AI 分析」', () => {
  // BUG-20260914-015 的 4 条词条（中英两侧均不得残留）
  for (const gone of [
    "'AI 分析中'", "'AI 开发中'", 'AI analysis in progress', 'AI development in progress',
    '子代理正在批量补全文档，收尾后自动恢复入口', '子代理正在按已计划队列实施，收尾后自动恢复入口',
  ]) {
    assert.ok(!i18nSrc.includes(gone), `BUG-20260914-015 词条不得残留：${gone}`);
  }
  // 新键（含英文）
  for (const p of [
    "'▶ AI 分析': '▶ AI analysis'",
    "'▶ AI 开发': '▶ AI development'",
    "'AI 分析': 'AI analysis'",
  ]) {
    assert.ok(i18nSrc.includes(p), `i18n.js 应含新键：${p}`);
  }
  // 旧键不得残留（含 aria-label 对应键）
  for (const gone of ["'▶ 开始 AI 分析'", "'▶ 开始 AI 开发'", "'开始 AI 分析'", 'Start AI analysis', 'Start AI development']) {
    assert.ok(!i18nSrc.includes(gone), `旧键不得残留：${gone}`);
  }
});

// ---------- R5 index.html 静态节点 ----------

t('R5 index.html 静态节点：可见文案「▶ AI 分析」、aria-label="AI 分析"、title 不变；旧文案不残留', () => {
  const btn = htmlSrc.match(/<button[^>]*id="laneQuickEntry"[^>]*>/);
  assert.ok(btn, '应存在 #laneQuickEntry 按钮');
  assert.match(btn[0], /aria-label="AI 分析"/, 'aria-label 应为新词');
  assert.match(btn[0], /title="进入任务模块 AI 分析面板：对已接受未完善条目批量补全文档（与勾选无关）"/, 'title 沿用不变');
  assert.ok(htmlSrc.includes('▶ AI 分析</button>'), '可见文案应为「▶ AI 分析」');
  assert.ok(!htmlSrc.includes('▶ 开始 AI 分析') && !htmlSrc.includes('aria-label="开始 AI 分析"'), '旧静态文案不得残留');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
