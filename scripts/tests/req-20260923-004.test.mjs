#!/usr/bin/env node
// REQ-20260923-004 删除待接受条目同步产生 git 提交（CLI 与网页端同口径）—— 分层测试。
// L1 git-flow 收口内核 commitItemDeletion（真实 git 临时仓库）：G1–G6
// L2 服务端 DELETE /api/item/:id 同口径（真实服务 + git 临时仓库）：G7
// L3 CLI / 服务端接线静态契约：G8
// L4 UI 静态与沙箱：U4 / U5（沙箱模式对齐 item-delete.test.mjs）
// 用法：node scripts/tests/req-20260923-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';
import * as gitFlow from '../lib/git-flow.mjs';
import { validateCommitSubject } from '../lib/commit-store.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');
const ATB_CLI = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs'), 'utf8');
const SERVER_SRC = fs.readFileSync(SERVER, 'utf8');
const APP_JS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'app.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

const porcelain = (root) => String(git(root, ['status', '--porcelain']).stdout || '');
const headSubject = (root) => String(git(root, ['log', '-1', '--format=%s']).stdout || '').trim();
const headFiles = (root) => String(git(root, ['show', '--name-only', '--format=', 'HEAD']).stdout || '')
  .split('\n').map((s) => s.trim()).filter(Boolean);

// git 化临时项目：initData（内部已 git init 并落 dev 分支）+ 身份配置 + 全量入库（含 victim 条目）
function gitProject(tag, { items = 1, type = 'requirement' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atb-delgit-${tag}-`));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  const created = [];
  for (let i = 0; i < items; i++) {
    created.push(core.createItem(dataDir, { type, title: `待删${type}${i + 1}`, by: 'test' }));
  }
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  return { root, dataDir, created };
}

const delAndCommit = (dataDir, root, id) => {
  const r = core.deleteItem(dataDir, id, { by: 'human' });
  return { r, gc: gitFlow.commitItemDeletion({ projectRoot: root, itemId: r.id, itemDir: r.dir }) };
};

/* ---------- L1 收口内核（G1–G6） ---------- */

t('G1 git 仓库删除 submitted 需求：一条含单号提交、仅含条目目录路径、工作区不再残留差异', () => {
  const { root, dataDir, created } = gitProject('g1');
  const victim = created[0];
  const before = headSubject(root); // 初始提交主题

  const { gc } = delAndCommit(dataDir, root, victim.id);
  assert.equal(gc.status, 'committed', `应产生同步提交：${gc.reason}`);
  assert.match(gc.commit.subject, new RegExp(`^doc: 删除待接受条目 ${victim.id}$`), '提交消息应为 doc 前缀 + 含单号');
  assert.equal(validateCommitSubject(gc.commit.subject, victim.id), null, '提交消息应过规范核验');
  assert.match(gc.shortHash, /^[0-9a-f]{7}$/, '应返回提交短号');
  assert.equal(headSubject(root), gc.commit.subject, 'HEAD 应即删除提交');
  assert.ok(headFiles(root).length, '提交应含文件');
  for (const p of headFiles(root)) {
    assert.ok(p.startsWith(`agent-team-board/data/requirements/${victim.id}/`), `提交只应含被删条目目录路径，实际含：${p}`);
  }
  assert.ok(!porcelain(root).includes(victim.id), '工作区不应再残留该条目删除差异');
  assert.ok(headSubject(root) !== before, '应新增提交');
  assert.equal(String(git(root, ['branch', '--show-current']).stdout).trim(), 'dev', '不得切换分支（initData 缺省 dev）');
  assert.equal(String(git(root, ['remote']).stdout).trim(), '', '不得配置远端（全程无 push）');
});

t('G2 不卷入无关改动：预置其他条目与板外脏文件 → 提交仅含被删目录，预置差异原样保留', () => {
  const { root, dataDir, created } = gitProject('g2', { items: 2 });
  const [victim, keeper] = created;
  // 预置脏改动：其他条目目录内改动 + 仓库根跟踪文件改动 + 未跟踪新文件
  const keeperFile = path.join(core.resolveItemDir(dataDir, keeper.id).dir, 'README.md');
  fs.appendFileSync(keeperFile, '\n预置脏改动\n');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'base\n');
  git(root, ['add', 'src/app.js']);
  git(root, ['commit', '-q', '-m', 'chore: 预置跟踪文件']);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'dirty\n');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n');
  const preDirty = porcelain(root);

  const { gc } = delAndCommit(dataDir, root, victim.id);
  assert.equal(gc.status, 'committed', `应产生同步提交：${gc.reason}`);
  const files = headFiles(root);
  assert.ok(files.every((p) => p.startsWith(`agent-team-board/data/requirements/${victim.id}/`)), `删除提交不得卷入无关路径：${files.join('、')}`);
  const after = porcelain(root).split('\n').filter(Boolean);
  for (const line of preDirty.split('\n').filter(Boolean)) {
    assert.ok(after.includes(line), `预置差异应原样保留：${line}`);
  }
  assert.ok(after.some((l) => l.includes(keeper.id)), '其他条目脏改动应保留');
  assert.ok(after.some((l) => l.includes('src/app.js')), '板外脏文件应保留');
});

t('G3 提交失败不回滚：预置 index.lock → 目录已移除、failed 带指引、差异留工作区，解锁后可补提交入库', () => {
  const { root, dataDir, created } = gitProject('g3');
  const victim = created[0];
  const r = core.deleteItem(dataDir, victim.id, { by: 'human' });
  assert.equal(fs.existsSync(r.dir), false, '条目目录应已移除（提交失败也不回滚）');

  fs.writeFileSync(path.join(root, '.git', 'index.lock'), 'lock'); // 构造提交失败
  const gc = gitFlow.commitItemDeletion({ projectRoot: root, itemId: r.id, itemDir: r.dir });
  assert.equal(gc.status, 'failed', 'index.lock 下提交应失败');
  assert.match(gc.reason, /同步提交失败/, 'reason 应含失败说明');
  assert.match(gc.reason, /人工补提交/, 'reason 应含人工补提交指引');
  assert.ok(porcelain(root).split('\n').some((l) => l.includes(victim.id) && l.trim().startsWith('D')), '删除差异应保留在工作区');

  fs.rmSync(path.join(root, '.git', 'index.lock')); // 人工排除故障后补提交（同收口内核）
  const retry = gitFlow.commitItemDeletion({ projectRoot: root, itemId: r.id, itemDir: r.dir });
  assert.equal(retry.status, 'committed', `解锁后应可补提交入库：${retry.reason}`);
  assert.match(headSubject(root), new RegExp(victim.id), '补提交消息应含单号');
  assert.ok(!porcelain(root).includes(victim.id), '入库后工作区不应再残留该差异');
});

t('G4 非 git 仓库：skipped 注明无法同步提交，删除照常成功不抛错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-delgit-g4-'));
  core.initData(root);
  // initData 会自动 git init；移除 .git 构造「非 git 仓库上的看板」场景
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const dataDir = core.dataDirFrom(root);
  const victim = core.createItem(dataDir, { type: 'requirement', title: '非git删除', by: 'test' });
  const r = core.deleteItem(dataDir, victim.id, { by: 'human' });
  const gc = gitFlow.commitItemDeletion({ projectRoot: root, itemId: r.id, itemDir: r.dir });
  assert.equal(gc.status, 'skipped', '非 git 仓库应跳过同步提交');
  assert.match(gc.reason, /非 git 仓库，无法同步提交/, 'reason 应注明非 git 仓库');
  assert.equal(fs.existsSync(r.dir), false, '删除应照常成功');
});

t('G5 待接受 Bug 条目同口径：data/bugs/<ID> 删除同样产生含单号提交', () => {
  const { root, dataDir, created } = gitProject('g5', { type: 'bug' });
  const victim = created[0];
  const { gc } = delAndCommit(dataDir, root, victim.id);
  assert.equal(gc.status, 'committed', `Bug 删除应同步提交：${gc.reason}`);
  assert.match(headSubject(root), new RegExp(`^doc: 删除待接受条目 ${victim.id}$`), 'Bug 提交消息应含单号');
  assert.ok(headFiles(root).every((p) => p.startsWith(`agent-team-board/data/bugs/${victim.id}/`)), '应仅含 Bug 条目目录路径');
});

t('G6 从未入库的条目删除：无 git 差异 → skipped，不产生空提交', () => {
  const { root, dataDir, created } = gitProject('g6');
  const fresh = core.createItem(dataDir, { type: 'requirement', title: '建后未提交', by: 'test' }); // 初始提交之后新建（未跟踪）
  const commitsBefore = String(git(root, ['rev-list', '--count', 'HEAD']).stdout).trim();
  const r = core.deleteItem(dataDir, fresh.id, { by: 'human' });
  const gc = gitFlow.commitItemDeletion({ projectRoot: root, itemId: r.id, itemDir: r.dir });
  assert.equal(gc.status, 'skipped', '从未入库的条目应跳过');
  assert.match(gc.reason, /无 git 差异/, 'reason 应注明无差异');
  assert.equal(String(git(root, ['rev-list', '--count', 'HEAD']).stdout).trim(), commitsBefore, '不得产生空提交');
  assert.equal(created.length, 1, '前置数据完整性');
});

/* ---------- L2 服务端集成（G7） ---------- */

function httpRequest(port, method, p) {
  return new Promise((resolve, reject) => {
    const rq = http.request({ hostname: '127.0.0.1', port, path: p, method, timeout: 5000 }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => resolve({ code: rs.statusCode, body: out }));
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('request timeout')); });
    rq.end();
  });
}

t('G7 服务端 DELETE /api/item/:id 同口径：响应携带 committed + 短号，git log 含单号', async () => {
  const { root, dataDir, created } = gitProject('g7');
  const victim = created[0];
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

    const res = await httpRequest(port, 'DELETE', `/api/item/${victim.id}`);
    assert.equal(res.code, 200, `删除应成功：${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true, '响应应带 ok 标记');
    assert.ok(body.gitCommit, '响应应携带 gitCommit 反馈');
    assert.equal(body.gitCommit.status, 'committed', '服务端删除应同步提交');
    assert.match(body.gitCommit.shortHash, /^[0-9a-f]{7}$/, '应返回提交短号');
    assert.match(headSubject(root), new RegExp(victim.id), '服务端通道 HEAD 应含单号');
    assert.ok(!porcelain(root).includes(victim.id), '工作区不应再残留该差异');
  } finally {
    child.kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(registry, { force: true }); } catch {}
  }
});

/* ---------- L3 接线静态契约（G8） ---------- */

t('G8 CLI 与服务端接线：delete 分支在 core.deleteItem 后调用 commitItemDeletion', () => {
  const cliDelete = ATB_CLI.match(/if \(cmd === 'delete'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(cliDelete, 'atb.mjs 应有 delete 分支');
  assert.match(cliDelete, /core\.deleteItem\(/, 'delete 分支应调用 core.deleteItem');
  assert.match(cliDelete, /commitItemDeletion\(/, 'CLI 删除后应调用同步提交');

  const serverDelete = SERVER_SRC.match(/req\.method === 'DELETE'[\s\S]{0,600}?core\.deleteItem\(/)?.[0] || '';
  assert.ok(serverDelete, 'server.mjs DELETE 端点应调用 core.deleteItem');
  const serverBlock = SERVER_SRC.slice(SERVER_SRC.indexOf(serverDelete), SERVER_SRC.indexOf(serverDelete) + 900);
  assert.match(serverBlock, /commitItemDeletion\(/, '服务端删除后应调用同步提交');
  assert.ok(typeof gitFlow.commitItemDeletion === 'function', 'gitFlow 应导出 commitItemDeletion');
});

/* ---------- L4 UI 静态与沙箱（U4 / U5） ---------- */

t('U4 UI 静态：确认文案说明同步 git 提交；反馈按 gitCommit.status 分支', () => {
  const fn = APP_JS.match(/async function deleteItem\(id\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, '应存在 deleteItem 函数');
  assert.match(fn, /同步产生一条 git 提交/, '确认文案应说明将同步产生 git 提交');
  assert.match(fn, /gitCommit/, '应读取响应 gitCommit 反馈');
  assert.match(fn, /shortHash/, 'committed 反馈应含提交短号');
  assert.match(fn, /status === 'failed'/, '失败应单独分支');
  assert.match(fn, /toast\([^)]*, true\)/, '失败应转警告 toast');
});

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
  vm.runInContext(APP_JS.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [
    { id: 'REQ-20990101-001', type: 'requirement', status: 'submitted', title: '待接受删除' },
  ] };
  run('updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {}; refreshDrawer = async () => {}; poll = async () => {};');
  run('var toasts = []; toast = (m, e) => toasts.push({ m, e });');
  sandbox.uiConfirm = async () => true; // stub：确认删除
  return { sandbox, state, run, requests };
}

t('U5 沙箱：提交结果三分支反馈（committed 短号 / failed 警告含指引 / 旧服务保持旧文案）', async () => {
  const h = uiSetup();
  const id = 'REQ-20990101-001';

  // committed：toast 含提交短号，非警告
  h.sandbox.fetch = async () => ({ ok: true, json: async () => ({ ok: true, gitCommit: { status: 'committed', shortHash: 'abc1234' } }) });
  await h.run(`deleteItem('${id}')`);
  assert.equal(h.run('toasts.length'), 1, '应有一条反馈');
  const ok1 = h.run('toasts[0]');
  assert.match(ok1.m, new RegExp(`已删除 ${id}（提交 abc1234）`), 'committed 反馈应含提交短号');
  assert.ok(!ok1.e, 'committed 应为普通 toast');

  // failed：转警告 toast，文案含失败原因（含补提交指引）
  h.run('toasts.length = 0;');
  h.sandbox.fetch = async () => ({ ok: true, json: async () => ({ ok: true, gitCommit: { status: 'failed', reason: '同步提交失败：index.lock；请在终端人工补提交该删除差异' } }) });
  await h.run(`deleteItem('${id}')`);
  const warn = h.run('toasts[0]');
  assert.ok(warn.e, 'failed 应为警告 toast');
  assert.match(warn.m, new RegExp(id), '警告文案应含单号');
  assert.match(warn.m, /同步提交失败/, '警告文案应含失败原因');
  assert.match(warn.m, /人工补提交/, '警告文案应含补提交指引');

  // skipped：普通 toast 说明跳过原因
  h.run('toasts.length = 0;');
  h.sandbox.fetch = async () => ({ ok: true, json: async () => ({ ok: true, gitCommit: { status: 'skipped', reason: '非 git 仓库，无法同步提交' } }) });
  await h.run(`deleteItem('${id}')`);
  const skip = h.run('toasts[0]');
  assert.ok(!skip.e, 'skipped 应为普通 toast');
  assert.match(skip.m, /非 git 仓库，无法同步提交/, 'skipped 反馈应说明跳过原因');

  // 旧服务（无 gitCommit 字段）：保持旧文案
  h.run('toasts.length = 0;');
  h.sandbox.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  await h.run(`deleteItem('${id}')`);
  assert.equal(h.run('toasts[0].m'), `✓ 已删除 ${id}`, '旧服务响应应保持旧文案');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
