#!/usr/bin/env node
// REQ-20260908-026 优化批量任务管理界面与 Agent 配置 —— 数据层测试
// 覆盖：执行记录「重新执行」（批量开发 retryRun / 批量完善 retryRefineRun：核验占用、
//       重排队、保留原记录、幂等、尝试次数字段）、任务设置全部隐藏合法化。
// 用法：node scripts/tests/tasks-retry.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  return { root, dataDir };
}

function mkDevItem(p, title, { backMs = 0 } = {}) {
  const st = core.createItem(p.dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(p.dataDir, st.id, 'accepted', { by: 'human' });
  core.setStatus(p.dataDir, st.id, 'planned', { by: 'human' });
  if (backMs) {
    const dir = core.resolveItemDir(p.dataDir, st.id).dir;
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    s.createdAt = new Date(Date.parse(s.createdAt) - backMs).toISOString();
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(s, null, 2) + '\n');
  }
  return st.id;
}

function mkRefineItem(p, title) {
  const st = core.createItem(p.dataDir, { type: 'bug', title, description: 'x', by: 'tester' });
  core.setStatus(p.dataDir, st.id, 'accepted', { by: 'human' });
  return st.id;
}

function readItemSt(p, id) {
  return JSON.parse(fs.readFileSync(path.join(core.resolveItemDir(p.dataDir, id).dir, 'status.json'), 'utf8'));
}

const W1 = 'zcode-retry-w1';

// ---------- 批量开发：重新执行 ----------

t('D1 retryRun：failed 记录重排队——原记录保留、计数改记待处理、领取产生新尝试', () => {
  const p = mkProject('atb-retry-dev-');
  const a = mkDevItem(p, '失败后重试', { backMs: 2000 });
  const b0 = mkDevItem(p, '另一项');
  const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
  assert.deepEqual(b.candidates, [], '建轮不冻结候选快照（REQ-20260913-003）');
  const r1 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
  assert.equal(r1.itemId, a);
  batch.finishRun(p.dataDir, r1.runId, { result: 'failed', reason: '子代理执行超时', safeToContinue: true });

  const before = batch.listRuns(p.dataDir, b.batchId);
  assert.equal(before.total, 1, '重试前仅一次执行账');

  const r = batch.retryRun(p.dataDir, r1.runId);
  assert.equal(r.ok, true, 'failed 记录可重新执行');
  assert.equal(r.itemId, a);
  // 原记录保留（不覆盖失败原因与执行次数），账本追加而不改写
  assert.equal(batch.listRuns(p.dataDir, b.batchId).total, 1, '重排队只标记，不创建在途执行');
  // 计数：failed 不再计入，改记待处理
  const counts = batch.batchSummary(p.dataDir, b.batchId).counts;
  assert.equal(counts.failed, 0, '重试后不计入异常计数');
  assert.equal(counts.remaining, 2, '重试后改记待处理（含另一项）');

  // 重新领取：新运行创建，尝试次数 +1，retry 标记清除
  const r2 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
  assert.equal(r2.itemId, a, '重排队后下一单重新领取该条目');
  const runs = batch.listRuns(p.dataDir, b.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.total, 2, '两次执行尝试都留账');
  const byId = Object.fromEntries(runs.records.map((x) => [x.runId, x]));
  assert.equal(byId[r1.runId].result, 'failed', '原失败记录保留');
  assert.equal(byId[r1.runId].reason, '子代理执行超时', '原失败原因不被覆盖');
  assert.equal(byId[r1.runId].attempt, 1, '原记录为第 1 次');
  assert.equal(byId[r2.runId].attempt, 2, '新一次执行记为第 2 次');
  assert.ok(!batch.getBatch(p.dataDir, b.batchId).retryItems
    || !Object.keys(batch.getBatch(p.dataDir, b.batchId).retryItems).length, '领取后重试标记清除');
});

t('D2 retryRun 核验：在途执行 / 已上报 / 已认领条目 / 待核对批次均拒绝并给指引', () => {
  const p = mkProject('atb-retry-guard-');
  const a = mkDevItem(p, '占用核验', { backMs: 1000 });
  const b0 = mkDevItem(p, '伴随项');
  const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
  const r1 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });

  // 在途执行（未收尾）：同条目不得重复派发
  assert.throws(() => batch.retryRun(p.dataDir, r1.runId), /在途|未收尾/, '在途执行拒绝重试');

  // 已上报（reported）不是异常记录：拒绝
  core.claim(p.dataDir, a, W1);
  core.report(p.dataDir, a, { summary: '完成', by: W1, run: { runId: r1.runId } });
  batch.finishRun(p.dataDir, r1.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.throws(() => batch.retryRun(p.dataDir, r1.runId), /reported|已上报/, '已上报记录不得重试');

  // failed 且条目仍被认领（in-progress + owner）：不自动改业务状态，拒绝并给人工指引
  const p2 = mkProject('atb-retry-claim-');
  const a2 = mkDevItem(p2, '认领后失败', { backMs: 1000 });
  const b2v = mkDevItem(p2, '伴随项');
  const { batch: b2 } = batch.createBatch(p2.dataDir, { projectRoot: p2.root });
  const r2 = batch.nextItem(p2.dataDir, b2.batchId, { owner: W1 });
  core.claim(p2.dataDir, a2, W1);
  batch.finishRun(p2.dataDir, r2.runId, { result: 'failed', reason: '实施失败', safeToContinue: true });
  assert.throws(() => batch.retryRun(p2.dataDir, r2.runId), /认领|in-progress|人工/, '被认领条目拒绝自动重试');
  assert.equal(readItemSt(p2, a2).status, 'in-progress', '条目业务状态不被自动修改');
  assert.equal(readItemSt(p2, b2v).status, 'planned', '其他条目不受影响');

  // failed 且不可继续（needs_attention 项目暂停）：拒绝并指引先恢复领取
  const p3 = mkProject('atb-retry-att-');
  const a3 = mkDevItem(p3, '环境失败', { backMs: 1000 });
  mkDevItem(p3, '伴随项');
  const { batch: b3 } = batch.createBatch(p3.dataDir, { projectRoot: p3.root });
  const r3 = batch.nextItem(p3.dataDir, b3.batchId, { owner: W1 });
  batch.finishRun(p3.dataDir, r3.runId, { result: 'failed', reason: '环境错误', safeToContinue: false });
  assert.equal(batch.getBatch(p3.dataDir, b3.batchId).status, 'needs_attention', '批次待核对');
  assert.throws(() => batch.retryRun(p3.dataDir, r3.runId), /待人工核对|恢复/, '待核对批次拒绝重试');
});

t('D3 retryRun：interrupted（已中断）与幂等；终态任务拒绝并指引走新一轮', () => {
  const p = mkProject('atb-retry-int-');
  const a = mkDevItem(p, '中断后重试');
  const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root, ids: [a] });
  const r1 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
  batch.releaseReservation(p.dataDir, r1.runId, { reason: '认领冲突' });
  // interrupted 记录：条目未认领、无在途 → 重试放行（本身也已回到待处理，幂等语义）
  const r = batch.retryRun(p.dataDir, r1.runId);
  assert.equal(r.ok, true, 'interrupted 记录可重试');
  assert.equal(r.itemId, a);
  // 重复点击：不报错、不产生重复在途
  const again = batch.retryRun(p.dataDir, r1.runId);
  assert.equal(again.ok, true, '重复重试幂等');
  assert.equal(batch.listRuns(p.dataDir, b.batchId).total, 1, '无重复执行账');

  // 终态任务（已结束）：重试入口拒绝并指引通过新一轮任务承接
  const r2 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
  core.claim(p.dataDir, a, W1);
  core.report(p.dataDir, a, { summary: '完成', by: W1, run: { runId: r2.runId } });
  batch.finishRun(p.dataDir, r2.runId, { result: 'reported', reportRef: 'test-report.md' });
  assert.equal(batch.getBatch(p.dataDir, b.batchId).status, 'finished', '批次已结束');
  assert.throws(() => batch.retryRun(p.dataDir, r1.runId), /已结束|新一轮/, '终态批次指引走新一轮');
});

// ---------- 批量完善：重新执行 ----------

t('D4 retryRefineRun：failed 记录重排队尾——原记录保留、计数改记待处理、下一单重新领取', () => {
  const p = mkProject('atb-retry-refine-');
  const a = mkRefineItem(p, '完善失败重试');
  const b0 = mkRefineItem(p, '后一项');
  const { batch: b } = refine.createRefineBatch(p.dataDir, { mode: 'zcode', projectRoot: p.root });
  assert.deepEqual(b.candidates, [], '建轮不冻结候选快照（REQ-20260913-003）');
  const r1 = refine.nextRefineItem(p.dataDir, b.batchId, { owner: W1 });
  assert.equal(r1.itemId, a);
  refine.finishRefineRun(p.dataDir, r1.runId, { result: 'failed', reason: '子代理超时' });

  const r = refine.retryRefineRun(p.dataDir, r1.runId);
  assert.equal(r.ok, true);
  assert.equal(r.itemId, a);
  // 重排队尾：下一单先领 b0，再领 a（第 2 次尝试）
  const r2 = refine.nextRefineItem(p.dataDir, b.batchId, { owner: W1 });
  assert.equal(r2.itemId, b0, '重排队尾不抢占当前顺序');
  refine.finishRefineRun(p.dataDir, r2.runId, { result: 'failed', reason: '跳过占位' });
  const r3 = refine.nextRefineItem(p.dataDir, b.batchId, { owner: W1 });
  assert.equal(r3.itemId, a, '重试条目被重新领取');
  const runs = refine.listRefineRuns(p.dataDir, b.batchId, { offset: 0, limit: 20 });
  const byId = Object.fromEntries(runs.records.map((x) => [x.runId, x]));
  assert.equal(byId[r1.runId].result, 'failed', '原失败记录保留');
  assert.equal(byId[r1.runId].attempt, 1, '原记录第 1 次');
  assert.equal(byId[r3.runId].attempt, 2, '重试执行第 2 次');
});

t('D5 retryRefineRun 核验：在途 / done / 条目离开 accepted / 终态任务拒绝', () => {
  const p = mkProject('atb-retry-rf-guard-');
  const a = mkRefineItem(p, '完善重试核验');
  mkRefineItem(p, '伴随项');
  const { batch: b } = refine.createRefineBatch(p.dataDir, { mode: 'zcode', projectRoot: p.root });
  const r1 = refine.nextRefineItem(p.dataDir, b.batchId, { owner: W1 });
  assert.equal(r1.itemId, a);
  // 在途：拒绝
  assert.throws(() => refine.retryRefineRun(p.dataDir, r1.runId), /在途|未收尾/, '在途执行拒绝');
  refine.finishRefineRun(p.dataDir, r1.runId, { result: 'failed', reason: 'x' });
  // 条目离开 accepted（人工移入计划）：拒绝且不改状态
  core.setStatus(p.dataDir, a, 'planned', { by: 'human' });
  assert.throws(() => refine.retryRefineRun(p.dataDir, r1.runId), /accepted|已接受/, '非 accepted 拒绝');
  assert.equal(readItemSt(p, a).status, 'planned', '条目状态不被自动修改');
  core.setStatus(p.dataDir, a, 'accepted', { by: 'human' });
  // 幂等：重复重试不报错
  assert.equal(refine.retryRefineRun(p.dataDir, r1.runId).ok, true);
  assert.equal(refine.retryRefineRun(p.dataDir, r1.runId).ok, true, '重复重试幂等');
});

// ---------- 任务设置：全部隐藏合法 ----------

t('D6 设置允许全部隐藏：可保存、visibleAgents 为空（启动区据此禁用并提示）', () => {
  const p = mkProject('atb-retry-ts-');
  const s = taskSettings.saveTaskSettings(p.dataDir, { agents: { refine: [] } });
  assert.deepEqual(s.agents.refine, [], 'refine 可全部隐藏（REQ-20260908-026）');
  const loaded = taskSettings.loadTaskSettings(p.dataDir);
  assert.deepEqual(taskSettings.visibleAgents(loaded, 'refine'), [], '隐藏后启动候选为空');
  assert.deepEqual(taskSettings.visibleAgents(loaded, 'develop'), ['zcode', 'codex'], '另一类不受影响');
  // 存量配置迁移：已保存的选择保留
  const s2 = taskSettings.saveTaskSettings(p.dataDir, { agents: { refine: ['codex'] }, models: { refine: { codex: { model: 'm1', level: 'low' } } } });
  assert.deepEqual(s2.agents.refine, ['codex']);
  const l2 = taskSettings.loadTaskSettings(p.dataDir);
  assert.equal(l2.models.refine.codex.model, 'm1');
  assert.equal(l2.models.refine.codex.level, 'low');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
