#!/usr/bin/env node
// REQ-20260927-002 版本计划添加条目时自动关联该条目的全部提交（多提交整组、一次生效）。
// 覆盖（test-cases.md）：U=后端 lib 单元（autoAssociationIndex 三口径）/ S=服务端接口
// （候选元数据 + commits 数组整组落盘与校验）/ F=前端 vm（两面板整组自动关联、回退、
// 宽口径折叠、计数）/ I=i18n 词条同步。
// 用法：node scripts/tests/req-20260927-002.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as gitFlow from '../lib/git-flow.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ================= 后端 lib 单元：autoAssociationIndex ================= */

// 临时仓库脚手架：main(init) → dev；账本登记与场景提交自定。
async function setupRepo(prepare) {
  const { spawnSync } = await import('node:child_process');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req20260927-002-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: proj, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
    return r.stdout.trim();
  };
  g(['init', '-b', 'main']);
  g(['config', 'user.email', 't@e.co']);
  g(['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base\n');
  g(['add', '-A']);
  g(['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  g(['switch', 'dev']);
  let seq = 0;
  const ctx = {
    proj, dataDir,
    commit: (file, subject) => {
      fs.writeFileSync(path.join(proj, file), `${subject}\n`);
      g(['add', '-A']);
      g(['commit', '-m', subject]);
      return g(['rev-parse', 'HEAD']);
    },
    recordLedger: (itemId, hash) => {
      const runId = `run-ledger-${++seq}`;
      const dir = path.join(dataDir, 'runtime', 'commits', 'runs', runId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
        version: 1, runId, itemId, phase: 'committed', batchId: 'batch-test',
        createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        commits: [{ hash, subject: `test: ${itemId}` }],
      }));
    },
  };
  const out = prepare ? prepare(ctx) : {};
  return { ...ctx, ...out, close: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

const hashOf = (i) => String(i).padStart(40, String(i)); // 稳定假 hash

t('U1 autoAssociationIndex：回归样本型——主题末尾单号全部自动归属（旧→新、主题随带）', async () => {
  const h = await setupRepo((c) => {
    const id = 'REQ-20260926-002';
    c.commit('a.txt', `doc: 版本计划多对多组版 ${id}`);            // doc 提交
    c.commit('b.txt', `feat: 发布隔离与挑选合并 ${id}`);           // feat 主提交
    c.commit('c.txt', `test: 组版口径回归 ${id}`);
    c.commit('d.txt', `chore: 收口 ${id}`);
    return { id };
  });
  try {
    const idx = gitFlow.autoAssociationIndex(h.dataDir, h.proj);
    const rec = idx.get(h.id);
    assert.ok(rec, '条目应有索引记录');
    assert.equal(rec.auto.length, 4, `4 个主题末尾单号提交全部自动关联（实际 ${rec.auto.length}）`);
    assert.ok(rec.auto.every((x) => x.source === 'attribution'), '来源均为严格归属');
    assert.ok(rec.broad.length === 0, '无宽口径残留');
    // 旧→新：首个为最早提交（doc），末位为最新（chore 收口）
    assert.notEqual(rec.auto[0].subject, rec.auto[3].subject, '主题逐条随带');
    assert.match(rec.auto[0].subject, /^doc: /, '旧→新：首位为 doc 提交');
    assert.match(rec.auto[3].subject, /^chore: /, '旧→新：末位为 chore 收口提交');
    assert.ok(rec.auto.every((x) => /^[0-9a-f]{40}$/.test(x.hash)), 'hash 为 40 位');
  } finally { h.close(); }
});

t('U2 autoAssociationIndex：账本核验进自动集并升级来源；历史缺失的账本 hash 排末尾', async () => {
  const h = await setupRepo((c) => {
    const id = 'REQ-20260927-020';
    // 主题不含单号的 feat 提交（仅账本可归），一个中段提及单号的提交（宽口径型）
    const h1 = c.commit('f.txt', 'feat: 主功能提交（无单号主题）');
    c.commit('m.txt', `fix: 顺带提及 ${id} 的修复 REQ-20260927-026`);
    c.recordLedger(id, h1);
    c.recordLedger(id, hashOf('9')); // 不在 git 历史中的账本 hash（异常数据防御）
    return { id, h1 };
  });
  try {
    const rec = gitFlow.autoAssociationIndex(h.dataDir, h.proj).get(h.id);
    const ledgerHit = rec.auto.find((x) => x.hash === h.h1);
    assert.ok(ledgerHit, '账本 hash 进自动集');
    assert.equal(ledgerHit.source, 'ledger', '来源为账本核验');
    assert.ok(!rec.broad.some((x) => x.hash === h.h1), '账本 hash 不留宽口径重复');
    // 中段提及（后随另一末尾单号）→ 宽口径（非严格归属）
    assert.ok(rec.broad.length === 1, `中段提及只进宽口径（实际 broad=${rec.broad.length}）`);
    assert.ok(rec.auto.length === 2, '自动集 = 账本 2 条');
    assert.equal(rec.auto[1].hash, hashOf('9'), '历史缺失的账本 hash 稳定排末尾');
    assert.equal(rec.auto[1].subject, '', '历史缺失主题留空');
  } finally { h.close(); }
});

t('U3 autoAssociationIndex：大杂烩提交仅归属主题末尾单号，其余单号只进宽口径', async () => {
  const h = await setupRepo((c) => {
    const A = 'REQ-20260927-021';
    const B = 'REQ-20260927-022';
    const C = 'BUG-20260927-023';
    // 大杂烩：A 在中段、C 在括号内引用、B 在末尾（归属）
    c.commit('x.txt', `chore: 批量收口 ${A} 与 ${C}（引用另案） ${B}`);
    c.commit('y.txt', `feat: 独立改动 ${A}`);
    return { A, B, C };
  });
  try {
    const idx = gitFlow.autoAssociationIndex(h.dataDir, h.proj);
    const a = idx.get(h.A);
    const b = idx.get(h.B);
    const cc = idx.get(h.C);
    assert.equal(b.auto.length, 1, '大杂烩主题末尾单号条目：自动归属');
    assert.ok(b.broad.length === 0, '末尾单号不进宽口径');
    assert.equal(a.auto.length, 1, 'A 的自动集只含其独立 feat 提交');
    assert.notEqual(a.auto[0].hash, b.auto[0].hash, '大杂烩提交不在 A 的自动集中');
    assert.equal(a.broad.length, 1, '大杂烩提交对 A 是宽口径命中');
    assert.ok(cc.broad.length === 1 && cc.auto.length === 0, '括号内引用单号不算归属、进宽口径');
  } finally { h.close(); }
});

t('U4 autoAssociationIndex：纯宽口径条目——auto 为空、broad 按旧→新', async () => {
  const h = await setupRepo((c) => {
    const B = 'REQ-20260927-024'; // 中段提及（后随另一末尾单号）→ 只进宽口径
    const A = 'REQ-20260927-025'; // 末尾单号 → 严格归属
    c.commit('p1.txt', `fix: 提及 ${B} 的旧提交 ${A}`);
    c.commit('p2.txt', `doc: 又提及 ${B} 的一次 ${A}`);
    return { A, B };
  });
  try {
    const idx = gitFlow.autoAssociationIndex(h.dataDir, h.proj);
    const rec = idx.get(h.B);
    assert.ok(rec, '条目有记录');
    assert.equal(rec.auto.length, 0, '无账本、无严格归属 → 自动集为空');
    assert.equal(rec.broad.length, 2, '宽口径命中两条');
    assert.match(rec.broad[0].subject, /旧提交/, 'broad 旧→新：首位为旧提交');
    assert.match(rec.broad[1].subject, /一次/, 'broad 旧→新：末位为新提交');
    assert.equal(idx.get(h.A).auto.length, 2, '对照组：末尾单号条目严格归属两条');
  } finally { h.close(); }
});

/* ================= 服务端接口 ================= */

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

async function setupServer(prepare) {
  const { spawnSync } = await import('node:child_process');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req20260927-002-srv-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: proj, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
    return r.stdout.trim();
  };
  g(['init', '-b', 'main']);
  g(['config', 'user.email', 't@e.co']);
  g(['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base\n');
  g(['add', '-A']);
  g(['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  g(['switch', 'dev']);
  const ctx = {
    proj, dataDir,
    mkItem: (type, title) => core.createItem(dataDir, { type, title, by: 'test' }),
    markDone: (id) => { for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, id, s, { by: 'test' }); },
    commit: (file, subject) => {
      fs.writeFileSync(path.join(proj, file), `${subject}\n`);
      g(['add', '-A']);
      g(['commit', '-m', subject]);
      return g(['rev-parse', 'HEAD']);
    },
  };
  const ids = prepare ? prepare(ctx) : {};
  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const hh = await req(port, 'GET', '/api/health');
        if (hh.json && hh.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 34000 + Math.floor(Math.random() * 16000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（最后端口 ${port}）`);
  return {
    port, dataDir, proj, ...ids,
    P: `?project=${encodeURIComponent(proj)}`,
    close: async () => { server.kill('SIGTERM'); await sleep(200); },
  };
}

t('S1 GET /api/build/candidates：候选附 commitMeta（来源与主题）与 broadCommits，既有键保留', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '多提交条目');
    c.markDone(A.id);
    const B = c.mkItem('requirement', '仅宽口径条目');
    c.markDone(B.id);
    const C = c.mkItem('requirement', '末尾归属条目');
    c.markDone(C.id);
    const hashes = [];
    hashes.push(c.commit('a1.txt', `doc: 主提交 ${A.id}`));
    hashes.push(c.commit('a2.txt', `feat: 主提交 ${A.id}`));
    c.commit('b1.txt', `fix: 顺带提及 ${B.id} 的改动 ${C.id}`); // B 中段（宽口径）、C 末尾（归属）
    return { A, B, C, hashes };
  });
  try {
    const r = await req(h.port, 'GET', `/api/build/candidates${h.P}`);
    assert.equal(r.status, 200, `候选接口应 200：${r.text}`);
    const items = r.json.items;
    const a = items.find((x) => x.itemId === h.A.id);
    const b = items.find((x) => x.itemId === h.B.id);
    const cc = items.find((x) => x.itemId === h.C.id);
    assert.ok(Array.isArray(a.commitMeta) && a.commitMeta.length === 2, 'A 的 commitMeta 为自动关联集（2 条）');
    assert.ok(a.commitMeta.every((m) => m.source === 'attribution' && typeof m.subject === 'string'), 'commitMeta 含来源与主题');
    assert.deepEqual(a.commitMeta.map((m) => m.hash), h.hashes, 'commitMeta 旧→新与提交顺序一致');
    assert.ok(Array.isArray(a.broadCommits) && a.broadCommits.length === 0, 'A 无宽口径残留');
    assert.ok(Array.isArray(a.commits) && a.commits.length === 2, '既有 commits 键保留');
    assert.ok('lastCommittedAt' in a, '既有 lastCommittedAt 键保留');
    assert.ok(Array.isArray(b.commitMeta) && b.commitMeta.length === 0, 'B 无自动关联集');
    assert.ok(b.broadCommits.length === 1, 'B 的宽口径命中单独下发');
    assert.ok(cc.commitMeta.length === 1 && cc.broadCommits.length === 0, 'C 末尾单号严格归属');
  } finally { await h.close(); }
});

t('S2 POST /api/build/version：commits 数组整组落盘；空数组与非 40 位元素被拒（既有文案）', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '多提交条目');
    c.markDone(A.id);
    const hashes = [
      c.commit('a1.txt', `doc: 主提交 ${A.id}`),
      c.commit('a2.txt', `feat: 主提交 ${A.id}`),
      c.commit('a3.txt', `test: 回归 ${A.id}`),
    ];
    return { A, hashes };
  });
  try {
    // 整组落盘
    const ok = await req(h.port, 'POST', `/api/build/version${h.P}`, {
      name: '整组关联版本',
      items: [{ itemId: h.A.id, commits: h.hashes }],
    });
    assert.equal(ok.status, 201, `创建应成功：${ok.text}`);
    const ver = ok.json.version;
    assert.equal(ver.items[0].commits.length, 3, '版本条目行 commits 与自动关联整组一致');
    assert.deepEqual(ver.items[0].commits, h.hashes, '三个提交（含 feat 主提交）全部落盘');
    // 空数组允许，但既有条目仍受跨版本占用约束
    const empty = await req(h.port, 'POST', `/api/build/version${h.P}`, { name: 'x', items: [{ itemId: h.A.id, commits: [] }] });
    assert.equal(empty.status, 400, '已占用条目仍被拒绝');
    assert.match(empty.json.error || '', /已纳入/, '同一条目跨版本重复仍被拒绝');
    // 非 40 位元素拒绝
    const bad = await req(h.port, 'POST', `/api/build/version${h.P}`, { name: 'y', items: [{ itemId: h.A.id, commits: ['zz'.repeat(20)] }] });
    assert.equal(bad.status, 400, '非 40 位元素被拒绝');
    assert.match(bad.json.error || '', /缺少有效的关联 commit/, '既有文案口径（非法 hash）');
  } finally { await h.close(); }
});

/* ================= 前端 vm ================= */

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

const H = (n) => String(n).repeat(40);
const HA = H('a');
const HB = H('b');
const HC = H('c');
const HD = H('d');
const R1 = 'REQ-20260927-101'; // 多提交自动关联（回归样本型）
const R2 = 'REQ-20260927-102'; // 仅宽口径（回退）
const R3 = 'REQ-20260927-103'; // 自动集 + 宽口径并存
const R4 = 'REQ-20260927-104'; // 全空（仍可纳入）

// 新候选 payload 形态（服务端 REQ-20260927-002 后下发）
function candidatesPayload() {
  return {
    totalDone: 4,
    items: [
      { itemId: R1, title: '回归样本条目', status: 'done', commits: [HA, HB], lastCommittedAt: null,
        commitMeta: [
          { hash: HA, subject: `doc: 版本计划多对多组版 ${R1}`, source: 'attribution' },
          { hash: HB, subject: `feat: 发布隔离与挑选合并 ${R1}`, source: 'attribution' },
        ],
        broadCommits: [] },
      { itemId: R2, title: '仅宽口径条目', status: 'done', commits: [HC], lastCommittedAt: null,
        commitMeta: [],
        broadCommits: [{ hash: HC, subject: `fix: 顺带提及 ${R2} 的修复` }] },
      { itemId: R3, title: '并存条目', status: 'done', commits: [HA, HD], lastCommittedAt: null,
        commitMeta: [{ hash: HA, subject: `feat: 归属提交 ${R3}`, source: 'ledger' }],
        broadCommits: [{ hash: HD, subject: `chore: 提及 ${R3} 的批量收口` }] },
      { itemId: R4, title: '无提交条目', status: 'done', commits: [], lastCommittedAt: null,
        commitMeta: [], broadCommits: [] },
    ],
  };
}

function panelSetup({ candidates = candidatesPayload(), versions = [] } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const toasts = [];
  const requests = [];
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    toast: (m, isErr) => toasts.push({ m, isErr }),
    fetch: async (url, opts) => {
      const up = new URL(String(url), 'http://local');
      requests.push({ url: up.pathname, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify({ initialized: true, isRepo: true, currentBranch: 'dev', versions })) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => JSON.parse(JSON.stringify(candidates)) };
      if (up.pathname === '/api/build/version') return { ok: true, json: async () => ({ version: { id: 'BLD-NEW' } }) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const inner = () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox);
  const click = (sel) => vm.runInContext(
    `document.querySelector('#buildView').querySelector(${JSON.stringify(sel)}).listeners.click()`, sandbox);
  return { sandbox, toasts, requests, inner, click, run: (code) => vm.runInContext(code, sandbox) };
}

t('F1 创建面板整组自动关联：勾选即展开只读清单（hash+主题+来源徽标），payload 整组、无逐个提交控件', async () => {
  const h = panelSetup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  const panel = h.inner().match(/<aside class="rel-panel"[^>]*aria-label="新建版本">[\s\S]*?<\/aside>/);
  assert.ok(panel, '新建版本面板应渲染');
  h.click('#bldPickAll');
  const after = h.inner();
  assert.match(after, new RegExp(`data-pick="createPanel" data-item="${R1}" checked`), 'R1 勾选');
  assert.match(after, /关联提交（自动关联 2 个 · 旧→新 · 只读）/, '行内展开只读区块头');
  assert.match(after, new RegExp(HA.slice(0, 8)), '短 hash 渲染');
  assert.match(after, /doc: 版本计划多对多组版/, '提交主题渲染');
  assert.match(after, /自动·归属/, '来源徽标（严格归属）');
  assert.doesNotMatch(after, /bld-commit-sel/, '不再渲染逐个提交下拉');
  // 计数：R1(2) + R2(回退 1) + R3(1) = 4，R4 计入条目但贡献 0 个提交
  assert.match(after, /已选 4 项 · 4 个提交/, '操作条计数 = 已选条目自动关联提交数之和（回退计入）');
  // 提交 payload 整组
  h.click('#bldCreateBtn');
  await sleep(10);
  const created = h.requests.find((x) => x.url === '/api/build/version' && x.method === 'POST');
  assert.ok(created, '应发起创建请求');
  assert.deepEqual(created.body.items.find((x) => x.itemId === R4), { itemId: R4, commits: [] }, '创建包含无提交条目');
  const r1 = created.body.items.find((x) => x.itemId === R1);
  assert.deepEqual(r1, { itemId: R1, commits: [HA, HB] }, 'payload 为整组 commits 数组（含 feat 主提交）');
  const r2 = created.body.items.find((x) => x.itemId === R2);
  assert.deepEqual(r2, { itemId: R2, commits: [HC] }, '宽口径回退条目 payload = 最新 1 个提交');
  const r3 = created.body.items.find((x) => x.itemId === R3);
  assert.deepEqual(r3, { itemId: R3, commits: [HA] }, '并存条目 payload 只含自动集');
});

t('F2 自动集为空回退：宽口径命中标「回退·宽口径」徽标，回退提交计入 payload 与计数', async () => {
  const h = panelSetup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  h.click('#bldPickAll');
  const after = h.inner();
  assert.match(after, /回退·宽口径/, '回退来源徽标（颜色+文字双重区分）');
  assert.match(after, new RegExp(HC.slice(0, 8)), '回退提交（宽口径最新 1 个）展示');
  const r3 = h.run(`JSON.stringify(window.ATBBuild.autoAssociationOf(window.ATBBuild.getCandidates().find((x) => x.itemId === ${JSON.stringify(R3)})).map((x) => x.hash))`);
  assert.deepEqual(JSON.parse(r3), [HA], '并存条目自动集只含账本/归属提交（宽口径不混入）');
  const empty = h.run(`JSON.stringify(window.ATBBuild.autoAssociationOf(window.ATBBuild.getCandidates().find((x) => x.itemId === ${JSON.stringify(R4)})).map((x) => x.hash))`);
  assert.deepEqual(JSON.parse(empty), [], '自动集与宽口径皆空 → 无关联');
});

t('F3 宽口径折叠行：只读提示可展开，不可勾选、不计入 M', async () => {
  const h = panelSetup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  h.click('#bldPickAll');
  const after = h.inner();
  assert.match(after, /另有 1 个宽口径命中未关联/, '宽口径折叠行文案（R3 的宽口径命中）');
  // 展开前不显示宽口径提交主题，展开后可见
  assert.doesNotMatch(after, /chore: 提及/, '折叠态不展示宽口径提交');
  const toggle = after.match(/data-broad-toggle="[^"]*" data-item="[^"]*"/);
  assert.ok(toggle, '宽口径折叠行可点击展开');
  // 展开交互经行为接缝（与 data-broad-toggle 点击同一函数）
  h.run(`window.ATBBuild.toggleBroadHits('createPanel', ${JSON.stringify(R3)})`);
  const expanded = h.inner();
  assert.match(expanded, /chore: 提及/, '展开后查看 hash + 主题');
  // 宽口径提交不进入 M 计数（R3 的 M 只含自动集 1 条）
  assert.match(expanded, /已选 4 项 · 4 个提交/, '宽口径命中不计入 M');
});

t('F4 全空条目正常勾选并标注：计入条目数，无跳过提示', async () => {
  const h = panelSetup();
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openCreatePanel()`);
  h.click('#bldPickAll');
  const after = h.inner();
  assert.match(after, new RegExp(`data-pick="createPanel" data-item="${R4}" checked`), '全空条目复选框勾选');
  assert.match(after, /暂无关联提交/, '全空条目标注暂无关联提交');
  assert.ok(!h.toasts.some((x) => x.m.includes('已跳过')), '全选无跳过提示');
  assert.match(after, /已选 4 项 · 4 个提交/, '全空条目计入已选但不计提交数');
  h.click('#bldPickNone');
  assert.match(h.inner(), /已选 0 项 · 0 个提交/, '全不选计数归零');
});

t('F5 两面板一致：添加条目面板同口径（整组 payload、回退与计数一致）', async () => {
  const inVer = 'REQ-20260927-100';
  const versions = [{
    id: 'BLD-20260927-001', name: '既有版本', description: '', status: 'draft', targetBranch: 'main',
    items: [{ itemId: inVer, commit: HA, commits: [HA], title: '已在版本', mergedAt: null, mergeError: null }],
    createdAt: '2026-09-27T01:00:00.000Z', updatedAt: '2026-09-27T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
  }];
  const h = panelSetup({ versions });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.openAddPanel()`);
  assert.doesNotMatch(h.inner(), new RegExp(`data-pick="addPanel" data-item="${inVer}"`), '已在本版本的条目不出现（候选复选框）');
  h.click('#bldPickAll');
  const after = h.inner();
  assert.match(after, new RegExp(`data-pick="addPanel" data-item="${R1}" checked`), '添加面板勾选');
  assert.match(after, /关联提交（自动关联 2 个 · 旧→新 · 只读）/, '添加面板行内展开只读区块');
  assert.match(after, /已选 4 项 · 4 个提交/, '添加面板计数同口径');
  h.click('#bldAddSubmit');
  await sleep(10);
  const added = h.requests.find((x) => x.url === '/api/build/version/items' && x.method === 'POST');
  assert.ok(added, '应发起添加条目请求');
  assert.deepEqual(added.body.items.find((x) => x.itemId === R4), { itemId: R4, commits: [] }, '追加包含无提交条目');
  const r1 = added.body.items.find((x) => x.itemId === R1);
  assert.deepEqual(r1, { itemId: R1, commits: [HA, HB] }, '添加面板 payload 同为整组 commits 数组');
});

/* ================= i18n ================= */

t('I1 i18n：新增文案 EN / EN_DYNAMIC 词条同步且动态键可编译', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  // 静态词条：来源徽标（颜色+文字双重区分的文案部分）
  assert.equal(EN['自动·账本'], 'Auto · ledger');
  assert.equal(EN['自动·归属'], 'Auto · attribution');
  assert.equal(EN['回退·宽口径'], 'Fallback · broad-match');
  // 动态词条（插值）
  assert.ok(EN_DYNAMIC['关联提交（自动关联 ◇ 个 · 旧→新 · 只读）'], '只读区块头动态词条');
  assert.ok(EN_DYNAMIC['另有 ◇ 个宽口径命中未关联'], '宽口径折叠行动态词条');
  assert.ok(EN_DYNAMIC['已选 ◇ 项 · ◇ 个提交'], '操作条计数动态词条');
  I.setLang('en');
  try {
    assert.equal(I.t('暂无关联提交（仍可纳入版本）'), 'No linked commits (can still be included in this version)');
    assert.equal(I.t('暂无关联提交'), 'No linked commits');
    assert.equal(I.t('自动·账本'), 'Auto · ledger', '静态查词命中');
    assert.equal(I.t('另有 2 个宽口径命中未关联'), 'Another 2 broad-match commit(s) not linked', '动态查词命中');
    assert.equal(I.t('已选 4 项 · 4 个提交'), '4 selected · 4 commits', '计数动态查词命中（长键优先，不被「已选 ◇ 项」抢先）');
    assert.equal(I.t('关联提交（自动关联 2 个 · 旧→新 · 只读）'), 'Linked commits (2 auto-linked · old → new · read-only)', '区块头动态查词命中');
  } finally { I.setLang('zh'); }
});

/* ================= 执行 ================= */

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
