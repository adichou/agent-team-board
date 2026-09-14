#!/usr/bin/env node
// REQ-20260906-002 Zcode 批量实施 —— 共用批次/执行账本核心层测试
// 覆盖：Z01 选单排序 / Z02 批次冻结 / Z03 依赖 / Z05 预留故障 / Z09 回执协议 /
//       Z10 证据一致性 / Z11 report 后续派 / Z12 冲突与环境错误 / Z14 暂停 /
//       Z15 摘要续接 / Z21 report 运行关联 / Z22 实施互斥 / Z23 单项规范 / Z24 释放预留 /
//       BUG-20260906-001 全受阻批次 check 应 stop（Z-A1 回归）
//       BUG-20260906-002 手工先认领占用项目实施互斥，批次/Codex/他人不得并行（Z-A2 回归）
//       BUG-20260906-003 失败待核对保留项目实施占用，其他入口遵守暂停（Z-A3 回归）
//       REQ-20260908-001 批次记录带条目标题（listRuns 增量字段 + 删除容错）
// 用法：node scripts/tests/batch-core.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as store from '../lib/dispatch-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 测试脚手架：临时项目 ----------

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-batch-')));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  return { root, dataDir };
}

// backdate：把条目 createdAt 改到指定偏移（毫秒），用于构造稳定的创建时间顺序
function backdate(dataDir, id, deltaMs) {
  const { dir } = core.resolveItemDir(dataDir, id);
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  st.createdAt = new Date(Date.parse(st.createdAt) - deltaMs).toISOString();
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(st, null, 2) + '\n');
}

function mkItem(p, type, title, { accept = true, plan = true, backMs = 0 } = {}) {
  const st = core.createItem(p.dataDir, { type, title, description: 'x', by: 'tester' });
  // REQ-20260908-010：调度选单口径从 accepted 切到 planned（已计划），测试样本默认置计划
  if (accept) core.setStatus(p.dataDir, st.id, 'accepted', { by: 'tester' });
  if (accept && plan) core.setStatus(p.dataDir, st.id, 'planned', { by: 'tester' });
  if (backMs) backdate(p.dataDir, st.id, backMs);
  return st.id;
}

// 模拟「他人已认领」：直改条目状态与认领锁（等价外部竞态，绕过实施互斥便于注入）
function forceClaim(p, id, owner) {
  const { dir } = core.resolveItemDir(p.dataDir, id);
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  st.status = 'in-progress';
  st.owner = owner;
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(st, null, 2) + '\n');
  fs.writeFileSync(path.join(p.dataDir, '.locks', `${id}.lock`), JSON.stringify({ owner, at: new Date().toISOString() }));
}

function cleanup(p) {
  try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
}

const W1 = 'zcode-batch-fake-w1';
const W2 = 'zcode-batch-fake-w2';

// ---------- Z01 选单 ----------

t('Z01 混合 req/bug：最旧优先（纯创建时间序，REQ-20260908-010）；只含 planned 未认领', () => {
  const p = mkProject();
  try {
    const bugOld = mkItem(p, 'bug', '最早的 bug', { backMs: 3000 });
    const reqNew = mkItem(p, 'requirement', '较新的需求');
    const reqOld = mkItem(p, 'requirement', '较早的需求', { backMs: 2000 });
    mkItem(p, 'requirement', '未接受的需求', { accept: false });
    const doneReq = mkItem(p, 'requirement', '已完成的需求');
    core.setStatus(p.dataDir, doneReq, 'in-progress', { by: 'tester' });
    core.setStatus(p.dataDir, doneReq, 'done', { by: 'tester' });

    const ids = batch.candidateItems(p.dataDir).map((x) => x.id);
    assert.deepEqual(ids, [bugOld, reqOld, reqNew], `排序应为创建时间升序（bug 更早则在前），得到 ${ids}`);
  } finally { cleanup(p); }
});

// ---------- Z02 批次冻结（REQ-20260908-019 起无上限设置） ----------

t('Z02a 批次冻结候选：全量冻结、无 limit 字段；重复创建幂等；冻结后新增条目入下一批', () => {
  const p = mkProject();
  try {
    for (let i = 1; i <= 3; i++) mkItem(p, 'requirement', `冻结前-${i}`, { backMs: (3 - i) * 1000 });
    const { batch: b, created } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(created, '首次创建应 created=true');
    assert.equal(b.candidates.length, 3, '无上限设置应全量冻结全部候选');
    assert.equal('limit' in b, false, '批次记录不应再写 limit 字段（REQ-20260908-019）');

    const again = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(again.created, false, '候选集合不变时重复创建应幂等返回同一批次');
    assert.equal(again.batch.batchId, b.batchId);
    assert.deepEqual(again.batch.candidates, b.candidates, '重复创建不得改动冻结候选');

    // 冻结后新增条目不进旧批次：再创建得到只含新条目的排队批次（此前会被上限截断遮蔽进幂等分支）
    const fresh = mkItem(p, 'requirement', '冻结后新增');
    const queued = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(queued.created, true, '出现新候选时应新建批次入队（REQ-20260906-025）');
    assert.equal(queued.queued, true, '新批次应排队');
    assert.deepEqual(queued.batch.candidates, [fresh], '新批次只冻结新增条目，前序批次候选不重复入批');
  } finally { cleanup(p); }
});

t('Z02b 空候选：createBatch 报错，不产生批次文件', () => {
  const p = mkProject();
  try {
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /没有可实施候选/);
    assert.equal(fs.existsSync(path.join(p.dataDir, 'dispatch', 'batches')), false, '不应创建批次目录');
  } finally { cleanup(p); }
});

t('Z02c 仅阻塞项：批次可建但 next 返回 stop=blocked，不派空 worker', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A');
    const b = mkItem(p, 'requirement', 'B', { accept: false, backMs: 1000 }); // 前置：未接受即未 done
    const r = batch.setDependencies(p.dataDir, a, [b]);
    assert.equal(r.ok, true, JSON.stringify(r));
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.deepEqual(bt.candidates, [a], '候选只含 planned 的 a');
    const next = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(next.stop, 'blocked', `仅余阻塞项应 stop=blocked，得到 ${JSON.stringify(next)}`);
    assert.ok(next.counts, 'stop 响应应带计数');
  } finally { cleanup(p); }
});

t('Z02d 上限设置已移除（REQ-20260908-019）：多余 limit 入参与存量 defaults.batchLimit 均不再生效', () => {
  const p = mkProject();
  try {
    for (let i = 1; i <= 2; i++) mkItem(p, 'requirement', `候选-${i}`);
    // 存量项目 settings.json 残留 defaults.batchLimit：不再被读取，候选全量冻结
    const sp = path.join(p.dataDir, 'dispatch', 'settings.json');
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
    s.defaults = { ...(s.defaults || {}), batchLimit: 1 };
    fs.writeFileSync(sp, JSON.stringify(s));
    // 原越界值 0/101 不再校验：多余 limit 入参被忽略，照常创建
    const { batch: b } = batch.createBatch(p.dataDir, { limit: 101, projectRoot: p.root });
    assert.equal(b.candidates.length, 2, 'limit 入参与残留 batchLimit 均不截断候选');
    const again = batch.createBatch(p.dataDir, { limit: 0, projectRoot: p.root });
    assert.equal(again.batch.batchId, b.batchId, '重复创建幂等，不受 limit 入参影响');
    // 常量随特性删除：新代码不得再引用
    assert.equal('BATCH_LIMIT_DEFAULT' in batch, false, 'BATCH_LIMIT_DEFAULT 常量应删除');
    assert.equal('BATCH_LIMIT_MAX' in batch, false, 'BATCH_LIMIT_MAX 常量应删除');
  } finally { cleanup(p); }
});

// ---------- Z03 依赖 ----------

t('Z03 依赖校验：不存在/自依赖/环被拒；未 done 受阻；父子归属不自动阻塞', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A');
    const b = mkItem(p, 'requirement', 'B', { backMs: 1000 });
    const bug = core.createItem(p.dataDir, { type: 'bug', title: 'A 的 bug', by: 't' }).id;
    core.moveBug(p.dataDir, bug, a); // REQ-20260908-009：新建一律独立，存量归属经 move 构造
    core.setStatus(p.dataDir, bug, 'accepted', { by: 't' }); // 仅接受（父子归属用例，不参与选单）

    assert.equal(batch.setDependencies(p.dataDir, a, ['REQ-20990101-999']).ok, false, '依赖不存在应拒');
    assert.equal(batch.setDependencies(p.dataDir, a, [a]).ok, false, '自依赖应拒');
    assert.equal(batch.setDependencies(p.dataDir, a, [b]).ok, true);
    assert.equal(batch.setDependencies(p.dataDir, b, [a]).ok, false, 'a→b 后 b→a 成环应拒');

    assert.ok(batch.depBlocked(p.dataDir, a), 'B 未 done 时 A 应受阻');
    core.setStatus(p.dataDir, b, 'in-progress', { by: 't' });
    core.setStatus(p.dataDir, b, 'done', { by: 't' });
    assert.equal(batch.depBlocked(p.dataDir, a), null, 'B done 后 A 解除阻塞');

    assert.equal(batch.depBlocked(p.dataDir, bug), null, '父子归属不得自动当依赖（bug 归属 A 但无策略依赖）');
    // 保存后可读回（items 结构与 REQ-20260906-003 dispatch-store 对齐，两边共用同一 policies.json）
    assert.deepEqual(batch.readPolicies(p.dataDir).items[a].dependsOn, [b]);
  } finally { cleanup(p); }
});

// ---------- Z05 / Z24 预留与释放 ----------

t('Z05a 预留后进程退出（未认领）：release 释放预留，条目仍 planned 可再次预留', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run.itemId, a);

    const rel = batch.releaseReservation(p.dataDir, run.runId, { reason: 'worker 启动失败' });
    assert.equal(rel.ok, true);
    assert.equal(core.getItemDetail(p.dataDir, a).status, 'planned', '条目状态不得被重置');

    const run2 = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run2.itemId, a, '释放后同一项可重新预留');
    assert.notEqual(run2.runId, run.runId);
  } finally { cleanup(p); }
});

t('Z05b/Z24 预留后被他人认领：release 释放运行账本（不碰条目），next 换下一项', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 });
    const b = mkItem(p, 'requirement', 'B');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run.itemId, a);
    // 模拟他人绕过互斥抢先认领（直改 status/claim 锁，等价外部竞态）
    forceClaim(p, a, W2);
    // worker claim 冲突后释放预留
    const rel = batch.releaseReservation(p.dataDir, run.runId, { reason: '认领冲突' });
    assert.equal(rel.ok, true);
    const st = core.getItemDetail(p.dataDir, a);
    assert.equal(st.status, 'in-progress');
    assert.equal(st.owner, W2, '不得动他人认领结果');

    const run2 = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run2.itemId, b, '冲突换单：应选下一个可实施项');
  } finally { cleanup(p); }
});

t('Z24b 已认领（本运行 owner）后 release 被拒：认领后的失败保持业务 in-progress', () => {
  const p = mkProject();
  try {
    mkItem(p, 'requirement', 'A');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, run.itemId, W1);
    assert.throws(
      () => batch.releaseReservation(p.dataDir, run.runId, { reason: 'x' }),
      /认领/,
      '认领后不得悄悄释放预留',
    );
    assert.equal(core.getItemDetail(p.dataDir, run.itemId).status, 'in-progress');
    // 实施失败路径应走 finishRun(failed)，条目保持 in-progress
    const fin = batch.finishRun(p.dataDir, run.runId, { result: 'failed', reason: '测试失败', safeToContinue: false });
    assert.equal(fin.ok, true);
    assert.equal(core.getItemDetail(p.dataDir, run.itemId).status, 'in-progress', '失败不改业务状态');
    // BUG-20260906-003：不可继续的失败保留实施占用并标记待核对（人工恢复后解除），
    // 不再无条件释放互斥
    const lock = core.readImplLockIfExists(p.dataDir);
    assert.ok(lock && lock.attention === true, `失败且不可继续应保留 attention 占用，得到 ${JSON.stringify(lock)}`);
    batch.pauseBatch(p.dataDir, bt.batchId, true);
    batch.pauseBatch(p.dataDir, bt.batchId, false);
    assert.equal(core.readImplLockIfExists(p.dataDir), null, '人工恢复后解除占用');
  } finally { cleanup(p); }
});

// ---------- Z22 实施互斥 ----------

t('Z22 批次持锁期间：他人 claim 被拒并提示核对；锁属主放行；收尾后恢复', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 });
    const b = mkItem(p, 'requirement', 'B');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.throws(() => core.claim(p.dataDir, b, W2), /互斥|核对/, '持锁期间他人 claim 应被拒');
    assert.doesNotThrow(() => core.claim(p.dataDir, a, W1), '锁属主本人 claim 应放行');
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.doesNotThrow(() => core.claim(p.dataDir, b, W2), '收尾释放互斥后 claim 恢复');
  } finally { cleanup(p); }
});

// ---------- BUG-20260906-002 手工占用实施互斥（Z-A2 回归） ----------

t('BUG-20260906-002 手工先认领：批次 next/Codex 派发/他人 claim 均被阻塞；report 后恢复', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 });
    const b = mkItem(p, 'requirement', 'B');
    core.claim(p.dataDir, a, 'manual-worker'); // 手工先认领 A
    assert.ok(fs.existsSync(path.join(p.dataDir, '.locks', 'impl.lock')), '手工认领应占用项目实施互斥');
    assert.throws(
      () => core.claim(p.dataDir, b, 'manual-worker'),
      /只能有一个实施任务/,
      '同 owner 未收尾认领第二项应被拒（单实施任务约束）',
    );
    assert.throws(() => core.claim(p.dataDir, b, 'manual-other'), /互斥|核对/, '他人手工 claim 应被拒');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.throws(() => batch.nextItem(p.dataDir, bt.batchId, { owner: 'batch-worker' }), /锁被占用/, '批次 next 应被手工占用阻塞');
    const got = store.acquireProjectLock(p.dataDir, 'codex-worker');
    assert.equal(got.ok, false, 'Codex 派发的实施互斥获取应失败');
    assert.equal(got.holder && got.holder.kind, 'manual', '持锁归属应为手工认领');
    assert.equal(got.holder && got.holder.itemId, a, '持锁应指明在实施条目');
    assert.equal(core.getItemDetail(p.dataDir, b).status, 'planned', '另一项不得被并行派发');
    core.report(p.dataDir, a, { summary: 'ok', by: 'manual-worker' });
    assert.equal(fs.existsSync(path.join(p.dataDir, '.locks', 'impl.lock')), false, '手工 report 应释放实施占用');
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: 'batch-worker' });
    assert.equal(run.itemId, b, '占用解除后批次继续派发下一项');
  } finally { cleanup(p); }
});

t('BUG-20260906-002 手工占用：人工确认完成/驳回即释放；批次持锁提示手工归属', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A');
    const b = mkItem(p, 'requirement', 'B');
    core.claim(p.dataDir, a, 'manual-worker');
    core.setStatus(p.dataDir, a, 'done', { by: 'human' });
    assert.equal(fs.existsSync(path.join(p.dataDir, '.locks', 'impl.lock')), false, '确认完成应释放手工占用');
    // 模拟崩溃残留：手工占用未释放时条目被人工驳回（done→in-progress），驳回应清理手工占用
    fs.writeFileSync(path.join(p.dataDir, '.locks', 'impl.lock'), JSON.stringify({ kind: 'manual', itemId: a, owner: 'manual-worker' }));
    core.setStatus(p.dataDir, a, 'in-progress', { by: 'human' });
    assert.equal(fs.existsSync(path.join(p.dataDir, '.locks', 'impl.lock')), false, '驳回应清理手工占用');
    // 批次持锁期间：手工 claim 提示应指明手工归属语义不回归（批次归属提示见 Z22）
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run.itemId, b);
    core.claim(p.dataDir, b, W1); // 批次属主认领（kind=batch 保持，不由手工逻辑覆盖）
    const lock = JSON.parse(fs.readFileSync(path.join(p.dataDir, '.locks', 'impl.lock'), 'utf8'));
    assert.equal(lock.kind, 'batch', '批次属主认领后锁归属保持 batch');
    core.report(p.dataDir, b, { summary: 'ok', by: W1, run: { runId: run.runId } });
    assert.ok(fs.existsSync(path.join(p.dataDir, '.locks', 'impl.lock')), '批次占用不受手工 report 释放影响');
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
  } finally { cleanup(p); }
});

// ---------- Z23 单项规范 ----------

t('Z23 next 只返回单项规范：不含批次其余候选与队列', () => {
  const p = mkProject();
  try {
    const ids = [1, 2, 3].map((i) => mkItem(p, 'requirement', `候选项-${i}`, { backMs: (3 - i) * 1000 }));
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    const text = JSON.stringify(run);
    assert.equal(run.itemId, ids[0]);
    for (const id of ids.slice(1)) assert.ok(!text.includes(id), `单项规范不得泄漏其余候选 ${id}`);
    assert.ok(run.itemDir && run.workerSpec && run.docs, '规范应携带条目目录/规范路径/文档清单');
  } finally { cleanup(p); }
});

// ---------- Z09 回执协议 ----------

t('Z09 回执协议：缺字段/未知 result/超 2KiB/错 runId 均拒；幂等重放不重复计数', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A');
    const b = mkItem(p, 'requirement', 'B');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, a, W1);
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: run.runId } });

    assert.throws(() => batch.finishRun(p.dataDir, run.runId, {}), /result/, '缺 result 应拒');
    assert.throws(() => batch.finishRun(p.dataDir, run.runId, { result: 'done' }), /result/, '未知 result 应拒');
    assert.throws(() => batch.finishRun(p.dataDir, run.runId, { result: 'reported' }), /reportRef/, 'reported 缺 reportRef 应拒');
    assert.throws(() => batch.finishRun(p.dataDir, run.runId, { result: 'blocked' }), /reason/, 'blocked 缺 reason 应拒');
    assert.throws(() => batch.finishRun(p.dataDir, run.runId, { result: 'failed', reason: 'x'.repeat(300) }), /reason|长度/, '超长 reason 应拒（正文须落盘）');
    assert.throws(() => batch.finishRun(p.dataDir, 'run-20990101-999', { result: 'blocked', reason: 'x' }), /找不到/, '未知 runId 应拒');

    const fin = batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.equal(fin.ok, true);
    const dup = batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.equal(dup.ok, true, '同 runId 相同回执应幂等成功');
    const c1 = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(c1.counts.reported, 1, `幂等重放不得重复计数（得到 ${c1.counts.reported}）`);
    assert.throws(
      () => batch.finishRun(p.dataDir, run.runId, { result: 'failed', reason: '改口' }),
      /回执|重复/,
      '同 runId 不同回执应拒',
    );
    assert.ok(!JSON.stringify(batch.checkBatch(p.dataDir, bt.batchId)).includes(b), '核对摘要不得带全队列');
  } finally { cleanup(p); }
});

// ---------- Z10 证据一致性 ----------

t('Z10 旧 report/未关联 run/错误 owner/未上报 均不能通过 reported 核对', () => {
  const p = mkProject();
  try {
    // 场景 1：未上报就交回执
    const a = mkItem(p, 'requirement', 'A', { backMs: 2000 });
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const runA = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, a, W1);
    assert.throws(() => batch.finishRun(p.dataDir, runA.runId, { result: 'reported', reportRef: 'test-report.md' }), /上报/, '未 report 不得当成功');
    core.report(p.dataDir, a, { summary: 'ok', by: W1 }); // 不带 run 关联
    assert.throws(() => batch.finishRun(p.dataDir, runA.runId, { result: 'reported', reportRef: 'test-report.md' }), /关联|runId/, 'report 未关联本 runId 不得通过');
    core.report(p.dataDir, a, { summary: 'ok2', by: W1, run: { runId: runA.runId } });
    assert.doesNotThrow(() => batch.finishRun(p.dataDir, runA.runId, { result: 'reported', reportRef: 'test-report.md' }), '补齐关联后应通过');

    // 场景 2：旧 report（时间早于 run 创建）重放
    const b = mkItem(p, 'requirement', 'B', { backMs: 1000 });
    core.claim(p.dataDir, b, W1);
    core.report(p.dataDir, b, { summary: '旧报告', by: W1 });
    core.setStatus(p.dataDir, b, 'done', { by: 'tester' }); // 人工验收完成，B 回到可依赖状态
    const c = mkItem(p, 'requirement', 'C');
    const d = mkItem(p, 'requirement', 'D');
    batch.setDependencies(p.dataDir, c, [b]);
    const { batch: bt2 } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const runC = batch.nextItem(p.dataDir, bt2.batchId, { owner: W1 });
    assert.equal(runC.itemId, c, '依赖 done 后 C 可实施');
    core.claim(p.dataDir, c, W1);
    // 伪造 C 的旧报告（at 早于 run 创建）
    const { dir: cDir } = core.resolveItemDir(p.dataDir, c);
    const oldSt = JSON.parse(fs.readFileSync(path.join(cDir, 'status.json'), 'utf8'));
    oldSt.lastReport = { at: '2020-01-01T00:00:00.000Z', coverage: 90, framework: '', summary: '', runId: runC.runId };
    fs.writeFileSync(path.join(cDir, 'status.json'), JSON.stringify(oldSt, null, 2) + '\n');
    fs.writeFileSync(path.join(cDir, 'test-report.md'), 'old');
    assert.throws(() => batch.finishRun(p.dataDir, runC.runId, { result: 'reported', reportRef: 'test-report.md' }), /时间|证据/, '早于本次运行的旧 report 不得通过');
    // 该项核对失败按 failed 收尾（可继续其他项），不得阻塞后续场景
    batch.finishRun(p.dataDir, runC.runId, { result: 'failed', reason: '旧报告核对失败', safeToContinue: true });

    // 场景 3：owner 不一致（条目被写成他人 owner）
    const runD = batch.nextItem(p.dataDir, bt2.batchId, { owner: W1 });
    assert.equal(runD.itemId, d, '应派发冻结候选中的 D');
    core.claim(p.dataDir, d, W1);
    const { dir: dDir } = core.resolveItemDir(p.dataDir, d);
    const dSt = JSON.parse(fs.readFileSync(path.join(dDir, 'status.json'), 'utf8'));
    dSt.owner = 'someone-else';
    fs.writeFileSync(path.join(dDir, 'status.json'), JSON.stringify(dSt, null, 2) + '\n');
    core.report(p.dataDir, d, { summary: 'ok', by: 'someone-else', run: { runId: runD.runId } });
    assert.throws(() => batch.finishRun(p.dataDir, runD.runId, { result: 'reported', reportRef: 'test-report.md' }), /owner/, 'owner 不一致不得通过');
  } finally { cleanup(p); }
});

// ---------- Z11 report 后即可下一项 ----------

t('Z11 reported 后：条目仍 in-progress、互斥释放、可继续派发（不等人工 done）', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 });
    const b = mkItem(p, 'requirement', 'B');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, a, W1);
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });

    const st = core.getItemDetail(p.dataDir, a);
    assert.equal(st.status, 'in-progress', '上报后业务状态保持 in-progress 待人工确认');
    assert.equal(fs.existsSync(path.join(p.dataDir, '.locks', 'impl.lock')), false, '上报即释放实施互斥');

    const run2 = batch.nextItem(p.dataDir, bt.batchId, { owner: 'zcode-batch-fake-w1b' });
    assert.equal(run2.itemId, b, '不等 done 应继续派发下一项');
  } finally { cleanup(p); }
});

// ---------- Z12 环境错误停止批次 ----------

t('Z12 环境错误（failed+safeToContinue=false）：批次转 needs_attention，不再领取其余项', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 });
    const b = mkItem(p, 'requirement', 'B');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, a, W1);
    batch.finishRun(p.dataDir, run.runId, { result: 'failed', reason: '登录失效', safeToContinue: false });

    const chk = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(chk.nextAction, 'needs_attention', '环境错误应 needs_attention');
    assert.equal(batch.getBatch(p.dataDir, bt.batchId).status, 'needs_attention');
    assert.throws(() => batch.nextItem(p.dataDir, bt.batchId, { owner: W1 }), /needs_attention|核对/, 'needs_attention 期间不得再领取');
    assert.equal(core.getItemDetail(p.dataDir, b).status, 'planned', '未领条目保持原状不被逐一标失败');
  } finally { cleanup(p); }
});

// ---------- Z14 暂停 ----------

t('Z14 暂停后续：不领取下一单；在途 run 不受影响；恢复后继续', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 });
    const b = mkItem(p, 'requirement', 'B');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, a, W1);

    batch.pauseBatch(p.dataDir, bt.batchId, true);
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' }); // 在途收尾不受暂停影响

    const stop = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(stop.stop, 'paused', `暂停后 next 应 stop=paused，得到 ${JSON.stringify(stop)}`);
    const chk = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(chk.nextAction, 'stop', '暂停后核对应为 stop');
    assert.ok(chk.notice, 'stop 应带说明');

    batch.pauseBatch(p.dataDir, bt.batchId, false);
    const run2 = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run2.itemId, b, '恢复后可继续领取');
  } finally { cleanup(p); }
});

// ---------- Z15 在途与摘要续接 ----------

t('Z15 在途 run 未收尾：next 拒绝再派（不产生第二实施任务）；摘要含核对信息', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 });
    const b = mkItem(p, 'requirement', 'B');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.throws(() => batch.nextItem(p.dataDir, bt.batchId, { owner: W1 }), /在途|核对|未收尾/, '在途 run 期间不得再派');

    const chk = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(chk.nextAction, 'needs_attention', '在途未收尾 → 待核对，不冒充可继续');
    assert.equal(chk.current.itemId, a, '核对应指明当前项');

    const sum = batch.batchSummary(p.dataDir, bt.batchId);
    assert.equal(sum.batch.batchId, bt.batchId);
    assert.ok(sum.currentRun && sum.currentRun.runId === run.runId, '摘要应含当前执行');
    assert.ok(sum.batch.prompt.includes(bt.batchId), '摘要应可取续接提示词');
    assert.ok(Array.isArray(sum.records), '摘要应含执行记录');
    // 未收尾不得被续接抢占：模拟新主会话同样被拒
    assert.throws(() => batch.nextItem(p.dataDir, bt.batchId, { owner: 'zcode-new-main' }), /在途|核对|未收尾/);
  } finally { cleanup(p); }
});

// ---------- Z21 report 运行关联 ----------

t('Z21 report 带 run 写入 lastReport.runId；不带 run 保持 null 兼容旧调用', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A');
    core.claim(p.dataDir, a, W1);
    core.report(p.dataDir, a, { summary: '旧式', by: W1 });
    assert.equal(core.getItemDetail(p.dataDir, a).lastReport.runId, null, '旧调用 runId 应为 null');
    core.report(p.dataDir, a, { summary: '新式', by: W1, run: { runId: 'run-20990101-001' } });
    assert.equal(core.getItemDetail(p.dataDir, a).lastReport.runId, 'run-20990101-001');
  } finally { cleanup(p); }
});

// ---------- 收尾计数与 check 体积 ----------

t('全批完成：check 返回 stop=finished、计数正确、响应 ≤2KiB', () => {
  const p = mkProject();
  try {
    const ids = [1, 2, 3].map((i) => mkItem(p, 'requirement', `项-${i}`, { backMs: (3 - i) * 1000 }));
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    for (const id of ids) {
      const run = batch.nextItem(p.dataDir, bt.batchId, { owner: `zcode-w-${id}` });
      core.claim(p.dataDir, id, `zcode-w-${id}`);
      core.report(p.dataDir, id, { summary: 'ok', by: `zcode-w-${id}`, run: { runId: run.runId } });
      batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    }
    const chk = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(chk.nextAction, 'stop');
    assert.equal(chk.counts.reported, 3);
    assert.equal(chk.counts.remaining, 0);
    assert.equal(batch.getBatch(p.dataDir, bt.batchId).status, 'finished');
    assert.ok(Buffer.byteLength(JSON.stringify(chk), 'utf8') <= batch.CHECK_MAX_BYTES, '核对响应不超过 2 KiB');
    // 完成后 createBatch 可建新批次（不再幂等返回旧批次）
    mkItem(p, 'requirement', '新一轮');
    const nb = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(nb.created, true, 'finished 批次后可创建新批次');
  } finally { cleanup(p); }
});

// ---------- REQ-20260908-001 批次记录带条目标题 ----------

t('REQ-20260908-001 listRuns 记录带条目标题；条目删除容错空串；既有字段保留', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', '批次记录显示条目标题', { backMs: 2000 });
    mkItem(p, 'requirement', '后续条目');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run.itemId, a, '较早的需求先派发');
    core.claim(p.dataDir, a, W1);
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });

    const { total, records } = batch.listRuns(p.dataDir, bt.batchId, { offset: 0, limit: 20 });
    assert.equal(total, 1);
    const rec = records[0];
    assert.equal(rec.title, '批次记录显示条目标题', '记录应携带条目标题');
    assert.equal(rec.result, 'reported');
    assert.equal(rec.reportRef, 'test-report.md');
    for (const k of ['runId', 'itemId', 'owner', 'result', 'reason', 'reportRef', 'at']) {
      assert.ok(k in rec, `既有字段 ${k} 应保留`);
    }

    // 条目目录被删除（账本记录仍在）：不抛错，title 回退空串
    fs.rmSync(path.join(p.dataDir, 'requirements', a), { recursive: true, force: true });
    const after = batch.listRuns(p.dataDir, bt.batchId, { offset: 0, limit: 20 });
    assert.equal(after.records[0].title, '', '条目删除后 title 应容错为空串');
  } finally { cleanup(p); }
});

// ---------- BUG-20260906-001 全受阻批次核对（Z-A1 回归） ----------

t('BUG-20260906-001 全部依赖受阻：check 应 stop 并带准确受阻计数，不派空 worker', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 }); // 唯一 planned 候选（B 未计划不入批）
    const b = mkItem(p, 'requirement', 'B', { plan: false }); // 前置：仅接受未计划（不进实时队列）且未 done
    assert.equal(batch.setDependencies(p.dataDir, a, [b]).ok, true);
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.deepEqual(bt.candidates, [a], '批次只冻结 A（B 未计划）');

    // 首次核对即无任何可派发候选：stop（主调度不得派 worker）
    const first = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(first.nextAction, 'stop', `全受阻时首次核对应 stop，得到 ${JSON.stringify(first)}`);
    assert.equal(first.counts.blockedPending, 1, '应带准确受阻计数 blockedPending');
    assert.ok(first.notice.includes('受阻'), 'stop 应说明受阻原因');

    const next = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(next.stop, 'blocked', `next 应 stop=blocked，得到 ${JSON.stringify(next)}`);
    assert.equal(next.counts.blockedPending, 1);

    // 回归点：next 收尾置 finished 后，check 不得再返回 continue（否则反复派空 worker）
    const after = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(after.nextAction, 'stop', `next stop=blocked 后核对应 stop，得到 ${JSON.stringify(after)}`);
    assert.equal(after.counts.blockedPending, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(after), 'utf8') <= batch.CHECK_MAX_BYTES, '核对响应不超过 2 KiB');
    assert.equal(batch.getBatch(p.dataDir, bt.batchId).status, 'finished');

    // 依赖满足后动态解除：B 人工 done，A 恢复可派（批次复活，不永久卡死）
    core.setStatus(p.dataDir, b, 'in-progress', { by: 'tester' });
    core.setStatus(p.dataDir, b, 'done', { by: 'tester' });
    const revived = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(revived.nextAction, 'continue', `依赖满足后应恢复 continue，得到 ${JSON.stringify(revived)}`);
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run.itemId, a, '依赖满足后 A 可正常预留');
  } finally { cleanup(p); }
});

t('BUG-20260906-001b 剩余项冻结后被外部认领：check 同口径 stop，不派空 worker', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    forceClaim(p, a, W2); // 模拟他人绕过批次直接认领（冻结后流转出局）
    const chk = batch.checkBatch(p.dataDir, bt.batchId);
    assert.equal(chk.nextAction, 'stop', `冻结后流转应 stop（与 next 的 stop=blocked 口径一致），得到 ${JSON.stringify(chk)}`);
    assert.equal(chk.counts.remaining, 1);
    assert.ok(!chk.counts.blockedPending, '非依赖受阻不得计入 blockedPending');
  } finally { cleanup(p); }
});

// ---------- BUG-20260906-003 失败待核对保留项目占用（Z-A3 回归） ----------

t('BUG-20260906-003 失败且 safeToContinue=false：保留项目实施占用，其他入口一律被拒；人工恢复后解除', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 1000 });
    const b = mkItem(p, 'requirement', 'B');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, a, W1);
    batch.finishRun(p.dataDir, run.runId, { result: 'failed', reason: '遗留改动尚未核对', safeToContinue: false });

    // 回归点：failed 且不可继续时不得释放项目实施占用（否则手工/其他入口可并行实施）
    const lock = core.readImplLockIfExists(p.dataDir);
    assert.ok(lock && lock.attention === true, `应保留带 attention 标记的实施占用，得到 ${JSON.stringify(lock)}`);
    assert.throws(() => core.claim(p.dataDir, b, 'manual-worker'), /暂停|核对/, '他人手工 claim 应被拒（项目暂停）');
    assert.throws(() => core.claim(p.dataDir, b, W1), /暂停|核对/, '锁属主本人也不得绕过失败待核对暂停');
    const got = store.acquireProjectLock(p.dataDir, 'codex-worker');
    assert.equal(got.ok, false, 'Codex 派发获取实施互斥应失败');
    assert.equal(got.holder && got.holder.attention, true, '持锁应标记待核对');
    assert.equal(core.getItemDetail(p.dataDir, b).status, 'planned', '未领条目保持原状不被并行派发');

    // 人工恢复（暂停→恢复）= 已核对遗留改动：解除项目暂停占用
    batch.pauseBatch(p.dataDir, bt.batchId, true);
    assert.equal((core.readImplLockIfExists(p.dataDir) || {}).attention, true, '暂停期间占用保持');
    batch.pauseBatch(p.dataDir, bt.batchId, false);
    assert.equal(core.readImplLockIfExists(p.dataDir), null, '恢复后应解除项目暂停占用');
    const run2 = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run2.itemId, b, '解除后批次继续派发下一项');
  } finally { cleanup(p); }
});

t('BUG-20260906-003b failed 显式 safe=true / blocked 默认安全 / reported：照常释放占用不误伤', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'A', { backMs: 4000 });
    const b = mkItem(p, 'requirement', 'B', { backMs: 2000 });
    const c = mkItem(p, 'requirement', 'C');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });

    const runA = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, a, W1);
    batch.finishRun(p.dataDir, runA.runId, { result: 'failed', reason: '单项核对失败', safeToContinue: true });
    assert.equal(core.readImplLockIfExists(p.dataDir), null, 'failed 但声明可继续：照常释放占用');

    const runB = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, b, W1);
    batch.finishRun(p.dataDir, runB.runId, { result: 'blocked', reason: '依赖信息缺失' });
    assert.equal(core.readImplLockIfExists(p.dataDir), null, 'blocked 默认安全：照常释放占用');

    const runC = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    core.claim(p.dataDir, c, W1);
    core.report(p.dataDir, c, { summary: 'ok', by: W1, run: { runId: runC.runId } });
    batch.finishRun(p.dataDir, runC.runId, { result: 'reported', reportRef: 'test-report.md' });
    assert.equal(core.readImplLockIfExists(p.dataDir), null, 'reported：照常释放占用');
  } finally { cleanup(p); }
});

// ---------- 运行记录分页 ----------

t('执行记录分页：listRuns 按 runId 倒序、支持 offset/limit', () => {
  const p = mkProject();
  try {
    const ids = [1, 2, 3].map((i) => mkItem(p, 'requirement', `项-${i}`, { backMs: (3 - i) * 1000 }));
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    for (const id of ids) {
      const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
      core.claim(p.dataDir, id, W1);
      core.report(p.dataDir, id, { summary: 'ok', by: W1, run: { runId: run.runId } });
      batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    }
    const all = batch.listRuns(p.dataDir, bt.batchId, {});
    assert.equal(all.total, 3);
    assert.equal(all.records.length, 3);
    const page = batch.listRuns(p.dataDir, bt.batchId, { offset: 1, limit: 1 });
    assert.equal(page.records.length, 1, '分页应生效');
    assert.ok(page.records[0].itemId && page.records[0].result === 'reported' && page.records[0].at, '记录应含编号/结果/时间');
  } finally { cleanup(p); }
});

// ---------- REQ-20260910-027 开发人员设置移除（原 REQ-20260907-002 账本字段与命名指令下线） ----------

t('D1 createBatch 带 developer：参数忽略、账本不落 developer、提示词无会话命名指令', () => {
  const p = mkProject();
  try {
    mkItem(p, 'requirement', 'A');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root, developer: '张三' });
    assert.equal('developer' in bt, false, '账本不应再写 developer 字段');
    assert.ok(!bt.prompt.includes('会话名'), '提示词不应含会话命名指令');
    assert.equal('developer' in batch.getBatch(p.dataDir, bt.batchId), false, '账本落盘不应含 developer');
  } finally { cleanup(p); }
});

t('D2 不填 developer：账本无字段、提示词与现状逐字一致（不回归）', () => {
  const p = mkProject();
  try {
    mkItem(p, 'requirement', 'A');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal('developer' in bt, false, '账本不应有 developer 字段');
    assert.ok(!bt.prompt.includes('会话名'), '不得追加会话命名指令或缺省名');
    const spec = path.join(p.dataDir, 'dispatch', 'worker-spec.md');
    const legacy = batch.generatePrompt({ projectRoot: p.root, batchId: bt.batchId, workerSpecPath: spec });
    const now = batch.generatePrompt({ projectRoot: p.root, batchId: bt.batchId, workerSpecPath: spec, developer: '张三' });
    assert.equal(now, legacy, 'developer 传值时 generatePrompt 输出必须与不传逐字一致（参数忽略）');
  } finally { cleanup(p); }
});

t('D3 developer 校验随功能移除：超长/换行/控制字符不再拒绝（一律忽略）；无批次副作用口径保留', () => {
  const p = mkProject();
  try {
    mkItem(p, 'requirement', 'A');
    const bad = batch.createBatch(p.dataDir, { projectRoot: p.root, developer: 'x'.repeat(31) });
    assert.ok(bad.batch.batchId, '超长 developer 应被忽略而不是拒绝');
    assert.equal('developer' in bad.batch, false, '忽略后账本无 developer 字段');
    assert.ok(!bad.batch.prompt.includes('会话名'), '提示词不含命名指令');
  } finally { cleanup(p); }
});

t('D4 batchSummary 新批次无 developer；存量批次含字段不迁移、摘要仍正常（展示层不透出）', () => {
  const p = mkProject();
  try {
    mkItem(p, 'requirement', 'A');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const sum = batch.batchSummary(p.dataDir, bt.batchId);
    assert.equal('developer' in sum.batch, false, '新批次摘要不应携带 developer');
    // 模拟存量批次：账本手工写入 developer 字段，不迁移不清洗（batchSummary 透传账本原样）
    const bfile = path.join(p.dataDir, 'dispatch', 'batches', bt.batchId, 'batch.json');
    const saved = JSON.parse(fs.readFileSync(bfile, 'utf8'));
    saved.developer = '存量开发';
    fs.writeFileSync(bfile, JSON.stringify(saved, null, 2) + '\n');
    const sum2 = batch.batchSummary(p.dataDir, bt.batchId);
    assert.equal(sum2.batch.batchId, bt.batchId, '存量批次摘要应仍正常返回');
    assert.equal(sum2.batch.developer, '存量开发', '账本字段保留不迁移（读取正常；透出侧已移除）');
    assert.equal('developer' in batch.batchBrief(p.dataDir, bt.batchId), false, 'batchBrief 不透出 developer');
  } finally { cleanup(p); }
});

// ---------- REQ-20260906-023 批次保留上限：最多 100 个，超出删最旧 ----------

const batchesDirOf = (p) => path.join(p.dataDir, 'dispatch', 'batches');
const batchDirNames = (p) => fs.readdirSync(batchesDirOf(p)).sort();

// 构造一个已收尾批次（创建 → 领取 → 认领 → 上报 → 回执，批次自然 finished），返回 batchId
function mkFinishedBatch(p, i) {
  const id = mkItem(p, 'requirement', `R23-${i}`);
  const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
  const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
  core.claim(p.dataDir, id, W1);
  core.report(p.dataDir, id, { summary: 'ok', by: W1, run: { runId: run.runId } });
  batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
  return bt.batchId;
}

// 手动把批次标记为「在途」（等价 nextItem 预留后未收尾；避免真占 impl 锁阻塞后续批次流程）
function forceInFlight(p, batchId) {
  const bfile = path.join(batchesDirOf(p), batchId, 'batch.json');
  const bt = JSON.parse(fs.readFileSync(bfile, 'utf8'));
  const runId = `run-fake-${batchId}`;
  const rdir = path.join(p.dataDir, 'dispatch', 'runs', runId);
  fs.mkdirSync(rdir, { recursive: true });
  fs.writeFileSync(path.join(rdir, 'run.json'), JSON.stringify({
    runId, batchId, itemId: bt.candidates[0], owner: W1, phase: 'reserved',
  }));
  bt.currentRunId = runId;
  fs.writeFileSync(bfile, JSON.stringify(bt, null, 2) + '\n');
  return runId;
}

t('R23-01 pruneBatches：删最旧、留最新（按 createdAt/batchId 序）', () => {
  const p = mkProject();
  try {
    const ids = [];
    for (let i = 1; i <= 5; i++) ids.push(mkFinishedBatch(p, i));
    const r = batch.pruneBatches(p.dataDir, 3);
    assert.deepEqual(r.removed, ids.slice(0, 2), `应删最旧 2 个，得到 ${JSON.stringify(r)}`);
    assert.deepEqual(batchDirNames(p), ids.slice(2).sort(), '应保留最新 3 个批次目录');
    assert.equal(r.kept, 3, 'kept 应为保留数');
  } finally { cleanup(p); }
});

t('R23-02 pruneBatches：总数 ≤ keep 时不删任何批次', () => {
  const p = mkProject();
  try {
    for (let i = 1; i <= 3; i++) mkFinishedBatch(p, i);
    const r = batch.pruneBatches(p.dataDir, 5);
    assert.deepEqual(r.removed, [], '不应删除任何批次');
    assert.equal(r.kept, 3);
    assert.equal(batchDirNames(p).length, 3);
  } finally { cleanup(p); }
});

t('R23-03 在途保护：未收尾运行的批次跳过不删，其余更旧照常删', () => {
  const p = mkProject();
  try {
    const ids = [];
    for (let i = 1; i <= 5; i++) ids.push(mkFinishedBatch(p, i));
    forceInFlight(p, ids[1]); // 第 2 旧批次标记在途
    const r = batch.pruneBatches(p.dataDir, 3);
    assert.deepEqual(r.removed, [ids[0]], `只应删最旧 1 个，得到 ${JSON.stringify(r.removed)}`);
    const left = batchDirNames(p);
    assert.ok(left.includes(ids[1]), '在途批次目录必须保留');
    assert.deepEqual(left, [ids[1], ...ids.slice(2)].sort(), '除在途保护外保留最新 3 个');
    assert.equal(r.kept, 4);
  } finally { cleanup(p); }
});

t('R23-04 createBatch 集成：真实路径创建第 102 个批次后恰剩 100 个，最旧 2 个被删', () => {
  const p = mkProject();
  try {
    const ids = [];
    for (let i = 1; i <= 100; i++) ids.push(mkFinishedBatch(p, i));
    assert.equal(batchDirNames(p).length, 100, '恰 100 个时创建不触发清理');
    // 第 101 个批次创建瞬间总数 101 → 删最旧 1 个；收尾后第 102 个再删次旧 1 个
    ids.push(mkFinishedBatch(p, 101));
    assert.equal(batchDirNames(p).length, 100, '超限后每次创建应清理回 100');
    assert.ok(!batchDirNames(p).includes(ids[0]), '第 101 次创建应已删除最旧批次');
    mkItem(p, 'requirement', 'R23-102');
    const { batch: bt, created, pruned } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(created, '第 102 个批次应新建');
    assert.ok(Array.isArray(pruned.removed), 'createBatch 应返回 pruned 清理结果');
    assert.deepEqual(pruned.removed, [ids[1]], `应恰删次旧 1 个（最旧已删），得到 ${JSON.stringify(pruned.removed)}`);
    const left = batchDirNames(p);
    assert.equal(left.length, 100, '批次目录应恰剩 100 个');
    assert.ok(!left.includes(ids[0]) && !left.includes(ids[1]), '最旧 2 个应已删除');
    assert.ok(left.includes(bt.batchId) && left.includes(ids[99]), '最新端批次（含刚创建的）必须保留');
    assert.equal((batch.latestBatch(p.dataDir) || {}).batchId, bt.batchId, 'latestBatch 仍指向最新批次');
  } finally { cleanup(p); }
});

t('R23-05 幂等创建不触发清理；未超上限创建不删任何批次', () => {
  const p = mkProject();
  try {
    mkItem(p, 'requirement', 'A');
    const first = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(first.created);
    assert.deepEqual(first.pruned.removed, [], '未超上限不应删除');
    const again = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.equal(again.created, false, '未结束批次内重复创建应幂等返回');
    assert.equal(again.pruned, undefined, '幂等返回不应携带清理结果（未触发）');
    assert.equal(batchDirNames(p).length, 1);
  } finally { cleanup(p); }
});

// ---------- BUG-20260908-023 终态批次暂停幂等拒绝 ----------

t('BUG-20260908-023 终态批次暂停幂等拒绝：abort 后 pause(true)/(false) 字段全不变；正常 finished 批次同样不复活', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', '终止后暂停');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    batch.abortBatch(p.dataDir, bt.batchId);
    const before = batch.getBatch(p.dataDir, bt.batchId);
    assert.equal(before.status, 'finished');
    assert.equal(before.abortRequested, true);
    assert.equal(before.aborted, true);
    assert.equal(batch.batchTerminalReason(before), '任务已人工终止，不能暂停/恢复', '终止批次应返回可读终态原因');

    // abort 后 pause(true)：幂等拒绝——status/abortRequested/aborted/pauseRequested/currentRunId 与调用前一致
    const r1 = batch.pauseBatch(p.dataDir, bt.batchId, true);
    const a1 = batch.getBatch(p.dataDir, bt.batchId);
    assert.equal(a1.status, 'finished', 'abort 后 pause(true) 不得复活为 paused');
    for (const k of ['status', 'abortRequested', 'aborted', 'pauseRequested', 'currentRunId']) {
      assert.equal(a1[k], before[k], `${k} 应保持调用前的值`);
    }
    assert.equal(r1.status, 'finished', '返回值亦保持终态');

    // abort 后 pause(false)（恢复方向）：同样不得把 finished 翻回 running
    batch.pauseBatch(p.dataDir, bt.batchId, false);
    const a2 = batch.getBatch(p.dataDir, bt.batchId);
    for (const k of ['status', 'abortRequested', 'aborted', 'pauseRequested', 'currentRunId']) {
      assert.equal(a2[k], before[k], `恢复方向 ${k} 应保持调用前的值`);
    }

    // 终态批次不得因暂停请求重新进入未结束队列/队首
    assert.deepEqual(batch.unfinishedBatches(p.dataDir).map((x) => x.batchId), [], '终态批次不入未结束队列');
    assert.equal(batch.queueHeadBatch(p.dataDir), null, '队首不得是复活的终态批次');

    // 非终止的正常 finished 批次（全部回执收尾）同样拒绝暂停复活
    // 被终止批次回置未处理的 a 仍是候选：新批次把它与新增项一并冻结，逐项收尾直至自然结束
    const b = mkItem(p, 'requirement', '正常结束');
    const { batch: bt2 } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    let got = batch.nextItem(p.dataDir, bt2.batchId, { owner: W1 });
    while (got && got.itemId) {
      core.claim(p.dataDir, got.itemId, W1);
      core.report(p.dataDir, got.itemId, { summary: 'ok', by: W1, run: { runId: got.runId } });
      batch.finishRun(p.dataDir, got.runId, { result: 'reported', reportRef: 'test-report.md' });
      const nx = batch.nextItem(p.dataDir, bt2.batchId, { owner: W1 });
      if (!nx || nx.stop) break;
      got = nx;
    }
    const fin = batch.getBatch(p.dataDir, bt2.batchId);
    assert.equal(fin.status, 'finished', '全部回执后批次应自然收尾');
    assert.equal(batch.batchTerminalReason(fin), '任务已结束，不能暂停/恢复', '正常结束批次应返回可读终态原因');
    batch.pauseBatch(p.dataDir, bt2.batchId, true);
    const a3 = batch.getBatch(p.dataDir, bt2.batchId);
    assert.equal(a3.status, 'finished', '正常 finished 批次 pause(true) 同样不得复活为 paused');
    assert.equal(a3.pauseRequested, false, '不得写入 pauseRequested');
    batch.pauseBatch(p.dataDir, bt2.batchId, false);
    assert.equal(batch.getBatch(p.dataDir, bt2.batchId).status, 'finished', '恢复方向同样保持 finished');

    // 正常批次的暂停/恢复回归：非终态批次不受终态守卫影响
    mkItem(p, 'requirement', '暂停回归');
    mkItem(p, 'requirement', '恢复回归');
    const { batch: bt3 } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    batch.pauseBatch(p.dataDir, bt3.batchId, true);
    assert.equal(batch.getBatch(p.dataDir, bt3.batchId).pauseRequested, true, '正常批次暂停照常生效');
    const stop = batch.nextItem(p.dataDir, bt3.batchId, { owner: W1 });
    assert.equal(stop.stop, 'paused', '暂停后 next 应 stop=paused');
    batch.pauseBatch(p.dataDir, bt3.batchId, false);
    const run3 = batch.nextItem(p.dataDir, bt3.batchId, { owner: W1 });
    assert.ok(run3.itemId, '恢复后可继续领取');
  } finally { cleanup(p); }
});

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
