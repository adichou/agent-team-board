#!/usr/bin/env node
// REQ-20260907-013 执行中可创建新批次（UI 入口）+ 未在执行的批次可删除
// 覆盖：C1 在途运行中创建排队回归 / D1 删排队批 / D2 在途拒绝 / D3 needs_attention 拒绝 /
//       D4 finished 可删与不存在报错 / D5 删队首防抢解除 / D6 serve 删除接口 /
//       D7 CLI batch delete / D8 UI 静态契约
// 用法：node scripts/tests/batch-delete.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- core 脚手架（与 batch-queue.test.mjs 同款） ----------

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bdel-')));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  return { root, dataDir };
}

function mkItem(p, title, { accept = true, backMs = 0 } = {}) {
  const st = core.createItem(p.dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  // REQ-20260908-010：选单口径 planned（已计划），接受后默认置计划
  if (accept) {
    core.setStatus(p.dataDir, st.id, 'accepted', { by: 'tester' });
    core.setStatus(p.dataDir, st.id, 'planned', { by: 'tester' });
  }
  if (backMs) {
    const { dir } = core.resolveItemDir(p.dataDir, st.id);
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    s.createdAt = new Date(Date.parse(s.createdAt) - backMs).toISOString();
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(s, null, 2) + '\n');
  }
  return st.id;
}

function cleanup(p) {
  try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
}

const W1 = 'zcode-del-w1';

function runOneItem(p, batchId, owner = W1) {
  const run = batch.nextItem(p.dataDir, batchId, { owner });
  if (run.stop) return run;
  core.claim(p.dataDir, run.itemId, owner);
  core.report(p.dataDir, run.itemId, { summary: 'ok', by: owner, run: { runId: run.runId } });
  batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
  return run;
}

const batchDirOf = (p, batchId) => path.join(p.dataDir, 'dispatch', 'batches', batchId);

// ---------- C1 执行中创建（回归） ----------

t('C1 core：批次有在途运行时重复启动被拒（REQ-20260913-003 不排队）', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 2000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, rA.batch.batchId, { owner: W1 }); // A 在途（预留未收尾）
    assert.equal(run.itemId, a1);

    mkItem(p, 'B1', { backMs: 1000 }); // 运行中新接受（实时队列归本轮，不再另建）
    const before = batch.listBatches(p.dataDir).length;
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /已有进行中的任务/, '在途运行中不得再启动');
    assert.equal(batch.listBatches(p.dataDir).length, before, '拒绝路径不产生新账本对象');

    core.claim(p.dataDir, a1, W1);
    core.report(p.dataDir, a1, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    const ck = batch.checkBatch(p.dataDir, rA.batch.batchId);
    assert.equal('nextBatch' in ck, false, '收尾不再携带排队接续');
  } finally { cleanup(p); }
});

// ---------- D1 删除排队批次 ----------

t('D1 core：删除排队中（未执行）的存量账本——目录移除、未结束队列缩短', () => {
  const p = mkProject();
  try {
    mkItem(p, 'A1', { backMs: 3000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    // REQ-20260913-003：不再排队——手工构造升级前的后位排队账本（CLI 处理存量数据的路径）
    const rB = { batchId: 'batch-20990101-099' };
    const raw = batch.getBatch(p.dataDir, rA.batch.batchId);
    const dirB = path.join(p.dataDir, 'dispatch', 'batches', rB.batchId);
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'batch.json'), JSON.stringify({
      ...raw, batchId: rB.batchId, createdAt: '2099-01-02T00:00:00.000Z', status: 'prepared', currentRunId: null,
    }));

    const r = batch.deleteBatch(p.dataDir, rB.batchId);
    assert.equal(r.ok, true);
    assert.equal(r.batchId, rB.batchId);
    assert.equal(fs.existsSync(batchDirOf(p, rB.batchId)), false, '批次账本目录应移除');
    assert.equal(fs.existsSync(batchDirOf(p, rA.batch.batchId)), true, '其余批次目录不受影响');
    assert.deepEqual(
      batch.unfinishedBatches(p.dataDir).map((b) => b.batchId),
      [rA.batch.batchId],
      '删除后未结束队列只剩 A',
    );
  } finally { cleanup(p); }
});

// ---------- D2 在途拒绝 ----------

t('D2 core：删除有在途运行的批次被拒绝（错误含 runId）；收尾后可删', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 2000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, rA.batch.batchId, { owner: W1 }); // 在途（预留未收尾）
    assert.throws(() => batch.deleteBatch(p.dataDir, rA.batch.batchId), /正在执行|在途/);
    try {
      batch.deleteBatch(p.dataDir, rA.batch.batchId);
      assert.fail('应抛错');
    } catch (e) {
      assert.ok(e.message.includes(run.runId), '错误应指明在途 runId');
    }
    assert.equal(fs.existsSync(batchDirOf(p, rA.batch.batchId)), true, '拒绝时目录不动');

    // 完整收尾后（reported → finished）允许删除
    core.claim(p.dataDir, a1, W1);
    core.report(p.dataDir, a1, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    batch.checkBatch(p.dataDir, rA.batch.batchId); // 置 finished
    const r = batch.deleteBatch(p.dataDir, rA.batch.batchId);
    assert.equal(r.ok, true);
    assert.equal(
      fs.existsSync(path.join(p.dataDir, 'dispatch', 'runs', run.runId, 'run.json')),
      true,
      '删除批次不移除 runs/ 运行记录',
    );
  } finally { cleanup(p); }
});

// ---------- D3 needs_attention 拒绝 ----------

t('D3 core：删除 needs_attention 批次被拒绝（提示先人工核对恢复）', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 1000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, rA.batch.batchId, { owner: W1 });
    core.claim(p.dataDir, a1, W1);
    core.report(p.dataDir, a1, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'failed', reason: '环境错误', safeToContinue: false });
    assert.equal(batch.getBatch(p.dataDir, rA.batch.batchId).status, 'needs_attention');
    assert.throws(() => batch.deleteBatch(p.dataDir, rA.batch.batchId), /人工核对|needs_attention/);
  } finally { cleanup(p); }
});

// ---------- D4 finished 可删 / 不存在报错 ----------

t('D4 core：删除已结束（finished）批次成功；删除不存在批次报「找不到批次」', () => {
  const p = mkProject();
  try {
    mkItem(p, 'A1', { backMs: 1000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    runOneItem(p, rA.batch.batchId);
    const ck = batch.checkBatch(p.dataDir, rA.batch.batchId);
    assert.equal(ck.nextAction, 'stop');
    assert.equal(batch.getBatch(p.dataDir, rA.batch.batchId).status, 'finished');

    const r = batch.deleteBatch(p.dataDir, rA.batch.batchId);
    assert.equal(r.ok, true);
    assert.equal(fs.existsSync(batchDirOf(p, rA.batch.batchId)), false);

    assert.throws(() => batch.deleteBatch(p.dataDir, 'batch-20990909-999'), /找不到批次/);
  } finally { cleanup(p); }
});

// ---------- D5 删队首：防抢解除 ----------

t('D5 core：删除队首未执行账本后，存量后位账本成为队首且 nextItem 可直接领取', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 3000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root }); // A 队首
    const b1 = mkItem(p, 'B1', { backMs: 1000 });
    // 手工构造升级前的后位排队账本（candidates 冻结 B1 的存量形态）
    const rB = { batchId: 'batch-20990101-098' };
    const raw = batch.getBatch(p.dataDir, rA.batch.batchId);
    const dirB = path.join(p.dataDir, 'dispatch', 'batches', rB.batchId);
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'batch.json'), JSON.stringify({
      ...raw, batchId: rB.batchId, createdAt: '2099-01-02T00:00:00.000Z', status: 'prepared', currentRunId: null, candidates: [b1],
    }));
    // 后位账本被队首 A 防抢阻塞
    assert.throws(() => batch.nextItem(p.dataDir, rB.batchId, { owner: W1 }), /排队中/);

    const r = batch.deleteBatch(p.dataDir, rA.batch.batchId);
    assert.equal(r.ok, true);
    assert.equal(batch.queueHeadBatch(p.dataDir).batchId, rB.batchId, '后位账本应成为队首');
    const run = batch.nextItem(p.dataDir, rB.batchId, { owner: W1 });
    assert.equal(run.itemId, b1, '删除队首后可直接领取');
    core.claim(p.dataDir, b1, W1);
    core.report(p.dataDir, b1, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
  } finally { cleanup(p); }
});

// ---------- CLI / serve 脚手架 ----------

const runAtb = (args, cwd, timeoutMs = 20000) => new Promise((resolve) => {
  const proc = spawn(process.execPath, [atb, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  proc.stdout.on('data', (c) => { out += c; });
  proc.stderr.on('data', (c) => { err += c; });
  const timer = setTimeout(() => { proc.kill(); resolve({ code: 124, out, err }); }, timeoutMs);
  proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});

async function runAtbJson(args, cwd) {
  const r = await runAtb([...args, '--json'], cwd);
  if (r.code !== 0) throw new Error(`atb ${args.join(' ')} 失败：${r.err || r.out}`);
  return JSON.parse(r.out);
}

function httpReq(port, method, pathname, body) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mkCliProject(n) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bdel-cli-')));
  assert.equal((await runAtb(['init'], root)).code, 0);
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const r = await runAtb(['new', 'req', `删除条目-${i}`], root);
    const m = r.out.match(/(REQ-\d{8}-\d{3})/);
    ids.push(m[1]);
  }
  for (const id of ids) {
    assert.equal((await runAtb(['status', id, 'accepted'], root)).code, 0);
    assert.equal((await runAtb(['status', id, 'planned'], root)).code, 0); // REQ-20260908-010：选单口径 planned
  }
  return { root, ids };
}

async function acceptNew(root, title) {
  const r = await runAtb(['new', 'req', title], root);
  const m = r.out.match(/(REQ-\d{8}-\d{3})/);
  assert.ok(m, `应输出单号：${r.out}`);
  assert.equal((await runAtb(['status', m[1], 'accepted'], root)).code, 0);
  assert.equal((await runAtb(['status', m[1], 'planned'], root)).code, 0); // REQ-20260908-010：选单口径 planned
  return m[1];
}


// 读取项目当前队首账本号（创建响应不再透出批次号后的测试辅助）
function batchHeadOf(p) {
  const dir = path.join(p.root, 'docs', 'agent-team-board', 'dispatch', 'batches');
  const ids = fs.readdirSync(dir).sort();
  for (const id of ids) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, id, 'batch.json'), 'utf8'));
      if (j.status !== 'finished') return id;
    } catch {}
  }
  return ids[ids.length - 1];
}

// ---------- D6 serve：删除接口 ----------

t('D6 serve：/api/batch/delete 删除未执行账本成功；重复启动 400；在途/不存在 400', async () => {
  const p = await mkCliProject(2);
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: p.root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(p.root, '.reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `project=${encodeURIComponent(p.root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await httpReq(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    const cA = await httpReq(port, 'POST', `/api/batch/create?${P}`, {});
    assert.equal(cA.status, 200);
    assert.equal('batchId' in cA.json, false, '创建响应不再透出批次号（REQ-20260913-003）');
    const headA = batchHeadOf(p);

    // REQ-20260913-003：未结束轮内重复启动 400（不排队）
    await acceptNew(p.root, '重复启动追加条目');
    const cB = await httpReq(port, 'POST', `/api/batch/create?${P}`, {});
    assert.equal(cB.status, 400, '重复启动应被拒');
    assert.match(String(cB.json && cB.json.error || ''), /已有进行中的任务/);

    const del = await httpReq(port, 'POST', `/api/batch/delete?${P}`, { batchId: headA });
    assert.equal(del.status, 200);
    assert.equal(del.json.ok, true);
    assert.equal(del.json.batchId, headA);

    const cur = await httpReq(port, 'GET', `/api/batch/current?${P}`);
    assert.equal(cur.status, 200);
    assert.equal('queue' in cur.json, false, 'current 不再携带排队列表');
    assert.equal(cur.json.batch, null, '删除后无未结束轮（回到启动区）');

    // 新一轮预留在途运行后删除应 400
    const cC = await httpReq(port, 'POST', `/api/batch/create?${P}`, {});
    assert.equal(cC.status, 200, '删除后可再启动');
    const headC = batchHeadOf(p);
    const next = await runAtbJson(['batch', 'next', '--batch', headC, '--by', 'zcode-del-cli-w1'], p.root);
    assert.ok(next.runId, '应预留成功');
    const delA = await httpReq(port, 'POST', `/api/batch/delete?${P}`, { batchId: headC });
    assert.equal(delA.status, 400, '在途批次删除应 400');
    assert.match(delA.json.error, /正在执行|在途/, '错误应说明在途执行');

    const delNone = await httpReq(port, 'POST', `/api/batch/delete?${P}`, { batchId: 'batch-20990909-999' });
    assert.equal(delNone.status, 400);
    assert.match(delNone.json.error, /找不到批次/);
  } finally {
    server.kill();
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- D7 CLI：batch delete ----------

t('D7 cli：batch delete 删除未执行账本成功；在途批次与缺参报错；needs_attention 拒绝', async () => {
  const p = await mkCliProject(1);
  try {
    const cA = await runAtbJson(['batch', 'create'], p.root);
    const aId = cA.batchId;

    // 位置参数删除：成功且提示（未执行账本可删）
    const delA0 = await runAtb(['batch', 'delete', aId], p.root);
    assert.equal(delA0.code, 0);
    assert.match(delA0.out, new RegExp(`已删除批次 ${aId}`));

    // 重新启动一轮（删除后候选仍在）
    const cB = await runAtbJson(['batch', 'create'], p.root);
    const bId = cB.batchId;
    // --json 删除：结构化输出
    const delC = await runAtbJson(['batch', 'delete', '--batch', bId], p.root);
    assert.equal(delC.ok, true);

    // 再启动一轮供后续断言
    const cD = await runAtbJson(['batch', 'create'], p.root);
    const dId = cD.batchId;

    // 缺批次号：用法报错
    const noArg = await runAtb(['batch', 'delete'], p.root);
    assert.notEqual(noArg.code, 0);
    assert.match(noArg.out + noArg.err, /批次号|用法/);

    // 预留在途运行：删除被拒
    const next = await runAtbJson(['batch', 'next', '--batch', dId, '--by', 'zcode-del-cli-w2'], p.root);
    assert.ok(next.runId);
    const delA = await runAtb(['batch', 'delete', dId], p.root);
    assert.notEqual(delA.code, 0, '在途批次删除应失败');
    assert.match(delA.out + delA.err, /正在执行|在途/);

    // needs_attention：失败回执不释放占用 → 删除被拒（提示人工核对）
    assert.equal((await runAtb(['claim', next.itemId, '--by', 'zcode-del-cli-w2'], p.root)).code, 0);
    assert.equal((await runAtb(['report', next.itemId, '--summary', 'ok', '--by', 'zcode-del-cli-w2', '--run', next.runId], p.root)).code, 0);
    await runAtbJson(['run', 'receipt', next.runId, '--result', 'failed', '--reason', '环境错误', '--no-safe-to-continue'], p.root);
    const delNa = await runAtb(['batch', 'delete', dId], p.root);
    assert.notEqual(delNa.code, 0, 'needs_attention 批次删除应失败');
    assert.match(delNa.out + delNa.err, /人工核对|needs_attention/);
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- D8 UI 静态契约 ----------

t('D8 ui：排队/删除入口已随批次排队概念移除（REQ-20260913-003）', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  for (const w of ['queueNewBatch', 'data-del-batch', 'deleteBatchById', '排队新批次', '删除本批次']) {
    assert.ok(!js.includes(w), `app.js 不得残留「${w}」入口`);
  }
  // 服务端删除路由保留（CLI 处理存量账本），但前端不再调用
  assert.ok(!js.includes('/api/batch/delete'), '前端不再调用删除接口');
});

// ---------- 运行 ----------

let failed = 0;
const only = process.argv[2];
for (const [name, fn] of cases) {
  if (only && !name.startsWith(only)) continue;
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
