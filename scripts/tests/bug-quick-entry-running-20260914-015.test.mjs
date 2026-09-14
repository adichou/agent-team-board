#!/usr/bin/env node
// BUG-20260914-015 看板快捷入口按钮执行中态 —— 服务端 /api/tasks/state + 前端行为 + 接线契约测试
// 覆盖 test-cases.md 用例 S1-S5 / F1-F7 / C1：
//   服务端：无任务 null、执行中透传、终态排除、非执行态透传、未初始化项目两 null
//   前端（vm 模拟 DOM，沿用 lane-quick-entry-20260909-007 模式）：
//     AI 分析/开发执行中禁用改文案、非执行态可点、跨任务不联动、收尾恢复、数据链路、批量 pending 解耦
//   契约：poll 接线、switchProject 重置、syncAcceptance 消费
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

// ---------- 前端 vm 桩（lane-quick-entry-20260909-007 模式，setAttribute 记录以断言 aria-label） ----------

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
  const tasksState = { value: { ok: true, refine: null, develop: null }, fail: false };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }), confirm: () => true },
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).includes('/api/tasks/state')) {
        if (tasksState.fail) throw new Error('network down');
        return { ok: true, status: 200, statusText: 'OK', json: async () => tasksState.value };
      }
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
    },
    __tasksState: tasksState,
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

// ---------- 前端用例 ----------

// F1 AI 分析执行中：已接受档按钮禁用、文案「AI 分析中」、title 说明执行中、aria-label 同步
t('F1 AI 分析执行中：已接受档按钮 disabled、文案「AI 分析中」、title/aria-label 同步说明', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  h.run("state.reqFilter = 'accepted'");
  h.state.taskRun.refine = 'running';
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false, '执行中仍显示按钮（禁用而非隐藏）');
  assert.equal(btn.disabled, true, 'AI 分析执行中应禁用');
  assert.equal(btn.textContent, 'AI 分析中', '文案应为「AI 分析中」');
  assert.match(btn.title, /执行中/, 'title 应说明执行中');
  assert.ok(btn.title.includes('AI 分析'), 'title 应说明是 AI 分析任务');
  assert.equal(btn.attrs['aria-label'], 'AI 分析中', 'aria-label 随文案同步');
});

// F2 AI 开发执行中：已计划档按钮禁用、文案「AI 开发中」
t('F2 AI 开发执行中：已计划档按钮 disabled、文案「AI 开发中」、title/aria-label 同步', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  h.run("state.reqFilter = 'planned'");
  h.state.taskRun.develop = 'running';
  h.run('syncAcceptance()');
  assert.equal(hidden(h, '#laneQuickEntry'), false);
  assert.equal(btn.disabled, true, 'AI 开发执行中应禁用');
  assert.equal(btn.textContent, 'AI 开发中', '文案应为「AI 开发中」');
  assert.match(btn.title, /执行中/, 'title 应说明执行中');
  assert.ok(btn.title.includes('AI 开发'), 'title 应说明是 AI 开发任务');
  assert.equal(btn.attrs['aria-label'], 'AI 开发中', 'aria-label 随文案同步');
});

// F3 非执行态可点：prepared/paused/needs_attention/null 均保持原文案（与面板徽章口径一致不矛盾）
t('F3 非执行态（prepared/paused/needs_attention/null）保持原文案可点；develop 侧同理', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  h.run("state.reqFilter = 'accepted'");
  for (const st of [null, 'prepared', 'paused', 'needs_attention', 'finished']) {
    h.state.taskRun.refine = st;
    h.run('syncAcceptance()');
    assert.equal(btn.disabled, false, `refine=${st} 不禁用`);
    assert.equal(btn.textContent, '▶ 开始 AI 分析', `refine=${st} 文案不变`);
  }
  h.run("state.reqFilter = 'planned'");
  for (const st of [null, 'prepared', 'paused', 'needs_attention']) {
    h.state.taskRun.develop = st;
    h.run('syncAcceptance()');
    assert.equal(btn.disabled, false, `develop=${st} 不禁用`);
    assert.equal(btn.textContent, '▶ 开始 AI 开发', `develop=${st} 文案不变`);
  }
});

// F4 跨任务不联动：refine 执行中不影响已计划档按钮（develop 空闲）
t('F4 跨任务不联动：refine running 时已计划档按钮（develop 空闲）照常可点原文案；反向同理', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  h.state.taskRun.refine = 'running';
  h.run("state.reqFilter = 'planned'");
  h.run('syncAcceptance()');
  assert.equal(btn.disabled, false, 'develop 空闲时已计划档不受 refine 执行影响');
  assert.equal(btn.textContent, '▶ 开始 AI 开发');
  // 反向：develop running 时已接受档按钮（refine 空闲）照常
  h.state.taskRun.refine = null;
  h.state.taskRun.develop = 'running';
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  assert.equal(btn.disabled, false, 'refine 空闲时已接受档不受 develop 执行影响');
  assert.equal(btn.textContent, '▶ 开始 AI 分析');
});

// F5 收尾自动恢复：running → null 后 syncAcceptance 恢复原文案可点
t('F5 收尾恢复：refine running → null 后按钮恢复「▶ 开始 AI 分析」可点（≤1 轮轮询由 F6 链路承接）', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  h.run("state.reqFilter = 'accepted'");
  h.state.taskRun.refine = 'running';
  h.run('syncAcceptance()');
  assert.equal(btn.disabled, true);
  h.state.taskRun.refine = null;
  h.run('syncAcceptance()');
  assert.equal(btn.disabled, false, '收尾后恢复可点');
  assert.equal(btn.textContent, '▶ 开始 AI 分析', '收尾后恢复原文案');
  assert.ok(btn.title.includes('AI 分析') && !btn.title.includes('执行中'), 'title 恢复原文案说明');
});

// F6 数据链路：refreshTaskRunState 拉 /api/tasks/state 写 state.taskRun；签名无变化不重触发；失败保留旧值
t('F6 数据链路：拉取 /api/tasks/state 写入 state.taskRun 并同步按钮；同响应签名剪枝；失败静默保留旧值', async () => {
  const h = setup();
  h.sandbox.__tasksState.value = { ok: true, refine: 'running', develop: null };
  h.run("state.reqFilter = 'accepted'");
  h.run('syncAcceptance()');
  const btn = h.document.querySelector('#laneQuickEntry');
  assert.equal(btn.textContent, '▶ 开始 AI 分析', '拉取前按钮为原文案');
  await h.run('refreshTaskRunState()');
  assert.ok(h.requests.some((u) => u.includes('/api/tasks/state')), '应请求 /api/tasks/state');
  assert.equal(h.state.taskRun.refine, 'running', 'state.taskRun.refine 已写入');
  assert.equal(btn.disabled, true, '拉取后按钮禁用');
  assert.equal(btn.textContent, 'AI 分析中', '拉取后文案切换');
  // 签名剪枝：同响应不重复调 syncAcceptance（覆盖计数验证）
  h.run('let __syncCalls = 0; const __orig = syncAcceptance; syncAcceptance = () => { __syncCalls++; };');
  await h.run('refreshTaskRunState()');
  assert.equal(h.run('__syncCalls'), 0, '响应无变化不得重复同步');
  h.sandbox.__tasksState.value = { ok: true, refine: null, develop: 'running' };
  await h.run('refreshTaskRunState()');
  assert.equal(h.run('__syncCalls'), 1, '响应变化应同步一次');
  assert.equal(h.state.taskRun.develop, 'running');
  h.run('syncAcceptance = __orig;');
  // 失败保留旧值：fetch 抛错不抛出、state 不回退
  h.sandbox.__tasksState.fail = true;
  await h.run('refreshTaskRunState()');
  assert.equal(h.state.taskRun.refine, null, '失败保留最近一次成功值（refine）');
  assert.equal(h.state.taskRun.develop, 'running', '失败保留最近一次成功值（develop）');
});

// F7 不回归：无任务态时批量操作进行中不禁用（REQ-20260909-007 Q5 口径保留）
t('F7 不回归：无任务执行时四路批量 pending 均不禁用快捷按钮', () => {
  const h = setup();
  const btn = h.document.querySelector('#laneQuickEntry');
  h.run("state.reqFilter = 'accepted'");
  for (const mod of ['acceptance', 'plan', 'impl', 'reject']) {
    h.state[mod].pending = true;
    h.run('syncAcceptance()');
    assert.equal(btn.disabled, false, `${mod} 批量进行中不禁用（仅任务执行中禁用）`);
    h.state[mod].pending = false;
  }
});

// C1 接线契约：poll 内调用、switchProject 重置、syncAcceptance 消费 state.taskRun
t('C1 接线契约：poll() 随主轮询调用 refreshTaskRunState()；switchProject() 重置 state.taskRun；syncAcceptance() 消费 state.taskRun', () => {
  const pollFn = source.slice(source.indexOf('async function poll()'), source.indexOf('async function poll()') + 2500);
  assert.ok(/await refreshTaskRunState\(\)/.test(pollFn), 'poll() 应调用 refreshTaskRunState()（不依赖任务面板打开）');
  assert.match(source, /async function refreshTaskRunState\(\)/, '应定义 refreshTaskRunState()');
  assert.match(source, /api\('\/api\/tasks\/state'\)/, 'refreshTaskRunState 应拉取 /api/tasks/state');
  const swFn = source.slice(source.indexOf('async function switchProject('), source.indexOf('async function switchProject(') + 3000);
  assert.ok(/state\.taskRun = \{ refine: null, develop: null, sig: '' \}/.test(swFn), 'switchProject() 应按项目隔离重置 state.taskRun');
  const syncFn = source.slice(source.indexOf('function syncAcceptance()'), source.indexOf('function syncAcceptance()') + 5000);
  assert.ok(syncFn.includes('state.taskRun'), 'syncAcceptance() 应消费 state.taskRun');
});

// ---------- 服务端用例（真 server + atb CLI fixture） ----------

async function mkProject(name, { n = 0, plan = 0 } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-qer-${name}-`)));
  await runAtb(['init'], root);
  const ids = [];
  for (let i = 1; i <= n; i++) {
    await runAtb(['new', 'req', `${name}-条目-${i}`], root);
    const dir = path.join(root, 'docs', 'agent-team-board', 'requirements');
    const found = fs.readdirSync(dir).filter((d) => d.startsWith('REQ-'));
    ids.push(found[found.length - 1]);
  }
  for (const id of ids) {
    await runAtb(['status', id, 'accepted'], root);
    if (plan) await runAtb(['status', id, 'planned'], root);
  }
  return { root, ids };
}

t('S1-S5 服务端 /api/tasks/state：无任务 null、执行中透传、终态排除、非执行态透传、未初始化两 null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-qer-reg-'));
  const A = await mkProject('a', { n: 2, plan: 1 }); // 2 个已计划条目（develop 候选）
  const B = await mkProject('b', { n: 1 });          // 1 个已接受条目（refine 候选）
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: A.root,
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
    const state = (root) => req(port, 'GET', `/api/tasks/state?project=${encodeURIComponent(root)}`);

    // S1 无任务：两个 null
    let r = await state(A.root);
    assert.equal(r.status, 200);
    assert.deepEqual({ refine: r.json.refine, develop: r.json.develop }, { refine: null, develop: null }, 'S1 无任务应两 null');

    // S4 非执行态透传：创建 develop 批次未预留 → prepared
    r = await req(port, 'POST', `/api/batch/create?project=${encodeURIComponent(A.root)}`, {});
    assert.equal(r.status, 200, '创建 develop 批次');
    r = await state(A.root);
    assert.equal(r.json.develop, 'prepared', 'S4 创建未预留应透传 prepared');
    assert.equal(r.json.refine, null, 'refine 仍无任务');

    // S2 执行中透传：atb batch next 预留 → running
    assert.equal(await runAtb(['batch', 'next', '--by', 't-qer-dev', '--dir', A.root]), 0, '预留一项（批次转 running）');
    r = await state(A.root);
    assert.equal(r.json.develop, 'running', 'S2 已登记运行应透传 running');

    // S3 终态排除：人工终止 → 不再出现（按钮恢复）
    r = await req(port, 'POST', `/api/batch/abort?project=${encodeURIComponent(A.root)}`, {});
    assert.equal(r.status, 200, '终止批次');
    r = await state(A.root);
    assert.equal(r.json.develop, null, 'S3 终止批次不得进入响应');

    // S2 refine 侧：创建完善任务（prepared）→ refine next 预留 → running
    r = await req(port, 'POST', `/api/refine/create?project=${encodeURIComponent(B.root)}`, {});
    assert.equal(r.status, 200, '创建 refine 任务');
    r = await state(B.root);
    assert.equal(r.json.refine, 'prepared', 'refine 创建未领取应透传 prepared');
    assert.equal(await runAtb(['refine', 'next', '--by', 't-qer-rf', '--dir', B.root]), 0, '领取一项（任务转 running）');
    r = await state(B.root);
    assert.equal(r.json.refine, 'running', 'S2 refine 已登记运行应透传 running');
    assert.equal(r.json.develop, null, 'B 项目 develop 无任务');

    // S5 未初始化项目：不抛错，按无任务处理
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-qer-bare-'));
    r = await state(raw);
    assert.equal(r.status, 200, 'S5 未初始化项目应 200');
    assert.deepEqual({ refine: r.json.refine, develop: r.json.develop }, { refine: null, develop: null }, 'S5 未初始化项目应两 null');
  } finally {
    server.kill('SIGKILL');
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
