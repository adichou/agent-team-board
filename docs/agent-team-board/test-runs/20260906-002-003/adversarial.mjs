// 独立验收探针：只在系统临时目录建立测试夹具，不改真实条目或产品源码。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as core from '../../../../scripts/lib/core.mjs';
import * as batch from '../../../../scripts/lib/batch.mjs';
import * as store from '../../../../scripts/lib/dispatch-store.mjs';
import { verifyCompletion } from '../../../../scripts/lib/execution-verifier.mjs';
import { createScheduler } from '../../../../scripts/lib/scheduler.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const evidence = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(n = 2) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-acceptance-')));
  core.initData(project);
  const d = core.requireDataDir(project);
  const ids = Array.from({ length: n }, (_, i) => {
    const it = core.createItem(d, { type: 'requirement', title: `隔离夹具-${i}`, by: 'test-fixture' });
    // 测试夹具模拟人工接受，路径为本函数刚创建的系统临时目录。
    core.setStatus(d, it.id, 'accepted', { by: 'test-fixture-human' });
    return it.id;
  });
  return { project, d, ids };
}
async function waitFor(fn, ms = 5000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('等待夹具状态超时');
    await sleep(20);
  }
}
function scheduler(p, extra = {}) {
  return createScheduler({ projectRoot: p.project, dataDir: p.d,
    atbCliPath: path.join(root, 'scripts/atb.mjs'),
    cli: { path: process.execPath, spawnArgs: [path.join(root, 'scripts/tests/fixtures/fake-codex.mjs')],
      envForRun: () => ({ FAKE_MODE: 'no-report' }) },
    tickMs: 30, cancelGraceMs: 100, settleMs: 30, timeoutMs: 3000, maxResumeRounds: 0,
    ...extra });
}
async function test(id, fn) {
  try { const observed = await fn(); evidence.push({ id, pass: true, observed }); }
  catch (e) { evidence.push({ id, pass: false, error: e.message }); }
  console.log(JSON.stringify(evidence.at(-1)));
}

await test('Z-A1 全部依赖受阻时 check 应停止，不能反复派空 worker', () => {
  const p = fixture();
  batch.setDependencies(p.d, p.ids[0], [p.ids[1]]);
  const b = batch.createBatch(p.d, { projectRoot: p.project, limit: 1 }).batch;
  const first = batch.checkBatch(p.d, b.batchId);
  const next = batch.nextItem(p.d, b.batchId, { owner: 'fixture-worker' });
  const after = batch.checkBatch(p.d, b.batchId);
  assert.equal(after.nextAction, 'stop', JSON.stringify({ project: p.project, first, next, after }));
});

await test('Z-A2 手工先认领时 Zcode 批次不得再实施另一项', () => {
  const p = fixture();
  core.claim(p.d, p.ids[0], 'manual-worker');
  const b = batch.createBatch(p.d, { projectRoot: p.project }).batch;
  let rejected = false;
  try {
    const next = batch.nextItem(p.d, b.batchId, { owner: 'batch-worker' });
    core.claim(p.d, next.itemId, 'batch-worker');
  } catch { rejected = true; }
  assert.equal(rejected, true, JSON.stringify({ project: p.project, items: core.listItems(p.d).map(x => ({ id: x.id, status: x.status, owner: x.owner })) }));
});

await test('Z-A3 失败且 safeToContinue=false 应保留项目实施占用', () => {
  const p = fixture();
  const b = batch.createBatch(p.d, { projectRoot: p.project }).batch;
  const run = batch.nextItem(p.d, b.batchId, { owner: 'batch-worker' });
  core.claim(p.d, run.itemId, run.owner);
  batch.finishRun(p.d, run.runId, { result: 'failed', reason: '遗留改动尚未核对', safeToContinue: false });
  let rejected = false;
  try { core.claim(p.d, p.ids[1], 'manual-worker'); } catch { rejected = true; }
  assert.equal(rejected, true, JSON.stringify({ project: p.project, check: batch.checkBatch(p.d, b.batchId), lock: core.readImplLockIfExists(p.d), items: core.listItems(p.d).map(x => ({ id: x.id, status: x.status, owner: x.owner })) }));
});

await test('C-A1 缺少 runId 的新报告不能作为本次完成证据', async () => {
  const p = fixture(1);
  const run = { itemId: p.ids[0], runId: 'run-fixture-current', startedAt: new Date().toISOString(), owner: p.ids[0] };
  core.claim(p.d, p.ids[0], p.ids[0]);
  await sleep(20);
  core.report(p.d, p.ids[0], { by: p.ids[0], framework: 'fixture', summary: '缺少 runId 的报告' });
  const v = verifyCompletion({ run, dataDir: p.d });
  assert.equal(v.reported, false, JSON.stringify({ project: p.project, run, lastReport: core.getItemDetail(p.d, p.ids[0]).lastReport, verification: v }));
});

await test('C-A2 依赖受阻应显示阻塞原因，不能称为队列已空', async () => {
  const p = fixture();
  // 前置条目仍为 submitted，只有依赖它的条目可被候选查询看见。
  const dep = core.createItem(p.d, { type: 'requirement', title: '未接受前置', by: 'test-fixture' }).id;
  for (const id of p.ids) batch.setDependencies(p.d, id, [dep]);
  const s = scheduler(p);
  try {
    s.enable();
    await sleep(80);
    const state = s.status();
    assert.notEqual(state.waiting?.kind, 'empty', JSON.stringify({ project: p.project, state }));
  } finally { s.disable(); await s.shutdown({ cancelCurrent: true }); }
});

await test('C-A3 未认领未上报且续跑耗尽后不能无限重新派同项', async () => {
  const p = fixture(1);
  const s = scheduler(p, { maxResumeRounds: 2 });
  try {
    s.enable();
    await waitFor(() => store.listRuns(p.d).items.some(x => x.phase === 'blocked'));
    await sleep(450);
    const runs = store.listRuns(p.d).items;
    assert.equal(runs.length, 1, JSON.stringify({ project: p.project, runs: runs.map(x => ({ runId: x.runId, itemId: x.itemId, phase: x.phase, threadId: x.threadId })) }));
  } finally { s.disable(); await s.shutdown({ cancelCurrent: true }); }
});

await test('C-A4 网络退避期间停止当前执行不得在退避结束后复活', async () => {
  const p = fixture(1);
  let starts = 0;
  const s = scheduler(p, { backoffs: [600, 600],
    cli: { path: process.execPath, spawnArgs: [path.join(root, 'scripts/tests/fixtures/fake-codex.mjs')],
      envForRun: () => { starts++; return { FAKE_MODE: 'net-error' }; } } });
  try {
    s.enable();
    await waitFor(() => store.listRuns(p.d).items.some(x => x.retriesUsed === 1));
    const before = starts;
    const stopped = s.stopCurrent();
    await sleep(850);
    assert.equal(starts, before, JSON.stringify({ project: p.project, stopped, before, starts, state: s.status() }));
  } finally { s.disable(); await s.shutdown({ cancelCurrent: true }); }
});

await test('C-A5 恢复本项必须绑定用户所选 runId', async () => {
  const p = fixture();
  const old = store.newRun(p.d, { itemId: p.ids[0], projectRoot: p.project, prompt: '' });
  store.updateRun(p.d, old.runId, { phase: 'interrupted', threadId: 'fixture-thread-old', startedAt: new Date().toISOString() });
  await sleep(20);
  const recent = store.newRun(p.d, { itemId: p.ids[1], projectRoot: p.project, prompt: '' });
  store.updateRun(p.d, recent.runId, { phase: 'interrupted', threadId: 'fixture-thread-recent', startedAt: new Date().toISOString() });
  const s = scheduler(p);
  try {
    const resumed = s.resumeItem(old.runId);
    assert.equal(resumed.runId, old.runId, JSON.stringify({ project: p.project, requested: old.runId, actual: resumed }));
  } finally { await s.shutdown({ cancelCurrent: true }); }
});

fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'adversarial-results.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version, evidence }, null, 2));
console.log(`验收探针 ${evidence.length} 个，失败 ${evidence.filter(x => !x.pass).length} 个。`);
process.exit(evidence.some(x => !x.pass) ? 1 : 0);
