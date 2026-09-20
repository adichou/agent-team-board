#!/usr/bin/env node
// BUG-20260919-001 已终止批次被在途回执复活为 running，队首永久 stop=aborted 阻塞后续批次派发
// 覆盖（验收 README 第 1 条）：
//   B1  已终止批次补交 reported 回执：回执落账成功，但 status 保持 finished，abortRequested/aborted 不被改写
//   B1b 已终止批次补交 blocked（safe）/failed（unsafe）回执同样不复活（挂起/needs_attention 分支整段 guard）
//   B2  终止幂等自愈：人为构造 abortRequested=true + status='running' 账本，再次 abortBatch 后
//       status=finished、剩余候选补 skipped、currentRunId 清空；不误释放后续批次已持有的实施锁
//   B3  队列接续：复活场景修复后，新建批次可被 next 正常解析派发（队首不再卡死 stop=aborted）
//   B4  正常路径回归：未终止批次 reported/safe 回执后 status 按 remaining 正确置 running/finished
// 用法：node scripts/tests/bug-20260919-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 测试脚手架：临时项目（与 batch-core.test.mjs 同法） ----------

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-20260919-')));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  return { root, dataDir };
}

function backdate(dataDir, id, deltaMs) {
  const { dir } = core.resolveItemDir(dataDir, id);
  const st = JSON.parse(fs.readFileSync(core.statusFileOfItemDir(dir), 'utf8'));
  st.createdAt = new Date(Date.parse(st.createdAt) - deltaMs).toISOString();
  fs.writeFileSync(core.statusFileOfItemDir(dir), JSON.stringify(st, null, 2) + '\n');
}

function mkItem(p, type, title, { accept = true, plan = true, backMs = 0 } = {}) {
  const st = core.createItem(p.dataDir, { type, title, description: 'x', by: 'tester' });
  if (accept) core.setStatus(p.dataDir, st.id, 'accepted', { by: 'tester' });
  if (accept && plan) core.setStatus(p.dataDir, st.id, 'planned', { by: 'tester' });
  if (backMs) backdate(p.dataDir, st.id, backMs);
  return st.id;
}

function cleanup(p) {
  try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
}

// 复活账本注入：直改 batch.json 模拟旧缺陷已把已终止批次改写回 running（等价在途回执复活结果）
function forceResurrect(p, batchId, runId) {
  const file = path.join(p.dataDir, 'runtime', 'dispatch', 'batches', batchId, 'batch.json');
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.status = 'running';
  b.currentRunId = runId;
  fs.writeFileSync(file, JSON.stringify(b, null, 2) + '\n');
}

function batchFile(p, batchId) {
  return path.join(p.dataDir, 'runtime', 'dispatch', 'batches', batchId, 'batch.json');
}

const W1 = 'zcode-batch-fake-w1';
const W2 = 'zcode-batch-fake-w2';

// ---------- B1 已终止批次补交 reported 回执不复活 ----------

t('B1 终止后补交 reported 回执：回执照常落账，批次保持 finished 终态不复活', () => {
  const p = mkProject();
  try {
    const item1 = mkItem(p, 'bug', '在途项', { backMs: 3000 });
    const item2 = mkItem(p, 'requirement', '排队项-2', { backMs: 2000 });
    const item3 = mkItem(p, 'requirement', '排队项-3', { backMs: 1000 });
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run.itemId, item1, '队首应领取最旧的在途项');
    core.claim(p.dataDir, item1, W1);

    // 人工终止：在途落 interrupted，item2/item3 出局，批次转 finished + aborted 终态
    batch.abortBatch(p.dataDir, bt.batchId);
    assert.equal(batch.getBatch(p.dataDir, bt.batchId).status, 'finished');

    // 终止后新增账面外候选：实时盘点口径下 remaining>0（旧缺陷据此把批次改写回 running）
    mkItem(p, 'requirement', '终止后新增');

    // 在途子代理未被停止，继续走完上报并补交回执
    core.report(p.dataDir, item1, { summary: '终止后补交', by: W1, run: { runId: run.runId } });
    const fin = batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.equal(fin.ok, true, '已终止批次的在途回执应照常落账（不拒绝）');
    assert.equal(fin.idempotent, undefined, '非重复回执不应走幂等返回');
    assert.equal(fin.receipt && fin.receipt.result, 'reported', '回执内容应为 reported');
    const runAfter = JSON.parse(fs.readFileSync(
      path.join(p.dataDir, 'runtime', 'dispatch', 'runs', run.runId, 'run.json'), 'utf8'));
    assert.equal(runAfter.phase, 'reported', '运行账目应收尾为 reported');
    assert.equal(runAfter.reportRef, 'test-report.md', 'reportRef 应照常落账');

    // 缺陷断言：批次保持 finished 终态，abortRequested/aborted 不被改写，不重回未结束队列
    const after = batch.getBatch(p.dataDir, bt.batchId);
    assert.equal(after.status, 'finished', `已终止批次不得被在途回执复活（当前 ${after.status}）`);
    assert.equal(after.abortRequested, true, 'abortRequested 不被改写');
    assert.equal(after.aborted, true, 'aborted 不被改写');
    assert.equal(after.currentRunId, null, 'currentRunId 应保持清空');
    assert.ok(!batch.unfinishedBatches(p.dataDir).some((b) => b.batchId === bt.batchId),
      '已终止批次不得重回未结束队列');
    assert.equal(core.readImplLockIfExists(p.dataDir), null, '收尾不得重新占用项目实施锁');
  } finally { cleanup(p); }
});

// ---------- B1b 已终止批次补交 blocked / failed 回执同样不复活 ----------

t('B1b 终止后补交 blocked（safe）/failed（unsafe）回执：同样保持 finished，不挂起不待核对不占锁', () => {
  const p1 = mkProject();
  const p2 = mkProject();
  try {
    // 场景一：blocked（safe 缺省 true）——旧缺陷会按 remaining 置 running
    {
      const a = mkItem(p1, 'requirement', '受阻项', { backMs: 1000 });
      mkItem(p1, 'requirement', '剩余项');
      const { batch: bt } = batch.createBatch(p1.dataDir, { projectRoot: p1.root });
      const run = batch.nextItem(p1.dataDir, bt.batchId, { owner: W1 });
      batch.abortBatch(p1.dataDir, bt.batchId);
      mkItem(p1, 'requirement', '终止后新增'); // 使实时盘点 remaining>0（复活判定口径）
      const fin = batch.finishRun(p1.dataDir, run.runId, { result: 'blocked', reason: '终止后受阻补交' });
      assert.equal(fin.ok, true, 'blocked 回执应照常落账');
      const after = batch.getBatch(p1.dataDir, bt.batchId);
      assert.equal(after.status, 'finished', `blocked 补交不得复活已终止批次（当前 ${after.status}）`);
      assert.equal(after.abortRequested, true);
    }
    // 场景二：failed + safeToContinue=false——旧缺陷会把终态批次改写为 needs_attention 并占 attention 锁
    {
      const a = mkItem(p2, 'requirement', '失败项', { backMs: 1000 });
      mkItem(p2, 'requirement', '剩余项');
      const { batch: bt } = batch.createBatch(p2.dataDir, { projectRoot: p2.root });
      const run = batch.nextItem(p2.dataDir, bt.batchId, { owner: W1 });
      batch.abortBatch(p2.dataDir, bt.batchId);
      const fin = batch.finishRun(p2.dataDir, run.runId, { result: 'failed', reason: '终止后失败补交', safeToContinue: false });
      assert.equal(fin.ok, true, 'failed 回执应照常落账');
      const after = batch.getBatch(p2.dataDir, bt.batchId);
      assert.equal(after.status, 'finished', `failed 补交不得把已终止批次置 needs_attention（当前 ${after.status}）`);
      const lock = core.readImplLockIfExists(p2.dataDir);
      assert.equal(lock, null, `不得为已终止批次挂 attention 占用，得到 ${JSON.stringify(lock)}`);
    }
  } finally { cleanup(p1); cleanup(p2); }
});

// ---------- B2 终止幂等自愈 ----------

t('B2 终止幂等自愈：复活账本重复 abort 修复为 finished、剩余候选补 skipped、清 currentRunId、不误放后续锁', () => {
  const p = mkProject();
  try {
    const item1 = mkItem(p, 'bug', '在途项', { backMs: 3000 });
    const item2 = mkItem(p, 'requirement', '排队项-2', { backMs: 2000 });
    const item3 = mkItem(p, 'requirement', '排队项-3', { backMs: 1000 });
    const { batch: btA } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, btA.batchId, { owner: W1 });
    core.claim(p.dataDir, item1, W1);
    batch.abortBatch(p.dataDir, btA.batchId);
    const before = batch.listRuns(p.dataDir, btA.batchId);
    assert.equal(before.records.filter((r) => r.result === 'skipped').length, 2, '首次终止应使 item2/item3 出局');

    // 人工承接：新建批次 B 并持有项目实施锁（模拟后续批次正常实施中）
    const { batch: btB } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    fs.writeFileSync(path.join(p.dataDir, 'runtime', '.locks', 'impl.lock'), JSON.stringify({
      kind: 'batch', batchId: btB.batchId, owner: W2, at: new Date().toISOString(),
    }));

    // 注入旧缺陷产物：A 被在途回执复活为 running 且 currentRunId 残留，重新卡住队首
    mkItem(p, 'requirement', '复活后新增');
    core.report(p.dataDir, item1, { summary: '补交', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    forceResurrect(p, btA.batchId, run.runId);
    assert.equal(batch.getBatch(p.dataDir, btA.batchId).status, 'running', '前置：账本应处于复活态');
    assert.equal(batch.queueHeadBatch(p.dataDir).batchId, btA.batchId, '前置：复活批次应卡住队首');

    // 人工重复终止：幂等分支应修复账本到终止终态（不再只返回）
    const again = batch.abortBatch(p.dataDir, btA.batchId);
    assert.equal(again.ok, true, '重复终止应成功返回');
    assert.equal(again.aborted, true, '返回应保持 aborted=true');
    const healed = batch.getBatch(p.dataDir, btA.batchId);
    assert.equal(healed.status, 'finished', `幂等终止应把复活账本修复回 finished（当前 ${healed.status}）`);
    assert.equal(healed.currentRunId, null, '幂等终止应清空 currentRunId');
    assert.equal(healed.abortRequested, true);
    assert.equal(healed.aborted, true);

    // 未出局候选（复活后新增项）应补 skipped 出局账
    const runs = batch.listRuns(p.dataDir, btA.batchId).records;
    assert.equal(runs.filter((r) => r.result === 'skipped').length, 3,
      `剩余候选应补齐出局账（item2/item3/新增，当前 skipped=${runs.filter((r) => r.result === 'skipped').length}）`);
    assert.ok(runs.some((r) => r.itemId !== item1 && r.itemId !== item2 && r.itemId !== item3
      && r.result === 'skipped'), '复活后新增候选应有 skipped 出局运行');

    // 不得误释放后续批次已持有的实施锁；队列接续：队首让位给 B
    const lock = core.readImplLockIfExists(p.dataDir);
    assert.ok(lock && lock.batchId === btB.batchId, `幂等修复不得释放后续批次的实施锁，得到 ${JSON.stringify(lock)}`);
    assert.equal(batch.queueHeadBatch(p.dataDir).batchId, btB.batchId, '修复后队首应让位给后续批次 B');
    assert.equal(JSON.parse(fs.readFileSync(batchFile(p, btA.batchId), 'utf8')).status, 'finished');
  } finally { cleanup(p); }
});

// ---------- B3 队列接续 ----------

t('B3 队列接续：修复后新建批次可被 next 正常派发，缺省解析落到后续批次（不再卡死 stop=aborted）', () => {
  const p = mkProject();
  try {
    const item1 = mkItem(p, 'bug', '在途项', { backMs: 3000 });
    const item2 = mkItem(p, 'requirement', '承接项-2', { backMs: 2000 });
    const item3 = mkItem(p, 'requirement', '承接项-3', { backMs: 1000 });
    const { batch: btA } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const runA = batch.nextItem(p.dataDir, btA.batchId, { owner: W1 });
    core.claim(p.dataDir, item1, W1);
    batch.abortBatch(p.dataDir, btA.batchId);
    // 人工承接（真实时间线：终止后立即创建 049），随后在途回执补交
    const { batch: btB } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    mkItem(p, 'requirement', '终止后新增');
    core.report(p.dataDir, item1, { summary: '补交', by: W1, run: { runId: runA.runId } });
    batch.finishRun(p.dataDir, runA.runId, { result: 'reported', reportRef: 'test-report.md' });

    // 缺省解析：队首不再是已终止的 A，而是后续批次 B
    assert.equal(batch.queueHeadBatch(p.dataDir).batchId, btB.batchId,
      `队首应落到后续批次（当前 ${batch.queueHeadBatch(p.dataDir) && batch.queueHeadBatch(p.dataDir).batchId}）`);

    // B 可正常派发（旧缺陷：A 复活为未结束队首，next 对 A 永远 stop=aborted、对 B 永远排队）
    const runB = batch.nextItem(p.dataDir, btB.batchId, { owner: W2 });
    assert.equal(runB.itemId, item2, '后续批次应正常领取下一可实施项');
    const chk = batch.checkBatch(p.dataDir, btB.batchId);
    assert.equal(chk.nextAction, 'needs_attention', 'B 有在途执行时 check 应提示核对当前执行');
    core.claim(p.dataDir, item2, W2);
    core.report(p.dataDir, item2, { summary: '承接完成', by: W2, run: { runId: runB.runId } });
    batch.finishRun(p.dataDir, runB.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.equal(batch.getBatch(p.dataDir, btB.batchId).status, 'running', 'B 继续执行后续项');
  } finally { cleanup(p); }
});

// ---------- B4 正常路径回归 ----------

t('B4 正常路径回归：未终止批次 reported/safe 回执按 remaining 置 running/finished，failed 仍待核对', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', '回归-A', { backMs: 2000 });
    const b = mkItem(p, 'requirement', '回归-B', { backMs: 1000 });
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });

    // 第一项 reported：仍有剩余 → running
    const runA = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(runA.itemId, a);
    core.claim(p.dataDir, a, W1);
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: runA.runId } });
    batch.finishRun(p.dataDir, runA.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.equal(batch.getBatch(p.dataDir, bt.batchId).status, 'running', '未终止批次 reported 后仍应有剩余 → running');

    // 最后一项 reported：无剩余 → finished
    const runB = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(runB.itemId, b);
    core.claim(p.dataDir, b, W1);
    core.report(p.dataDir, b, { summary: 'ok', by: W1, run: { runId: runB.runId } });
    batch.finishRun(p.dataDir, runB.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.equal(batch.getBatch(p.dataDir, bt.batchId).status, 'finished', '未终止批次全部 reported → finished');
  } finally { cleanup(p); }

  const p2 = mkProject();
  try {
    // safe 回执（blocked）与 unsafe 回执（failed）既有分支不回归
    const a = mkItem(p2, 'requirement', 'safe-A', { backMs: 1000 });
    mkItem(p2, 'requirement', 'safe-B');
    const { batch: bt } = batch.createBatch(p2.dataDir, { projectRoot: p2.root });
    const runA = batch.nextItem(p2.dataDir, bt.batchId, { owner: W1 });
    core.claim(p2.dataDir, a, W1);
    batch.finishRun(p2.dataDir, runA.runId, { result: 'blocked', reason: '依赖缺失受阻' });
    assert.equal(batch.getBatch(p2.dataDir, bt.batchId).status, 'running', 'blocked（safe）后批次继续 → running');

    const runB = batch.nextItem(p2.dataDir, bt.batchId, { owner: W1 });
    core.claim(p2.dataDir, runB.itemId, W1);
    batch.finishRun(p2.dataDir, runB.runId, { result: 'failed', reason: '环境错误', safeToContinue: false });
    assert.equal(batch.getBatch(p2.dataDir, bt.batchId).status, 'needs_attention', 'failed（unsafe）仍应待人工核对');
    const lock = core.readImplLockIfExists(p2.dataDir);
    assert.ok(lock && lock.attention === true, 'unsafe 失败仍应保留 attention 占用（BUG-20260906-003 不回归）');
    batch.pauseBatch(p2.dataDir, bt.batchId, true);
    batch.pauseBatch(p2.dataDir, bt.batchId, false);
    assert.equal(core.readImplLockIfExists(p2.dataDir), null, '人工恢复后解除占用不回归');
  } finally { cleanup(p2); }
});

// ---------- 执行 ----------

let failed = 0;
for (const [name, fn] of cases) {
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
