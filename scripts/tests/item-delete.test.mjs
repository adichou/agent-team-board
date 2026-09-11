#!/usr/bin/env node
// REQ-20260908-003 待接受条目删除（需求与 Bug，仅 submitted；需求有下属 Bug 时拒绝）
// 用法：node scripts/tests/item-delete.test.mjs
// 覆盖 test-cases.md 的 D1–D7、U1–U3。
// 模式对齐 rename-reject.test.mjs：core 集成 + 真实服务 HTTP + CLI 静态契约 + UI 静态/沙箱。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');
const ATB_CLI = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs'), 'utf8');
const APP_JS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'app.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tempProject(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atb-del-${tag}-`));
  core.initData(root);
  return { root, dataDir: core.dataDirFrom(root) };
}

// ---------- core：删除（D1–D5） ----------

t('D1 submitted 需求删除：目录移除、列表不再出现、其余条目与单号计数器不受影响', () => {
  const { dataDir } = tempProject('d1');
  const victim = core.createItem(dataDir, { type: 'requirement', title: '误登记需求', by: 'test' });
  const keeper = core.createItem(dataDir, { type: 'requirement', title: '正常需求', by: 'test' });
  const num = Number(victim.id.slice(-3));

  const r = core.deleteItem(dataDir, victim.id, { by: 'human' });
  assert.equal(r.id, victim.id, '返回被删单号');
  assert.equal(r.title, '误登记需求', '返回被删标题');
  assert.equal(fs.existsSync(path.join(dataDir, 'requirements', victim.id)), false, '条目目录应整体移除');
  assert.ok(!core.listItems(dataDir).some((x) => x.id === victim.id), '列表不应再含被删条目');
  assert.ok(core.listItems(dataDir).some((x) => x.id === keeper.id), '其余条目不受影响');

  // 计数器不回退：下一张新单编号在被删单号之后，不复用
  const next = core.createItem(dataDir, { type: 'requirement', title: '后续新单', by: 'test' });
  assert.ok(Number(next.id.slice(-3)) > num, `新单号应大于被删单号（${next.id} > ${victim.id}）`);
});

t('D2 submitted Bug（独立与归属需求）删除：各自目录移除，宿主需求完好', () => {
  const { dataDir } = tempProject('d2');
  const host = core.createItem(dataDir, { type: 'requirement', title: '宿主需求', by: 'test' });
  const alone = core.createItem(dataDir, { type: 'bug', title: '独立误报', by: 'test' });
  const nested = core.createItem(dataDir, { type: 'bug', title: '归属误报', by: 'test' });
  core.moveBug(dataDir, nested.id, host.id); // REQ-20260908-009：归属 Bug 经 move 构造（存量形态）

  core.deleteItem(dataDir, alone.id, { by: 'human' });
  core.deleteItem(dataDir, nested.id, { by: 'human' });
  assert.equal(fs.existsSync(path.join(dataDir, 'bugs', alone.id)), false, '独立 Bug 目录应移除');
  assert.equal(fs.existsSync(path.join(dataDir, 'requirements', host.id, 'bugs', nested.id)), false, '归属 Bug 目录应移除');
  assert.ok(fs.existsSync(path.join(dataDir, 'requirements', host.id)), '宿主需求应完好');
  const detail = core.getItemDetail(dataDir, host.id);
  assert.equal(detail.bugCount, 0, '宿主需求下属 Bug 计数应归零');
});

t('D3 非 submitted 状态拒绝删除：accepted / in-progress / done，目录完好', () => {
  const { dataDir } = tempProject('d3');
  const mk = (title) => core.createItem(dataDir, { type: 'requirement', title, by: 'test' });
  // accepted
  const acc = mk('状态accepted');
  core.setStatus(dataDir, acc.id, 'accepted', { by: 'human' });
  // in-progress：认领占用实施互斥，report 收尾释放（状态保持 in-progress）
  const dev = mk('状态in-progress');
  core.setStatus(dataDir, dev.id, 'accepted', { by: 'human' });
  core.claim(dataDir, dev.id, 'tester');
  core.report(dataDir, dev.id, { summary: '收尾释放实施互斥', by: 'tester' });
  // done：确认完成自动释放实施互斥
  const fin = mk('状态done');
  core.setStatus(dataDir, fin.id, 'accepted', { by: 'human' });
  core.claim(dataDir, fin.id, 'tester');
  core.setStatus(dataDir, fin.id, 'done', { by: 'human' });

  for (const id of [acc.id, dev.id, fin.id]) {
    const st = core.getItemDetail(dataDir, id);
    assert.throws(() => core.deleteItem(dataDir, id, { by: 'human' }), core.AtbError, `${st.status} 应拒绝删除`);
    assert.ok(fs.existsSync(core.resolveItemDir(dataDir, id).dir), `${st.status} 目录应完好`);
  }
});

t('D4 需求有下属 Bug 时拒绝删除并指引；下属 Bug 删除后需求可删', () => {
  const { dataDir } = tempProject('d4');
  const host = core.createItem(dataDir, { type: 'requirement', title: '带Bug需求', by: 'test' });
  const bug = core.createItem(dataDir, { type: 'bug', title: '挂靠Bug', by: 'test' });
  core.moveBug(dataDir, bug.id, host.id); // REQ-20260908-009：归属 Bug 经 move 构造（存量形态）

  assert.throws(() => core.deleteItem(dataDir, host.id, { by: 'human' }), /下属 Bug/, '有下属 Bug 应拒绝');
  assert.ok(fs.existsSync(core.resolveItemDir(dataDir, host.id).dir), '需求目录应完好');

  core.deleteItem(dataDir, bug.id, { by: 'human' });
  const hostDir = core.resolveItemDir(dataDir, host.id).dir; // 删除前记录目录（删除后 resolveItemDir 会找不到）
  const r = core.deleteItem(dataDir, host.id, { by: 'human' });
  assert.equal(r.id, host.id, '清空下属 Bug 后需求应可删');
  assert.ok(!fs.existsSync(hostDir), '删除后目录应移除');
});

t('D5 不存在 / 非法单号报 AtbError', () => {
  const { dataDir } = tempProject('d5');
  assert.throws(() => core.deleteItem(dataDir, 'REQ-20990101-999', { by: 'human' }), core.AtbError, '不存在的单号应报错');
  assert.throws(() => core.deleteItem(dataDir, 'not-an-id', { by: 'human' }), core.AtbError, '非法单号应报错');
});

// ---------- server HTTP 集成（D6） ----------

function httpRequest(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const rq = http.request({
      hostname: '127.0.0.1', port, path: p, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 5000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => resolve({ code: rs.statusCode, body: out }));
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('request timeout')); });
    if (payload) rq.write(payload);
    rq.end();
  });
}

t('D6 服务端：DELETE /api/item/:id——submitted 成功且看板列表不再含；accepted 拒绝 400；未知单号 400', async () => {
  const { root, dataDir } = tempProject('d6');
  const sub = core.createItem(dataDir, { type: 'requirement', title: '待接受删除', by: 'test' });
  const acc = core.createItem(dataDir, { type: 'bug', title: '已接受不可删', by: 'test' });
  core.setStatus(dataDir, acc.id, 'accepted', { by: 'human' });

  const port = 24000 + Math.floor(Math.random() * 8000);
  const registry = path.join(os.tmpdir(), `atb-reg-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(process.execPath, [SERVER], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: registry },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await sleep(100);
      up = await httpRequest(port, 'GET', '/api/health').then((r) => r.code === 200).catch(() => false);
    }
    assert.ok(up, '测试服务应启动');

    const ok = await httpRequest(port, 'DELETE', `/api/item/${sub.id}`);
    assert.equal(ok.code, 200, `待接受删除应成功：${ok.body}`);
    assert.equal(JSON.parse(ok.body).ok, true, '响应应带 ok 标记');
    assert.equal(fs.existsSync(path.join(dataDir, 'requirements', sub.id)), false, '目录应已移除');
    const board = JSON.parse((await httpRequest(port, 'GET', '/api/board')).body);
    assert.ok(!board.items.some((x) => x.id === sub.id), '看板列表不应再含被删条目');

    const badState = await httpRequest(port, 'DELETE', `/api/item/${acc.id}`);
    assert.equal(badState.code, 400, '非 submitted 删除应按业务错误返回 400');
    assert.ok(fs.existsSync(core.resolveItemDir(dataDir, acc.id).dir), '被拒条目目录应完好');

    const unknown = await httpRequest(port, 'DELETE', '/api/item/REQ-20990101-999');
    assert.equal(unknown.code, 400, '未知单号应返回 400');
  } finally {
    child.kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(registry, { force: true }); } catch {}
  }
});

// ---------- CLI 静态契约（D7） ----------

t('D7 CLI：atb delete 子命令登记于 usage 并调用 core.deleteItem', () => {
  assert.match(ATB_CLI, /atb delete <ID>/, 'usage 应登记 delete');
  assert.match(ATB_CLI, /cmd === 'delete'/, '应分发 delete 子命令');
  assert.match(ATB_CLI, /core\.deleteItem\(/, '应调用 core.deleteItem');
});

// ---------- UI 静态契约（U1/U2） ----------

t('U1 UI 静态：submitted 卡片与详情页渲染删除按钮（仅 submitted 分支内），提交走 DELETE /api/item/:id', () => {
  const row = APP_JS.match(/function reqRowEl\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  const onlySubmitted = row.match(/\$\{it\.status === 'submitted' \? `([^`]*)` : ''\}/g) || [];
  assert.ok(onlySubmitted.some((s) => s.includes('data-delete-id')), '删除按钮应在 submitted 条件分支内（卡片）');
  const drawerBtn = APP_JS.match(/function drawerActionsButtonHtml\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(drawerBtn, /case 'submitted':[\s\S]*data-act="accepted"[\s\S]*data-delete-id=/, '详情页 submitted 应有删除按钮');
  assert.match(APP_JS, /function deleteItem\(/, '应存在删除提交函数');
  assert.match(APP_JS, /method: 'DELETE'/, '提交应使用 DELETE 方法');
  assert.match(APP_JS, /bindDeleteButtons/, '应绑定删除按钮事件');
});

t('U2 UI 静态：deleteItem 用页面内 danger 确认（不用 window.confirm），成功后刷新并关闭被删条目抽屉', () => {
  const fn = APP_JS.match(/async function deleteItem\(id\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, '应存在 deleteItem 函数');
  assert.match(fn, /uiConfirm\(/, '删除应弹页面内确认对话框');
  assert.match(fn, /danger: true/, '确认对话框应为 danger 样式');
  assert.doesNotMatch(fn, /window\.confirm/, 'IAB 内禁用同步 confirm（BUG-20260907-009）');
  assert.match(fn, /await poll\(\)/, '删除成功后应刷新看板');
  assert.match(fn, /closeDrawer\(\)/, '抽屉展示被删条目时应关闭');
  assert.match(APP_JS, /function uiConfirm\(/, '应提供 uiConfirm');
});

// ---------- UI 沙箱（U3：提交流程） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    removeEventListener() {},
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    remove() {},
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {}, focus() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function uiSetup() {
  const source = APP_JS;
  const document = element();
  document.createElement = element;
  document.body = element();
  const requests = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [
    { id: 'REQ-20990101-001', type: 'requirement', status: 'submitted', title: '待接受删除' },
    { id: 'REQ-20990101-002', type: 'requirement', status: 'accepted', title: '已接受' },
  ] };
  run('toast = () => {}; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {}; refreshDrawer = async () => {}; poll = async () => {};');
  return { sandbox, state, run, requests };
}

t('U3 沙箱：deleteItem 确认后发一次 DELETE 请求；取消确认不发请求', async () => {
  const h = uiSetup();
  h.sandbox.uiConfirm = async () => true; // stub：确认删除
  await h.run("deleteItem('REQ-20990101-001')");
  assert.equal(h.requests.length, 1, '确认后应发一次请求');
  const req = h.requests[0];
  assert.match(req.url, /\/api\/item\/REQ-20990101-001\?project=%2Fproject%2Fa$/);
  assert.equal(req.opts.method, 'DELETE');

  h.sandbox.uiConfirm = async () => false; // 取消
  await h.run("deleteItem('REQ-20990101-001')");
  assert.equal(h.requests.length, 1, '取消确认不应发请求');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
