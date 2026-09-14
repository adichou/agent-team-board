#!/usr/bin/env node
// REQ-20260906-025 批次排队 —— 执行中可继续创建新批次，结束后自动接续下一批
// 覆盖：Q1 入队冻结 / Q2 队尾幂等与候选变化再排队 / Q3 无排队不回归 /
//       Q4 队首解析与防抢 / Q5 check 自动接续 / Q6 提示词接续说明 /
//       Q7 旧空批收尾推广 / Q8 serve 队列接口 / Q9 CLI 输出 / Q10 UI 静态契约
// 用法：node scripts/tests/batch-queue.test.mjs

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

// ---------- core 脚手架：临时项目（与 batch-core.test.mjs 同款） ----------

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bqueue-')));
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

const W1 = 'zcode-queue-w1';

// 完整流转：领取 → 认领 → 上报 → 回执（released 后 impl 互斥随之释放）
function runOneItem(p, batchId, owner = W1) {
  const run = batch.nextItem(p.dataDir, batchId, { owner });
  if (run.stop) return run;
  core.claim(p.dataDir, run.itemId, owner);
  core.report(p.dataDir, run.itemId, { summary: 'ok', by: owner, run: { runId: run.runId } });
  batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
  return run;
}

// ---------- Q1 入队：A 未结束时创建 B ----------

t('Q1 执行中可创建新批次入队：B 冻结当时候选、FIFO 排在 A 后，A 不受影响', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 3000 });
    const a2 = mkItem(p, 'A2', { backMs: 2000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(rA.created, '首个批次应 created=true');
    assert.ok(!rA.queued, '无前序未结束批次时不应标记 queued');

    const b1 = mkItem(p, 'B1', { backMs: 1000 });
    const rB = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(rB.created, true, 'A 未结束时创建 B 应新建（不再幂等返回 A）');
    assert.equal(rB.queued, true, 'B 应标记 queued=true');
    assert.equal(rB.queuePosition, 2, 'B 应排在第 2 位');
    assert.deepEqual(rB.batch.candidates, [b1], 'B 只冻结创建时点的新候选');
    assert.deepEqual(rA.batch.candidates, [a1, a2], 'A 候选不受 B 入队影响');

    const head = batch.queueHeadBatch(p.dataDir);
    assert.equal(head.batchId, rA.batch.batchId, '队首应为最早的 A');
  } finally { cleanup(p); }
});

// ---------- Q2 队尾幂等与候选变化 ----------

t('Q2 队尾幂等：候选一致重复创建返回同批（queued=true）；候选变化允许再排 C（FIFO A→B→C）', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 3000 });
    mkItem(p, 'A2', { backMs: 2000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root }); // A 冻结 {A1,A2}
    const b1 = mkItem(p, 'B1', { backMs: 1000 }); // A 创建后新接受
    const rB = batch.createBatch(p.dataDir, { projectRoot: p.root }); // B 冻结 {B1}
    assert.equal(rB.created, true);

    const again = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(again.created, false, '队尾候选一致应幂等返回，不重复入队');
    assert.equal(again.batch.batchId, rB.batch.batchId, '幂等应返回队尾批次 B');
    assert.equal(again.queued, true, '幂等返回的 B 仍是排队批次');
    assert.equal(again.queuePosition, 2, 'B 位次不变');

    // 队尾候选变化（新接受条目）→ 不命中幂等，新建 C 排队尾
    const c1 = mkItem(p, 'C1');
    const rC = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(rC.created, true, '候选变化时应新建 C');
    assert.equal(rC.queued, true);
    assert.equal(rC.queuePosition, 3, 'C 应排在第 3 位');
    assert.deepEqual(rC.batch.candidates, [c1]);

    const order = batch.unfinishedBatches(p.dataDir).map((b) => b.batchId);
    assert.deepEqual(order, [rA.batch.batchId, rB.batch.batchId, rC.batch.batchId], '队列序 = 创建时间 FIFO');

    // 全部候选被前序批次占住：再次全量创建幂等返回队尾 C，不建空批也不误报
    const onceMore = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(onceMore.created, false, '无新候选且队尾一致时幂等返回队尾');
    assert.equal(onceMore.batch.batchId, rC.batch.batchId);
    // 勾选已入前序批次的条目（ids 与队尾快照不一致且无新候选）→ 明确报错
    assert.throws(
      () => batch.createBatch(p.dataDir, { ids: [a1], projectRoot: p.root }),
      /没有新的可实施候选/,
    );
  } finally { cleanup(p); }
});

// ---------- Q3 无排队不回归 ----------

t('Q3 无排队不回归：全结束后创建立即成为队首；batchSummary 缺省回退最新（已结束）批次', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 1000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    runOneItem(p, rA.batch.batchId); // 唯一条目上报收尾
    const ck = batch.checkBatch(p.dataDir, rA.batch.batchId);
    assert.equal(ck.nextAction, 'stop', 'A 应已收尾');
    assert.equal(ck.nextBatch, undefined, '无排队批次时 stop 不带 nextBatch');

    const mk = mkItem(p, '新条目');
    const rB = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(rB.created, true);
    assert.ok(!rB.queued, '无前序未结束批次不应 queued');
    assert.equal(rB.queuePosition, 1, 'B 立即成为队首');

    runOneItem(p, rB.batch.batchId);
    const s = batch.batchSummary(p.dataDir); // 不带 batchId
    assert.equal(s.batch.batchId, rB.batch.batchId, '全结束时段缺省摘要回退最新批次');
    assert.ok(mk);
  } finally { cleanup(p); }
});

// ---------- Q4 队首解析与防抢 ----------

t('Q4 防抢：前序未结束时 nextItem(B) 拒绝；A 收尾后 B 可正常领取', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 2000 });
    const b1 = mkItem(p, 'B1', { accept: false, backMs: 1000 }); // 先占位，A 冻结后才接受
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root }); // A 冻结 {A1}
    core.setStatus(p.dataDir, b1, 'accepted', { by: 'tester' });
    core.setStatus(p.dataDir, b1, 'planned', { by: 'tester' });
    const rB = batch.createBatch(p.dataDir, { projectRoot: p.root }); // B 冻结 {B1}
    assert.equal(rB.created, true, 'B 应新建入队');

    assert.throws(
      () => batch.nextItem(p.dataDir, rB.batch.batchId, { owner: W1 }),
      new RegExp(`排队中.*${rA.batch.batchId}`),
      'B 抢先领取应被拒并指明前序批次',
    );

    // A 指定领取 → 上报收尾（B 全程不被领取）
    runOneItem(p, rA.batch.batchId);
    assert.equal(core.readStatus(core.resolveItemDir(p.dataDir, b1).dir).status, 'planned', 'A 结束前 B 的条目不被领取');

    const runB = batch.nextItem(p.dataDir, rB.batch.batchId, { owner: W1 });
    assert.equal(runB.itemId, b1, 'A 收尾后 B 可正常领取');
    core.claim(p.dataDir, b1, W1);
    core.report(p.dataDir, b1, { summary: 'ok', by: W1, run: { runId: runB.runId } });
    batch.finishRun(p.dataDir, runB.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.equal(a1, a1);
  } finally { cleanup(p); }
});

// ---------- Q5 check 自动接续 ----------

t('Q5 自动接续：A 收尾 stop 携带 nextBatch=B；暂停 stop 不带；check 响应仍 ≤2KiB', () => {
  const p = mkProject();
  try {
    mkItem(p, 'A1', { backMs: 2000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root }); // A 冻结 {A1}
    const b1 = mkItem(p, 'B1', { backMs: 1000 }); // A 创建后新接受
    const rB = batch.createBatch(p.dataDir, { projectRoot: p.root }); // B 冻结 {B1}
    assert.equal(rB.created, true);

    // A 暂停中：stop（pauseRequested）不带 nextBatch，人工意图优先
    batch.pauseBatch(p.dataDir, rA.batch.batchId, true);
    const paused = batch.checkBatch(p.dataDir, rA.batch.batchId);
    assert.equal(paused.nextAction, 'stop');
    assert.equal(paused.nextBatch, undefined, '暂停 stop 不带 nextBatch');
    batch.pauseBatch(p.dataDir, rA.batch.batchId, false);

    runOneItem(p, rA.batch.batchId);
    const ck = batch.checkBatch(p.dataDir, rA.batch.batchId);
    assert.equal(ck.nextAction, 'stop');
    assert.equal(ck.nextBatch && ck.nextBatch.batchId, rB.batch.batchId, '收尾 stop 应携带下一排队批次');
    assert.equal(ck.nextBatch.total, 1, 'nextBatch 应带条目数');
    assert.ok(ck.notice.includes('接续') || ck.notice.includes('下一批'), 'notice 应含接续指引');
    assert.ok(Buffer.byteLength(JSON.stringify(ck), 'utf8') <= batch.CHECK_MAX_BYTES, '核对响应仍 ≤2KiB');

    // B 接续后成为队首：其 check 不再有 nextBatch
    runOneItem(p, rB.batch.batchId);
    const ckB = batch.checkBatch(p.dataDir, rB.batch.batchId);
    assert.equal(ckB.nextBatch, undefined);
  } finally { cleanup(p); }
});

// ---------- Q6 提示词接续说明 ----------

t('Q6 提示词含自动接续说明：stop 且带 nextBatch 时同一会话换批次继续', () => {
  const p = mkProject();
  try {
    const prompt = batch.generatePrompt({ projectRoot: p.root, batchId: 'batch-20990909-001', workerSpecPath: 'spec.md' });
    assert.ok(prompt.includes('nextBatch'), '提示词应说明 nextBatch 接续信号');
    assert.ok(/同一会话|不.*新建会话|无需新开会话/.test(prompt), '提示词应说明同一会话接续');
  } finally { cleanup(p); }
});

// ---------- Q7 旧空批收尾推广 ----------

t('Q7 创建时把无在途且无待处理的未结束批次就地收尾，幂等不被旧空批卡死', () => {
  const p = mkProject();
  try {
    const a1 = mkItem(p, 'A1', { backMs: 2000 });
    const rA = batch.createBatch(p.dataDir, { projectRoot: p.root });
    runOneItem(p, rA.batch.batchId); // A 处理完（next 已将其置 finished，此处构造未置场景）

    // 手工构造「应收尾但未收尾」的旧批：直接改状态绕过 next 的收尾路径
    const b = batch.getBatch(p.dataDir, rA.batch.batchId);
    b.status = 'prepared';
    fs.writeFileSync(
      path.join(p.dataDir, 'dispatch', 'batches', b.batchId, 'batch.json'),
      JSON.stringify(b, null, 2),
    );

    const b1 = mkItem(p, 'B1');
    const rB = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(rB.created, true, '旧空批应被就地收尾，不阻塞新批次创建');
    assert.ok(!rB.queued, '收尾后无前序未结束批次');
    assert.equal(batch.getBatch(p.dataDir, rA.batch.batchId).status, 'finished', '旧空批应已置 finished');
    assert.ok(a1 && b1);
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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bqueue-cli-')));
  assert.equal((await runAtb(['init'], root)).code, 0);
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const r = await runAtb(['new', 'req', `排队条目-${i}`], root);
    const m = r.out.match(/(REQ-\d{8}-\d{3})/);
    ids.push(m[1]);
  }
  for (const id of ids) {
    assert.equal((await runAtb(['status', id, 'accepted'], root)).code, 0);
    assert.equal((await runAtb(['status', id, 'planned'], root)).code, 0); // REQ-20260908-010：选单口径 planned
  }
  return { root, ids };
}

// 假 worker 完整流转（CLI 层）；report 的 --json 为混合输出，按退出码判断
async function cliRunOne(root, batchId, owner) {
  const run = await runAtbJson(['batch', 'next', '--batch', batchId, '--by', owner], root);
  if (run.stop) return run;
  assert.equal((await runAtb(['claim', run.itemId, '--by', owner], root)).code, 0);
  assert.equal((await runAtb(['report', run.itemId, '--summary', 'ok', '--by', owner, '--run', run.runId], root)).code, 0);
  await runAtbJson(['run', 'receipt', run.runId, '--result', 'reported', '--report-ref', 'test-report.md'], root);
  return run;
}

// ---------- Q8 serve：队列接口 ----------

t('Q8 serve：/api/batch/current 返回 queue（升序含队首）；create 排队响应带 queued/queuePosition', async () => {
  const p = await mkCliProject(2);
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: p.root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(p.root, '.reg.json') }, // 独立注册表：缺省项目只可能是测试项目
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `project=${encodeURIComponent(p.root)}`; // 显式绑定测试项目，防误伤注册表最近项目
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await httpReq(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    const cA = await httpReq(port, 'POST', `/api/batch/create?${P}`, {});
    assert.equal(cA.status, 200);
    // A 冻结后追加新条目（A1、A2 均被 A 占住），再创建 B 才有新候选可入队
    const rNew = await runAtb(['new', 'req', '排队追加条目'], p.root);
    const mNew = rNew.out.match(/(REQ-\d{8}-\d{3})/);
    assert.ok(mNew, `应输出单号：${rNew.out}`);
    assert.equal((await runAtb(['status', mNew[1], 'accepted'], p.root)).code, 0);
    assert.equal((await runAtb(['status', mNew[1], 'planned'], p.root)).code, 0); // REQ-20260908-010：选单口径 planned
    const cB = await httpReq(port, 'POST', `/api/batch/create?${P}`, {});
    assert.equal(cB.status, 200);
    assert.equal(cB.json.created, true, 'A 未结束时应创建 B 入队');
    assert.equal(cB.json.queued, true, '创建响应应带 queued=true');
    assert.equal(cB.json.queuePosition, 2, '创建响应应带 queuePosition=2');

    const cur = await httpReq(port, 'GET', `/api/batch/current?${P}`);
    assert.equal(cur.status, 200);
    assert.equal(cur.json.batch.batchId, cA.json.batchId, 'current 仍显示队首 A');
    const q = cur.json.queue || [];
    assert.equal(q.length, 2, 'queue 应含 A、B 两个未结束批次');
    assert.equal(q[0].batchId, cA.json.batchId, 'queue 升序：队首在前');
    assert.equal(q[0].queuePosition, 1);
    assert.equal(q[1].batchId, cB.json.batchId);
    assert.equal(q[1].queuePosition, 2);
    assert.equal(q[1].total, 1, 'B 冻结创建时点的新候选（1 项）');
    assert.ok(!('prompt' in q[1]), 'queue 条目不应携带 prompt');
  } finally {
    server.kill();
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- Q9 CLI：排队创建与接续提示 ----------

t('Q9 cli：排队创建输出「已加入队列，排第 N 位」；check 收尾输出下一批次接续提示', async () => {
  const p = await mkCliProject(1);
  try {
    const cA = await runAtbJson(['batch', 'create'], p.root);
    // A 冻结后追加新条目，B 才有新候选可入队
    const rNew = await runAtb(['new', 'req', '排队接续条目'], p.root);
    const mNew = rNew.out.match(/(REQ-\d{8}-\d{3})/);
    assert.ok(mNew, `应输出单号：${rNew.out}`);
    assert.equal((await runAtb(['status', mNew[1], 'accepted'], p.root)).code, 0);
    assert.equal((await runAtb(['status', mNew[1], 'planned'], p.root)).code, 0); // REQ-20260908-010：选单口径 planned
    const rB = await runAtb(['batch', 'create'], p.root);
    assert.equal(rB.code, 0);
    assert.match(rB.out, /已创建批次 [^\s]+ 并已加入队列/, '排队创建应输出创建入队提示');
    assert.match(rB.out, /已加入队列，排第 2 位/, '应说明排第 2 位');
    assert.match(rB.out, /当前批次结束后自动开始/, '应说明自动开始');

    await cliRunOne(p.root, cA.batchId, 'zcode-queue-cli-w1');
    const ck = await runAtb(['batch', 'check', '--batch', cA.batchId], p.root);
    assert.equal(ck.code, 0);
    assert.match(ck.out, /下一批次|自动接续/, 'check 收尾应提示下一批次接续');
    const ckJson = await runAtbJson(['batch', 'check', '--batch', cA.batchId], p.root);
    assert.equal(ckJson.nextBatch.batchId !== undefined, true, 'check JSON 应带 nextBatch');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- Q10 UI 静态契约 ----------

t('Q10 ui：抽屉渲染排队列表（排队中标签+位次）；入队 toast 文案；轮询签名计入 queue', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /排队中/, '应有「排队中」状态文案');
  assert.match(js, /第.?\$\{[^}]*queuePosition|queuePosition/, '排队列表应显示位次');
  assert.match(js, /已加入队列，排第/, '创建入队 toast 应含位次提示');
  assert.match(js, /当前批次结束后自动开始/, 'toast 应说明自动开始');
  const sig = js.match(/const sig = JSON\.stringify\(\{[^;]+\}/);
  assert.ok(sig, '应存在轮询签名');
  assert.match(sig[0], /q:\s*data\.queue/, '签名应计入 queue，队列变化触发重渲染');
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
