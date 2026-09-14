#!/usr/bin/env node
// BUG-20260909-006 已计划列表「进入批量开发」移除 —— 后端回归测试
// 覆盖：S1/S2 createBatch({ids}) 指定集合冻结（语义收敛为 REQ-20260908-026 单条目重试的显式范围）；
//       S3 /api/batch/current 不再按 ?ids= 过滤统计；创建接口透传 ids 仍可用；
//       S4 /api/dispatch/scope 路由已删除；S5 调度器无范围机件（无 setScope / status.scope / scope-empty）
// 用法：node scripts/tests/impl-scope.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as store from '../lib/dispatch-store.mjs';
import { createScheduler, createHub } from '../lib/scheduler.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');
const FIXTURE = path.join(PLUGIN_ROOT, 'scripts', 'tests', 'fixtures', 'fake-codex.mjs');
const ATB = path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs = 15_000, label = '') {
  const start = Date.now();
  for (;;) {
    if (await cond()) return true;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`);
    await sleep(30);
  }
}

// ---------- lib 层脚手架 ----------

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-impl-')));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  return { root, dataDir };
}

function backdate(dataDir, id, deltaMs) {
  const { dir } = core.resolveItemDir(dataDir, id);
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  st.createdAt = new Date(Date.parse(st.createdAt) - deltaMs).toISOString();
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(st, null, 2) + '\n');
}

function mkItem(p, type, title, { accept = true, backMs = 0 } = {}) {
  const st = core.createItem(p.dataDir, { type, title, description: 'x', by: 'tester' });
  // REQ-20260908-010：选单口径 planned（已计划），接受后默认置计划
  if (accept) {
    core.setStatus(p.dataDir, st.id, 'accepted', { by: 'tester' });
    core.setStatus(p.dataDir, st.id, 'planned', { by: 'tester' });
  }
  if (backMs) backdate(p.dataDir, st.id, backMs);
  return st.id;
}

function forceClaim(p, id, owner) {
  const { dir } = core.resolveItemDir(p.dataDir, id);
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  st.status = 'in-progress';
  st.owner = owner;
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(st, null, 2) + '\n');
}

const cleanup = (p) => { try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {} };

// ---------- HTTP 层脚手架 ----------

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      let data = '';
      rs.on('data', (c) => { data += c; });
      rs.on('end', () => {
        try { resolve({ status: rs.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: rs.statusCode, json: null }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

async function startServer() {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const registry = path.join(os.tmpdir(), `atb-registry-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: registry },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); return { port, child }; } catch {}
  }
  child.kill('SIGKILL');
  throw new Error('服务未启动');
}

// ---------- 调度层脚手架（沿用 scheduler.test.mjs 的假 CLI 形态） ----------

let spawnCount = 0;

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-scope-'));
  core.initData(root);
  return root;
}

function mkScheduler(root, mode, opts = {}) {
  const dataDir = core.requireDataDir(root);
  spawnCount = 0;
  return createScheduler({
    projectRoot: root,
    dataDir,
    hub: opts.hub || createHub(),
    atbCliPath: ATB,
    cli: {
      path: opts.cliPath || process.execPath,
      spawnArgs: [FIXTURE],
      envForRun: (run) => {
        spawnCount++;
        return { FAKE_MODE: mode, FAKE_ATB_CLI: ATB, FAKE_ITEM_ID: run.itemId };
      },
    },
    tickMs: opts.tickMs ?? 40,
    backoffs: [60, 90],
    cancelGraceMs: 250,
    settleMs: 120,
    maxResumeRounds: 2,
    timeoutMs: 60_000,
  });
}

async function waitReported(s, d, runId) {
  await waitFor(() => ['reported', 'failed', 'blocked', 'interrupted'].includes(store.getRun(d, runId).phase), 15_000, `run ${runId} 收尾`);
  assert.equal(store.getRun(d, runId).phase, 'reported', 'worker-ok 模式应正常上报');
}

// ---------- S1/S2：createBatch 指定集合（REQ-20260908-026 单条目重试依赖的显式范围） ----------

t('S1 createBatch({ids})：候选=指定集合且保持规范排序，未指定条目不入批', () => {
  const p = mkProject();
  try {
    const reqOld = mkItem(p, 'requirement', '较早需求', { backMs: 3000 });
    // BUG-20260908-007：reqNew 与 bug 背靠背创建常落在同一毫秒，id 决胜（BUG<REQ）会翻转规范序；
    // 给 reqNew 加 backMs 50 保证 reqOld(-3000) < reqNew(-50) < bug(0) 全序确定，断言语义不变
    const reqNew = mkItem(p, 'requirement', '较新需求', { backMs: 50 });
    const bug = mkItem(p, 'bug', 'Bug');
    mkItem(p, 'requirement', '未接受', { accept: false });

    const { batch: b } = batch.createBatch(p.dataDir, { ids: [bug, reqNew], projectRoot: p.root });
    assert.deepEqual(b.candidates, [reqNew, bug], '候选应为指定集合，按 需求→bug 规范序');
    const { batch: full } = batch.createBatch(p.dataDir, { projectRoot: p.root, mode: 'codex' });
    assert.equal(full.candidates.length, 3, '未指定 ids 时仍为全部候选（默认范围）');
  } finally { cleanup(p); }
});

t('S2 createBatch({ids})：认领剔除、空集报错、指定集合全量入批（REQ-20260908-019 起无上限截断）', () => {
  const p = mkProject();
  try {
    const reqOld = mkItem(p, 'requirement', '较早需求', { backMs: 3000 });
    const reqNew = mkItem(p, 'requirement', '较新需求');
    const bug = mkItem(p, 'bug', 'Bug');

    forceClaim(p, reqNew, 'zcode-other');
    // 空集/非法入参报错须在任何批次创建之前验证：未结束批次的幂等返回会短路后续校验
    assert.throws(
      () => batch.createBatch(p.dataDir, { ids: [reqNew], projectRoot: p.root }),
      /均不可入批/,
      '勾选集合过滤后为空应给明确错误',
    );
    assert.throws(
      () => batch.createBatch(p.dataDir, { ids: 'REQ-x', projectRoot: p.root }),
      /ids 必须是编号数组/,
      '非法 ids 类型应报错',
    );

    const { batch: b1 } = batch.createBatch(p.dataDir, { ids: [reqNew, bug], projectRoot: p.root });
    assert.deepEqual(b1.candidates, [bug], '已被认领的指定项应剔除');
    assert.equal('limit' in b1, false, '批次记录不再写 limit 字段');

    const { batch: b2 } = batch.createBatch(p.dataDir, { ids: [reqOld, reqNew, bug], projectRoot: p.root, mode: 'codex' });
    assert.equal(b2.mode, 'codex');
    assert.deepEqual(b2.candidates, [reqOld, bug], '指定集合全量入批（无截断），未指定条目不入批');
  } finally { cleanup(p); }
});

// ---------- S3/S4：HTTP 层 ----------

t('S3 /api/batch/current：不再按 ?ids= 过滤统计（BUG-20260909-006）；创建接口透传 ids 仍可用（单条目重试）', async () => {
  const p = mkProject();
  const srv = await startServer();
  try {
    const A = mkItem(p, 'requirement', '甲');
    const B = mkItem(p, 'requirement', '乙');
    const C = mkItem(p, 'bug', '丙');
    // B 依赖 A（A 未验收 → B 受阻）
    batch.setDependencies(p.dataDir, B, [A]);
    const P = `?project=${encodeURIComponent(p.root)}`;

    let r = await req(srv.port, 'GET', `/api/batch/current${P}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.stats, { candidates: 3, blocked: 1 }, '默认全量口径');

    // 残留的 ids 查询参数被忽略：统计始终为已计划队列全量口径
    r = await req(srv.port, 'GET', `/api/batch/current${P}&ids=${A},${B}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.stats, { candidates: 3, blocked: 1 }, 'ids 参数不再过滤统计（口径唯一化为已计划队列）');

    // 创建接口的显式 ids（REQ-20260908-026 单条目重试路径）保持可用
    r = await req(srv.port, 'POST', `/api/batch/create${P}`, { ids: [C, A] });
    assert.equal(r.status, 200);
    assert.equal(r.json.counts.candidates, 2, '显式 ids 创建批次候选应为指定集合');
    const b = batch.getBatch(p.dataDir, r.json.batchId);
    assert.deepEqual(b.candidates, [A, C], '冻结清单=指定集合（规范序）');
  } finally {
    srv.child.kill('SIGTERM');
    cleanup(p);
  }
});

t('S4 /api/dispatch/scope：路由已随勾选范围机制删除（404）；status 不含 scope 字段', async () => {
  const p = mkProject();
  const srv = await startServer();
  try {
    mkItem(p, 'requirement', '甲');
    const P = `?project=${encodeURIComponent(p.root)}`;

    const r = await req(srv.port, 'POST', `/api/dispatch/scope${P}`, { ids: ['REQ-20990101-001'] });
    assert.equal(r.status, 404, '范围推送路由应已删除（前端无触发方，机制整体移除）');

    const st = await req(srv.port, 'GET', `/api/dispatch/status${P}`);
    assert.equal(st.status, 200);
    assert.equal('scope' in st.json, false, 'status 响应不得再暴露 scope 字段');
  } finally {
    srv.child.kill('SIGTERM');
    cleanup(p);
  }
});

// ---------- S5：调度器无范围机件 ----------

t('S5 调度器：无 setScope/scope 机件；开启后按最旧优先领取全部已计划（口径唯一化回归）', async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const mk = (type, title, backMs = 0) => {
    const st = core.createItem(d, { type, title, by: 't' });
    core.setStatus(d, st.id, 'accepted', { by: 'h' });
    core.setStatus(d, st.id, 'planned', { by: 'h' }); // REQ-20260908-010：选单口径 planned
    if (backMs) {
      const { dir } = core.resolveItemDir(d, st.id);
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
      j.createdAt = new Date(Date.parse(j.createdAt) - backMs).toISOString();
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(j, null, 2) + '\n');
    }
    return st.id;
  };
  const A = mk('requirement', '甲', 3000);
  mk('requirement', '乙');
  const s = mkScheduler(root, 'worker-ok');
  try {
    assert.equal(typeof s.setScope, 'undefined', 'setScope 应随范围机制删除');
    assert.equal('scope' in s.status(), false, 'status 不得再含 scope 字段');
    assert.equal(s.status().waiting.kind, 'disabled');
    s.enable();
    await waitFor(() => store.listRuns(d).total >= 1);
    assert.equal(store.listRuns(d).items[0].itemId, A, '无范围过滤，按最旧优先领取甲');
    await waitReported(s, d, store.listRuns(d).items[0].runId);
  } finally {
    // 只停调度（沿用 scheduler.test.mjs 惯例）：残留假 CLI 子进程可能异步回写日志，
    // 立即 rmSync 临时目录会与 stderr 回调竞态导致用例全过后进程仍崩
    s.stop();
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
