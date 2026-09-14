#!/usr/bin/env node
// REQ-20260908-010 批量开发 + 「已计划」状态 —— 状态机/守卫/选单口径/实时队列/API/UI 测试
// 覆盖 test-cases.md 用例 1、2、3、5、6、7、8、9、10、11、12、13、14、16、17、20 的可自动化部分
// 用法：node scripts/tests/planned-state.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';

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
  batch.ensureDispatch(dataDir);
  tmpProjects.push(root);
  return { root, dataDir };
}

function mkItem(p, { type = 'requirement', title, accept = true, plan = false }) {
  const st = core.createItem(p.dataDir, { type, title, description: 'x', by: 'tester' });
  if (accept) core.setStatus(p.dataDir, st.id, 'accepted', { by: 'human' });
  if (plan) core.setStatus(p.dataDir, st.id, 'planned', { by: 'human' });
  return st.id;
}

function readSt(p, id) {
  return JSON.parse(fs.readFileSync(path.join(core.resolveItemDir(p.dataDir, id).dir, 'status.json'), 'utf8'));
}

// ---------- 第一部分：状态机与守卫（用例 1/2/3/14） ----------

t('S1 状态机合法边：accepted→planned（人工）、planned→accepted、claim planned→in-progress，均留痕', () => {
  const p = mkProject('atb-planned-sm-');
  const id = mkItem(p, { title: '计划流转' });
  const { status: st1 } = core.setStatus(p.dataDir, id, 'planned', { by: 'human' });
  assert.equal(st1.status, 'planned');
  assert.ok(core.STATES.includes('planned'), 'STATES 应含 planned');
  assert.ok(core.TRANSITIONS.accepted.includes('planned'), 'accepted 应可流转到 planned');
  assert.deepEqual(core.TRANSITIONS.planned, ['in-progress', 'accepted'], 'planned 可认领或移出计划');
  assert.ok(core.HUMAN_ONLY_TO.has('planned'), 'planned 应为人工专属（Agent 不得自行置计划）');

  const st2 = core.claim(p.dataDir, id, 'zcode-planned');
  assert.equal(st2.status, 'in-progress');
  assert.equal(st2.owner, 'zcode-planned');
  core.report(p.dataDir, id, { summary: 'done', by: 'zcode-planned' });

  const id2 = mkItem(p, { title: '移出计划' });
  core.setStatus(p.dataDir, id2, 'planned', { by: 'human' });
  const { status: st3 } = core.setStatus(p.dataDir, id2, 'accepted', { by: 'human' });
  assert.equal(st3.status, 'accepted', 'planned → accepted（移出计划）应成功');
  const h = readSt(p, id2).history.map((x) => `${x.from}>${x.to}`);
  assert.ok(h.includes('accepted>planned') && h.includes('planned>accepted'), 'pushHistory 应记录计划与移出');
});

t('S2 非法边：planned→done、planned→submitted、submitted→planned 均被拒', () => {
  const p = mkProject('atb-planned-illegal-');
  const id = mkItem(p, { title: '非法边' });
  core.setStatus(p.dataDir, id, 'planned', { by: 'human' });
  assert.throws(() => core.setStatus(p.dataDir, id, 'done', { by: 'human' }), /非法流转/, 'planned→done 拒绝');
  assert.throws(() => core.setStatus(p.dataDir, id, 'submitted', { by: 'human' }), /非法流转/, 'planned→submitted 拒绝');
  const sub = mkItem(p, { title: '待接受', accept: false });
  assert.throws(() => core.setStatus(p.dataDir, sub, 'planned', { by: 'human' }), /非法流转/, 'submitted→planned 拒绝');
});

t('S3 claim(planned) 占用项目实施互斥：他人认领同项目被拒；锁属主放行；report 释放', () => {
  const p = mkProject('atb-planned-mutex-');
  const id = mkItem(p, { title: '互斥' });
  core.setStatus(p.dataDir, id, 'planned', { by: 'human' });
  const st = core.claim(p.dataDir, id, 'zcode-a');
  assert.equal(st.status, 'in-progress');
  const other = mkItem(p, { title: '他单', plan: true });
  assert.throws(() => core.claim(p.dataDir, other, 'zcode-b'), /项目实施互斥/, '互斥期间他人认领应被拒');
  core.report(p.dataDir, id, { summary: 'done', by: 'zcode-a' });
  const st2 = core.claim(p.dataDir, other, 'zcode-b');
  assert.equal(st2.status, 'in-progress', 'report 释放占用后可认领下一项');
  core.report(p.dataDir, other, { summary: 'done', by: 'zcode-b' });
});

t('S4 守卫拦截：Agent 执行 atb status <ID> planned / curl to=planned 均退出码 2', async () => {
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

// ---------- 第二部分：选单口径与实时队列（用例 9/10/13） ----------

t('S5 候选口径：只取 planned 未认领；最旧优先（更早创建的 Bug 排在需求之前，不再需求优先）', () => {
  const p = mkProject('atb-planned-cand-');
  const bug = mkItem(p, { type: 'bug', title: '老 Bug', plan: true });       // 创建最早
  const req = mkItem(p, { title: '新需求', plan: true });
  const acc = mkItem(p, { title: '仅已接受' });                               // 不再被自动派发
  mkItem(p, { title: '待接受', accept: false });
  const ids = batch.candidateItems(p.dataDir).map((x) => x.id);
  assert.deepEqual(ids, [bug, req], '候选应只含 planned 未认领，按创建时间升序');
  assert.ok(!ids.includes(acc), 'accepted 不再入候选');
});

t('S6 实时队列：批次创建后新置计划的条目可被取到；处理完自动取下一最旧项', () => {
  const p = mkProject('atb-planned-live-');
  const a = mkItem(p, { title: 'A 最旧', plan: true });
  const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
  assert.deepEqual(bt.candidates, [], '建轮不冻结候选快照（REQ-20260913-003）');
  assert.deepEqual(batch.effectiveCandidates(p.dataDir, bt), [a], '生效候选实时读取当前已计划队列');
  const b = mkItem(p, { title: 'B 新计划', plan: true });                     // 创建批次之后才置计划
  const run1 = batch.nextItem(p.dataDir, bt.batchId, { owner: 'w1' });
  assert.equal(run1.itemId, a, '最旧优先：先处理 A');
  core.claim(p.dataDir, a, 'w1');
  core.report(p.dataDir, a, { summary: 'done', by: 'w1', run: { runId: run1.runId } });
  batch.finishRun(p.dataDir, run1.runId, { result: 'reported', reportRef: 'test-report.md' });
  const run2 = batch.nextItem(p.dataDir, bt.batchId, { owner: 'w1' });
  assert.equal(run2.itemId, b, '无需重启/新建批次即可取到新置计划的 B');
  core.claim(p.dataDir, b, 'w1');
  core.report(p.dataDir, b, { summary: 'done', by: 'w1', run: { runId: run2.runId } });
  batch.finishRun(p.dataDir, run2.runId, { result: 'reported', reportRef: 'test-report.md' });
  const tail = batch.nextItem(p.dataDir, bt.batchId, { owner: 'w1' });
  assert.equal(tail.stop, 'finished', '队列处理完毕收尾');
});

t('S13 选单口径收敛：scheduler 过滤 planned；空队列等待文案指向已计划', () => {
  const src = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'scheduler.mjs'), 'utf8');
  assert.match(src, /status === 'planned'/, '调度器应从 planned 选单');
  assert.ok(!/"status === 'accepted' && !openItemIds/.test(src) && !src.includes("x.status === 'accepted' && !openItemIds"),
    '调度器不再从 accepted 选单');
  const appjs = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(appjs, /等待已计划条目/, '队列已空文案应等待已计划条目');
});

// ---------- 第三部分：server API 与端到端（用例 20） ----------

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
const p_api = mkProject('atb-planned-api-');
const apiItem = mkItem(p_api, { title: 'API 计划' });

async function tryStartServer(port) {
  const proc = spawn(process.execPath, [SERVER], {
    cwd: p_api.root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(os.tmpdir(), `atb-planned-reg-${Date.now()}.json`) },
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

t('S7 网页人工流转：accepted→planned 200；planned→accepted 200；submitted→planned 403；planned→in-progress 网页不承担', async () => {
  assert.ok(base, 'server 未启动');
  const r1 = await request('POST', `${base}/api/item/${apiItem}/status?project=${encodeURIComponent(p_api.root)}`, { to: 'planned' });
  assert.equal(r1.status, 200, `置计划应成功：${JSON.stringify(r1.json)}`);
  assert.equal(r1.json.status, 'planned');
  const r2 = await request('POST', `${base}/api/item/${apiItem}/status?project=${encodeURIComponent(p_api.root)}`, { to: 'accepted' });
  assert.equal(r2.status, 200, '移出计划应成功');
  const sub = mkItem(p_api, { title: '待接受', accept: false });
  const r3 = await request('POST', `${base}/api/item/${sub}/status?project=${encodeURIComponent(p_api.root)}`, { to: 'planned' });
  assert.equal(r3.status, 403, 'submitted → planned 网页应拒绝');
  core.setStatus(p_api.dataDir, apiItem, 'planned', { by: 'human' });
  const r4 = await request('POST', `${base}/api/item/${apiItem}/status?project=${encodeURIComponent(p_api.root)}`, { to: 'in-progress' });
  assert.equal(r4.status, 403, 'planned → in-progress 网页不承担（Agent claim）');
  core.setStatus(p_api.dataDir, apiItem, 'accepted', { by: 'human' });
});

t('S8 端到端链路：已接受 → 已计划 → claim（开发中）→ report（待测试）状态与看板展示正确', async () => {
  assert.ok(base, 'server 未启动');
  const id = mkItem(p_api, { title: 'e2e' });
  core.setStatus(p_api.dataDir, id, 'planned', { by: 'human' });
  core.claim(p_api.dataDir, id, 'zcode-e2e');
  core.report(p_api.dataDir, id, { summary: '完成', coverage: 80, framework: 'node:test', by: 'zcode-e2e' });
  const board = await request('GET', `${base}/api/board?project=${encodeURIComponent(p_api.root)}`);
  const it = board.json.items.find((x) => x.id === id);
  assert.equal(it.status, 'in-progress');
  assert.ok(it.agentCompletedAt, '上报后应进入待测试（agentCompletedAt）');
});

// ---------- 第四部分：前端 UI（用例 4/5/6/7/8/11/12/16/17） ----------

const webRoot = path.join(PLUGIN_ROOT, 'scripts', 'web');
const source = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', title: '', disabled: false, checked: false,
    value: '', children: [], listeners: {},
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

function setupUI() {
  const document = element();
  document.createElement = element;
  const requests = [];
  const notices = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    navigator: { clipboard: { writeText: async () => true } },
    fetch: async (url, opts) => { requests.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/p';
  const item = (id, type = 'requirement', status = 'planned', owner = null) => ({
    id, type, status, owner, parent: null, title: id,
    createdAt: `2026-01-01T00:00:0${id.slice(-1)}.000Z`, updatedAt: '2026-01-01T00:00:00.000Z',
  });
  state.board = { initialized: true, items: [
    item('REQ-20990101-1'), item('REQ-20990101-2'),
    item('REQ-20990101-3', 'requirement', 'in-progress', 'dev-x'),
    item('REQ-20990101-4', 'requirement', 'accepted'),
    item('REQ-20990101-5', 'requirement', 'submitted'),
  ] };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  run('toast = recordNotice; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; uiConfirm = async () => true;');
  return { sandbox, document, state, run, requests, notices };
}

t('S9 筛选档与标签：LANES 含独立「已计划」档（已接受之后）；laneOf/STATE_LABEL 覆盖 planned', () => {
  const h = setupUI();
  assert.equal(h.run('LANES[2]'), 'planned', 'LANES 第三档应为 planned');
  assert.equal(h.run("LANE_LABEL['planned']"), '已计划');
  assert.equal(h.run("STATE_LABEL['planned']"), '已计划');
  assert.equal(h.run("laneOf({ status: 'planned' })"), 'planned');
  assert.match(h.source || source, /REQ_FILTERS = LANES\.map/, '筛选档由 LANES 派生');
});

t('S10 详情按钮：accepted 有「移入计划」（BUG-20260908-006 统一文案）；planned 有「移出计划」；撤销映射覆盖 planned', () => {
  const h = setupUI();
  const acc = h.run('drawerActionsButtonHtml({ id: "REQ-20990101-4", status: "accepted", title: "t" })');
  assert.match(acc, /data-act="planned"/, 'accepted 详情应有移入计划按钮');
  assert.match(acc, /移入计划/);
  const pl = h.run('drawerActionsButtonHtml({ id: "REQ-20990101-1", status: "planned", title: "t" })');
  assert.match(pl, /data-act="accepted"/, 'planned 详情应有移出计划按钮');
  assert.match(pl, /移出计划/);
  assert.ok(h.run('ACTION_UNDO["planned"]'), '置计划应可撤销（撤销=移出计划）');
});

t('S11 批量移出计划：勾选 planned 逐条退回 accepted；in-progress 不可移出并单独反馈失败', async () => {
  const h = setupUI();
  await h.run('removeFromPlan(["REQ-20990101-1", "REQ-20990101-2"])');
  const posts = h.requests.filter((r) => /\/api\/item\/[^/]+\/status/.test(r.url));
  assert.equal(posts.length, 2, '两条 planned 均应发起移出计划');
  assert.ok(posts.every((r) => JSON.parse(r.opts.body).to === 'accepted'));
  assert.ok(h.notices.some((n) => /成功 2 条/.test(n.message)), '应有成功计数反馈');
  h.requests.length = 0;
  await h.run('removeFromPlan(["REQ-20990101-3"])');
  const posts2 = h.requests.filter((r) => /\/api\/item\/[^/]+\/status/.test(r.url));
  assert.equal(posts2.length, 0, '已进入开发中的单不可移出（不发请求）');
  assert.ok(h.notices.some((n) => /不能移出计划|没有可移出/.test(n.message)), '应给出不可移出原因');
});

t('S12 开发启动（REQ-20260909-011 去 Agent 化）：无执行 Agent 选择；点击启动直接创建批次并复制提示词', async () => {
  const h = setupUI();
  const bar = h.run('renderDevStartBar()');
  assert.match(bar, /id="devStart"[^>]*>启动</, 'REQ-20260908-026：启动按钮文案为「启动」');
  assert.doesNotMatch(bar, /id="devMode"/, 'REQ-20260909-011：不再有执行 Agent 选择');
  assert.match(bar, /已计划队列/, '启动前应展示已计划队列预览');
  assert.match(bar, /最旧优先/, '队列预览标注最旧优先');
  await h.run('startDevelopment()');
  const create = h.requests.find((r) => r.url.includes('/api/batch/create'));
  assert.ok(create, '点击启动应直接创建批次（复制通用主调度提示词）');
  assert.equal(JSON.parse(create.opts.body).agent, undefined, '创建请求不得携带执行 Agent');
  assert.ok(!h.requests.some((r) => r.url.includes('/api/dispatch/codex/toggle')), '不得触发 Codex 后台自动派发开关');
});

t('S16 改名检查：web 面向用户文案无「批量实施」残留；已计划档批量组仅「移出计划」（BUG-20260909-006 移除列表进入批量开发入口）', () => {
  for (const file of ['app.js', 'index.html']) {
    const text = fs.readFileSync(path.join(webRoot, file), 'utf8');
    assert.ok(!text.includes('批量实施'), `${file} 不应再出现「批量实施」`);
  }
  assert.ok(!htmlSrc.includes('implGo'), '「进入批量开发」按钮应随 BUG-20260909-006 移除（批量开发入口唯一收敛任务模块）');
  assert.match(htmlSrc, /id="planRemove"/, '选择工具条应有移出计划按钮');
  assert.match(source, /implCandidates[\s\S]*?status === 'planned'/, '列表勾选资格应改为已计划条目');
});

t('S17 回归：五档排序/勾选行为不破坏——planned 行出现选择框，accepted 行不再有', () => {
  const h = setupUI();
  const plannedRow = h.run('reqRowEl(state.board.items[0])').innerHTML;
  assert.match(plannedRow, /data-impl-id=/, 'planned 行应有选择框');
  const accRow = h.run('reqRowEl(state.board.items[3])').innerHTML;
  assert.doesNotMatch(accRow, /data-impl-id/, 'accepted 行不再提供批量开发选择框');
});

// ---------- 执行 ----------

let failed = 0;
try {
  for (const port of [29614, 29714, 29814]) {
    try {
      serverProc = await tryStartServer(port);
      base = `http://127.0.0.1:${port}`;
      break;
    } catch (e) {
      if (port === 29814) throw e;
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
