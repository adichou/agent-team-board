#!/usr/bin/env node
// REQ-20260906-003 ExecutionVerifier —— 完成证据核对：runId/owner/条目/新 report/报告文件（C08）
// 用法：node scripts/tests/execution-verifier.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../lib/core.mjs';
import * as store from '../lib/dispatch-store.mjs';
import { verifyCompletion } from '../lib/execution-verifier.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-verify-'));
  core.initData(root);
  return root;
}

// 造一个「已接受 → 已认领」的条目；ownerMode: self=以单号认领，other=他人认领
function claimedItem(root, { ownerMode = 'self' } = {}) {
  const dataDir = core.requireDataDir(root);
  const st = core.createItem(dataDir, { type: 'requirement', title: '核对目标', by: 't' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'human' });
  core.claim(dataDir, st.id, ownerMode === 'self' ? st.id : 'someone-else');
  return { dataDir, id: st.id };
}

// 直接写 report 夹具（core.report 用当前时间，这里需要可回拨的时间与可控 runId）
// runId: 写入 lastReport.runId——null 模拟「未带 --run 的旧式兼容调用」
function writeReportFixture(dataDir, id, { reportAt, reportExists = true, runId = null } = {}) {
  const dir = core.resolveItemDir(dataDir, id).dir;
  if (reportExists) fs.writeFileSync(path.join(dir, 'test-report.md'), '# 报告\n通过');
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  status.agentCompletedAt = reportAt;
  status.lastReport = { at: reportAt, coverage: 80, framework: 'node:test', summary: 'x', runId };
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  // 状态守卫只拦 Agent 工具调用，测试进程直改文件构造夹具是可控的
}

function claimedAndReported(root, { ownerMode = 'self', reportAt = null, reportExists = true, runId = null } = {}) {
  const { dataDir, id } = claimedItem(root, { ownerMode });
  if (reportAt) writeReportFixture(dataDir, id, { reportAt, reportExists, runId });
  return { dataDir, id };
}

function runFor(dataDir, root, itemId, startedAt) {
  const run = store.newRun(dataDir, { itemId, projectRoot: root, prompt: 'p', config: { timeoutMin: 5 } });
  return store.updateRun(dataDir, run.runId, { startedAt });
}

t('V1 合法新上报：owner/时间/runId 关联/报告文件齐全 → reported', () => {
  const root = tempProject();
  const started = '2026-09-06T04:00:00.000Z';
  const { dataDir, id } = claimedItem(root);
  const run = runFor(dataDir, root, id, started);
  writeReportFixture(dataDir, id, { reportAt: '2026-09-06T04:05:00.000Z', runId: run.runId });
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, true);
  assert.equal(r.reason, null);
  assert.equal(r.checks.owner, true);
  assert.equal(r.checks.newReport, true);
  assert.equal(r.checks.reportRun, true);
});

t('V2 退出码 0 但 worker 从未认领 → 不成功（不能假成功）', () => {
  const root = tempProject();
  const dataDir = core.requireDataDir(root);
  const st = core.createItem(dataDir, { type: 'requirement', title: '未认领', by: 't' });
  const run = runFor(dataDir, root, st.id, '2026-09-06T04:00:00.000Z');
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, false);
  assert.equal(r.reason, 'worker-did-not-claim');
});

t('V3 owner 不符（他人/手工认领）→ owner-mismatch，不算本次执行成果', () => {
  const root = tempProject();
  const started = '2026-09-06T04:00:00.000Z';
  const { dataDir, id } = claimedAndReported(root, { ownerMode: 'other', reportAt: '2026-09-06T04:05:00.000Z' });
  const run = runFor(dataDir, root, id, started);
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, false);
  assert.equal(r.reason, 'owner-mismatch');
});

t('V4 旧 report 顶替：agentCompletedAt 早于本次开始 → no-new-report（排除旧上报误用）', () => {
  const root = tempProject();
  const { dataDir, id } = claimedAndReported(root, { reportAt: '2026-09-06T03:00:00.000Z' });
  const run = runFor(dataDir, root, id, '2026-09-06T04:00:00.000Z');
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, false);
  assert.equal(r.reason, 'no-new-report');
});

t('V5 状态有 agentCompletedAt 但报告文件缺失/为空 → no-report-file', () => {
  const root = tempProject();
  const started = '2026-09-06T04:00:00.000Z';
  const { dataDir, id } = claimedItem(root);
  const run = runFor(dataDir, root, id, started);
  writeReportFixture(dataDir, id, { reportAt: '2026-09-06T04:05:00.000Z', reportExists: false, runId: run.runId });
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, false);
  assert.equal(r.reason, 'no-report-file');
});

t('V6 条目已 done（人工先确认了）→ 视为已上报完成（幂等核对）', () => {
  const root = tempProject();
  const started = '2026-09-06T04:00:00.000Z';
  const { dataDir, id } = claimedAndReported(root, { reportAt: '2026-09-06T04:05:00.000Z' });
  core.setStatus(dataDir, id, 'done', { by: 'human' });
  const run = runFor(dataDir, root, id, started);
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, true, '人工已确认完成时按幂等成功核对');
});

t('V7 (BUG-20260906-004) run 有 runId 但新 report 未带 --run（旧式兼容调用）→ 不算本次完成证据', () => {
  const root = tempProject();
  const started = '2026-09-06T04:00:00.000Z';
  const { dataDir, id } = claimedItem(root);
  const run = runFor(dataDir, root, id, started);
  writeReportFixture(dataDir, id, { reportAt: '2026-09-06T04:05:00.000Z', runId: null });
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, false);
  assert.equal(r.reason, 'report-run-missing');
  assert.equal(r.checks.newReport, true, '时间上确是新报告，但缺 run 关联仍拒绝');
  assert.equal(r.checks.reportRun, false);
});

t('V8 新 report 关联其他 runId（他次执行/旧报告重放）→ report-run-mismatch', () => {
  const root = tempProject();
  const started = '2026-09-06T04:00:00.000Z';
  const { dataDir, id } = claimedItem(root);
  const run = runFor(dataDir, root, id, started);
  writeReportFixture(dataDir, id, { reportAt: '2026-09-06T04:05:00.000Z', runId: 'run-other-2026' });
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, false);
  assert.equal(r.reason, 'report-run-mismatch');
});

t('V9 (对齐探针 C-A1) core.report 真实入口未传 run → verifyCompletion 拒绝', () => {
  const root = tempProject();
  const dataDir = core.requireDataDir(root);
  const st = core.createItem(dataDir, { type: 'requirement', title: '探针对齐', by: 't' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'human' });
  // BUG-20260908-005：startedAt 必须回拨到过去，保证真实 core.report 写入的
  // agentCompletedAt/lastReport.at 严格晚于 startedAt；用真实当前时刻会与 report 同毫秒，
  // verifyCompletion 严格大于判定不成立 → 提前走 no-new-report 分支（偶发失败）。
  const run = runFor(dataDir, root, st.id, new Date(Date.now() - 60_000).toISOString());
  core.claim(dataDir, st.id, st.id);
  core.report(dataDir, st.id, { by: st.id, framework: 'fixture', summary: '缺少 runId 的报告' });
  const detail = core.getItemDetail(dataDir, st.id);
  assert.equal(detail.lastReport.runId, null);
  const r = verifyCompletion({ run, dataDir });
  assert.equal(r.reported, false);
  assert.equal(r.reason, 'report-run-missing');
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
