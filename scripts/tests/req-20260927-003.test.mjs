#!/usr/bin/env node
// REQ-20260927-003 需求支持退回已计划（in-progress → planned 人工回退边）——
// 状态机/清理口径/hold 拦截/守卫/API/UI/i18n 测试。
// 覆盖 test-cases.md 用例 1–12 的可自动化部分；用例 13（演示页人工核验）不在自动化范围。
// 用法：node scripts/tests/req-20260927-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as holdStore from '../lib/hold-store.mjs';
import '../web/i18n.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(PLUGIN_ROOT, 'scripts', 'state-guard.mjs');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- lib 脚手架 ----------

const tmpProjects = [];
function mkProject(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const dataDir = core.initData(root);
  tmpProjects.push(root);
  return { root, dataDir };
}

// 建单 → 接受 → 置计划 → 认领（进入开发中）
function mkDevItem(p, { type = 'requirement', title, owner }) {
  const st = core.createItem(p.dataDir, { type, title, description: 'x', by: 'tester' });
  core.setStatus(p.dataDir, st.id, 'accepted', { by: 'human' });
  core.setStatus(p.dataDir, st.id, 'planned', { by: 'human' });
  core.claim(p.dataDir, st.id, owner);
  return st.id;
}

function readSt(p, id) {
  return JSON.parse(fs.readFileSync(core.statusFileOfItemDir(core.resolveItemDir(p.dataDir, id).dir), 'utf8'));
}

const claimLockOf = (p, id) => path.join(p.dataDir, 'runtime', '.locks', `${id}.lock`);
const implLockOf = (p) => path.join(p.dataDir, 'runtime', '.locks', 'impl.lock');

// ---------- 第一部分：状态机与清理口径 ----------

t('C1 新回退边 in-progress → planned：人工退回成功，owner 清空、认领锁删除、留痕含退回语义', () => {
  const p = mkProject('atb-revert-plan-1-');
  assert.ok(core.TRANSITIONS['in-progress'].includes('planned'), 'in-progress 应可流转到 planned（退回已计划）');
  assert.ok(core.HUMAN_ONLY_TO.has('planned'), 'planned 仍为人工专属（Agent 不得直写新边）');
  const id = mkDevItem(p, { title: '退回已计划', owner: 'zcode-w1' });
  assert.equal(readSt(p, id).status, 'in-progress');
  assert.ok(fs.existsSync(claimLockOf(p, id)), '开发中应有认领锁');
  const { status: st } = core.setStatus(p.dataDir, id, 'planned', { by: 'human' });
  assert.equal(st.status, 'planned', '人工退回应成功');
  assert.equal(st.owner, null, '退回应清空 owner');
  assert.ok(!fs.existsSync(claimLockOf(p, id)), '退回应删除认领锁');
  const h = readSt(p, id).history.at(-1);
  assert.equal(h.from, 'in-progress');
  assert.equal(h.to, 'planned');
  assert.equal(h.by, 'human');
  assert.match(h.note, /退回已计划/, '留痕应含「退回已计划」语义');
});

t('C1b 已上报（待测试）单退回已计划：agentCompletedAt 一并清除', () => {
  const p = mkProject('atb-revert-plan-1b-');
  const id = mkDevItem(p, { title: '上报后退回', owner: 'zcode-w1' });
  core.report(p.dataDir, id, { summary: '完成', by: 'zcode-w1' });
  assert.ok(readSt(p, id).agentCompletedAt, '上报后应有 agentCompletedAt');
  const { status: st } = core.setStatus(p.dataDir, id, 'planned', { by: 'human' });
  assert.equal(st.status, 'planned');
  assert.equal(st.agentCompletedAt ?? null, null, '退回已计划应清除上报标记（对齐驳回完成重开口径）');
});

t('C2 退回释放实施互斥并可重新取单：认领 → 退回 → 再认领闭环', () => {
  const p = mkProject('atb-revert-plan-2-');
  const id1 = mkDevItem(p, { title: '在办单', owner: 'zcode-a' });
  const other = core.createItem(p.dataDir, { type: 'requirement', title: '他单', description: 'x', by: 'tester' });
  core.setStatus(p.dataDir, other.id, 'accepted', { by: 'human' });
  core.setStatus(p.dataDir, other.id, 'planned', { by: 'human' });
  assert.throws(() => core.claim(p.dataDir, other.id, 'zcode-b'), /项目实施互斥/, '实施互斥期间他人认领应被拒');
  core.setStatus(p.dataDir, id1, 'planned', { by: 'human' });
  assert.ok(!fs.existsSync(implLockOf(p)), '退回应释放实施互斥（其他实施入口恢复可用）');
  const st2 = core.claim(p.dataDir, other.id, 'zcode-b');
  assert.equal(st2.status, 'in-progress', '互斥释放后他单可开工');
  core.report(p.dataDir, other.id, { summary: 'x', by: 'zcode-b' });
  const st3 = core.claim(p.dataDir, id1, 'zcode-c');
  assert.equal(st3.status, 'in-progress', '退回后的单回已计划队列可重新取单');
  assert.equal(st3.owner, 'zcode-c');
  assert.ok(fs.existsSync(claimLockOf(p, id1)), '再认领应重建认领锁');
});

t('C3 活跃 hold 拦截退回并引导复工；force 不放行；hold 闭环（补齐 → 复工 / 作废）零回退', () => {
  const p = mkProject('atb-revert-plan-3-');
  const id = mkDevItem(p, { title: '受阻单', owner: 'zcode-w' });
  holdStore.declareHold(p.dataDir, id, { questions: ['范围如何取舍？'], reason: '需人工决策', by: 'zcode-w' });
  assert.throws(
    () => core.setStatus(p.dataDir, id, 'planned', { by: 'human' }),
    (e) => { assert.match(e.message, /待人工决策/); assert.match(e.message, /复工|待人工确认/, '报错应引导补齐决策并复工'); return true; },
    '活跃 hold 时不得借新边退回已计划',
  );
  assert.throws(() => core.setStatus(p.dataDir, id, 'planned', { by: 'human', force: true }), /待人工决策/, '退回边不提供 force 越过');
  assert.throws(() => core.setStatus(p.dataDir, id, 'done', { by: 'human' }), /人工决策未答/, '确认完成未答拦截不回归');
  // 决策补齐 → 复工回已计划（REQ-20260911-007 专用通路保持原样）
  holdStore.answerHold(p.dataDir, id, { answers: [{ q: 'q1', text: '按方案 A' }], by: 'human' });
  const r = holdStore.resumeHold(p.dataDir, id, { by: 'human' });
  assert.equal(r.status, 'planned', '复工仍经专用通路回已计划');
  assert.equal(readSt(p, id).status, 'planned');
  // 作废 hold 后，退回边可用（作废即声明闭环、条目仍开发中）
  const id2 = mkDevItem(p, { title: '作废后撤单', owner: 'zcode-w2' });
  holdStore.declareHold(p.dataDir, id2, { questions: ['仍继续吗？'], by: 'zcode-w2' });
  assert.throws(() => core.setStatus(p.dataDir, id2, 'planned', { by: 'human' }), /待人工决策/);
  holdStore.cancelHold(p.dataDir, id2, { by: 'human' });
  const { status: st2 } = core.setStatus(p.dataDir, id2, 'planned', { by: 'human' });
  assert.equal(st2.status, 'planned', '作废声明后退回边可用');
});

t('C4 非法流转文案更新：合法路径说明含「退回已计划」；其余非法边仍拒绝', () => {
  const p = mkProject('atb-revert-plan-4-');
  const st = core.createItem(p.dataDir, { type: 'requirement', title: '非法边', description: 'x', by: 'tester' });
  assert.throws(
    () => core.setStatus(p.dataDir, st.id, 'planned', { by: 'human' }),
    (e) => { assert.match(e.message, /非法流转/); assert.match(e.message, /退回已计划/, '合法路径说明应含 in-progress → planned（退回已计划）'); return true; },
  );
  core.setStatus(p.dataDir, st.id, 'accepted', { by: 'human' });
  core.setStatus(p.dataDir, st.id, 'planned', { by: 'human' });
  core.claim(p.dataDir, st.id, 'zcode-x');
  assert.throws(() => core.setStatus(p.dataDir, st.id, 'accepted', { by: 'human' }), /非法流转/, 'in-progress → accepted 仍拒绝');
  assert.throws(() => core.setStatus(p.dataDir, st.id, 'submitted', { by: 'human' }), /非法流转/, 'in-progress → submitted 仍拒绝');
});

t('C5 守卫拦截不回归：Agent 执行 atb status <ID> planned / curl 置 planned 均退出码 2', async () => {
  const run = (input) => new Promise((resolve) => {
    const proc = spawn(process.execPath, [GUARD, 'bash'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('close', (code) => resolve({ code, err }));
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
  const atb = await run({ tool_input: { command: `node ${path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs')} status REQ-1 planned` } });
  assert.equal(atb.code, 2, 'atb status planned 应被拦截');
  assert.match(atb.err, /planned/, '拦截原因应点名 planned');
  const curl = await run({ tool_input: { command: `curl -s -X POST http://127.0.0.1:8888/api/item/REQ-1/status -d to=planned` } });
  assert.equal(curl.code, 2, 'curl 人工接口置 planned 应被拦截');
});

t('C10 Bug 条目同链路：开发中 Bug 亦可人工退回已计划并重新取单', () => {
  const p = mkProject('atb-revert-plan-10-');
  const id = mkDevItem(p, { type: 'bug', title: 'Bug 退回', owner: 'zcode-w1' });
  const { status: st } = core.setStatus(p.dataDir, id, 'planned', { by: 'human' });
  assert.equal(st.status, 'planned', 'Bug 与需求共用状态机，退回应生效');
  const st2 = core.claim(p.dataDir, id, 'zcode-w2');
  assert.equal(st2.status, 'in-progress', 'Bug 退回后可重新取单');
});

// ---------- 第二部分：server API ----------

function request(method, url, body) {
  const __http = http;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = __http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(data || '{}'); } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let serverProc = null;
let base = '';
const p_api = mkProject('atb-revert-plan-api-');
const apiItem = mkDevItem(p_api, { title: 'API 退回', owner: 'zcode-api' });

async function tryStartServer(port) {
  const proc = spawn(process.execPath, [SERVER], {
    cwd: p_api.root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(os.tmpdir(), `atb-revert-plan-reg-${Date.now()}.json`) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    try {
      const r = await request('GET', `http://127.0.0.1:${port}/api/health?project=${encodeURIComponent(p_api.root)}`);
      if (r.status === 200) return proc;
    } catch {}
    if (proc.exitCode !== null) throw new Error('server 提前退出');
  }
  proc.kill();
  throw new Error('server 启动超时');
}

t('C6 网页人工流转：in-progress → planned 200，看板即入已计划；再认领后完整闭环可走通', async () => {
  assert.ok(base, 'server 未启动');
  const q = `?project=${encodeURIComponent(p_api.root)}`;
  const r1 = await request('POST', `${base}/api/item/${apiItem}/status${q}`, { to: 'planned' });
  assert.equal(r1.status, 200, `网页退回应成功：${JSON.stringify(r1.json)}`);
  assert.equal(r1.json.status, 'planned');
  assert.equal(r1.json.owner, null, '网页退回同样清空 owner');
  const board = await request('GET', `${base}/api/board${q}`);
  const it = board.json.items.find((x) => x.id === apiItem);
  assert.equal(it.status, 'planned', '看板应即时呈现已计划');
  // 再认领走通闭环：claim → report（待测试）
  core.claim(p_api.dataDir, apiItem, 'zcode-api2');
  core.report(p_api.dataDir, apiItem, { summary: '再认领后上报', by: 'zcode-api2' });
  const board2 = await request('GET', `${base}/api/board${q}`);
  const it2 = board2.json.items.find((x) => x.id === apiItem);
  assert.equal(it2.status, 'in-progress');
  assert.ok(it2.agentCompletedAt, '完整闭环（认领 → 退回 → 再认领 → 上报）可走通');
});

// ---------- 第三部分：前端 UI ----------

const webRoot = path.join(PLUGIN_ROOT, 'scripts', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false, indeterminate: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setupUI(items) {
  const document = element();
  document.createElement = element;
  document.querySelector = (selector) => document.nodes.get(selector) ?? null;
  const seed = (selector, el) => document.nodes.set(selector, el);
  const toastEl = element();
  seed('#toast', toastEl);
  const requests = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    navigator: { clipboard: { writeText: async () => true } },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) } },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/p';
  state.board = { initialized: true, items };
  run('poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; uiConfirm = async () => true;');
  return { sandbox, document, state, run, requests, toastEl };
}

const uiItem = (id, status, owner = null, extra = {}) => ({
  id, type: 'requirement', status, owner, parent: null, title: id,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});

t('C7 详情按钮：开发中条目有「↩ 退回已计划」（warn）；活跃 hold 禁用 + tooltip 引导', () => {
  const h = setupUI([uiItem('REQ-20990101-3', 'in-progress', 'dev-x')]);
  const html = h.run('drawerActionsButtonHtml({ id: "REQ-20990101-3", status: "in-progress", title: "t" })');
  assert.match(html, /data-act="done"/, '确认完成保留在前');
  assert.match(html, /class="btn warn" data-act="planned" data-label="退回已计划"/, '退回已计划应为 warn 风格回退按钮');
  assert.match(html, /↩ 退回已计划/);
  assert.doesNotMatch(html, /disabled/, '无 hold 时退回按钮可用');
  const held = h.run('drawerActionsButtonHtml({ id: "REQ-20990101-3", status: "in-progress", title: "t", hold: { state: "holding", unanswered: 2, total: 3 } })');
  assert.match(held, /disabled/, '活跃 hold 时退回按钮禁用');
  assert.match(held, /待人工决策中，请在『待人工确认』补齐决策后复工/, '禁用原因 tooltip 应引导补齐决策后复工');
});

t('C8 toast 口径：退回已计划不附撤销（首版）；「移入计划」撤销口径零回退', async () => {
  const h = setupUI([uiItem('REQ-20990101-3', 'in-progress', 'dev-x'), uiItem('REQ-20990101-4', 'accepted')]);
  await h.run(`drawerAction('REQ-20990101-3', 'planned', '退回已计划')`);
  const post = h.requests.find((r) => /\/api\/item\/[^/]+\/status/.test(r.url));
  assert.ok(post, '退回应发起流转请求');
  assert.deepEqual(JSON.parse(post.opts.body), { to: 'planned' });
  assert.match(h.toastEl.textContent, /已退回已计划/, '成功 toast 应含退回已计划语义');
  assert.equal(h.toastEl.children.length, 0, '首版退回不附撤销（toast 纯文本、无撤销按钮节点）');
  const h2 = setupUI([uiItem('REQ-20990101-4', 'accepted')]);
  await h2.run(`drawerAction('REQ-20990101-4', 'planned', '移入计划')`);
  assert.equal(h2.toastEl.children.length, 2, '移入计划仍附撤销');
  assert.equal(h2.toastEl.children[1].textContent, '撤销');
});

t('C9 新增文案中英文同步：按钮 / data-label / tooltip / toast 模板均有 EN 词条', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  assert.equal(EN['↩ 退回已计划'], '↩ Back to planned');
  assert.equal(EN['退回已计划'], 'Back to planned');
  assert.equal(EN['待人工决策中，请在『待人工确认』补齐决策后复工'], 'Awaiting human decisions: answer them under "Pending human decisions" and resume');
  assert.equal(EN_DYNAMIC['✓ ◇ 已退回已计划'], '✓ $1 reverted to planned');
});

// ---------- 执行 ----------

let failed = 0;
try {
  for (const port of [29615, 29715, 29815]) {
    try {
      serverProc = await tryStartServer(port);
      base = `http://127.0.0.1:${port}`;
      break;
    } catch (e) {
      if (port === 29815) throw e;
    }
  }
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
    }
  }
} finally {
  if (serverProc) serverProc.kill();
  for (const root of tmpProjects) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
