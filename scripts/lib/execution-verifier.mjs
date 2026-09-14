// REQ-20260906-003 ExecutionVerifier —— 完成证据核对。
// 仅退出码 0、turn.completed 或「已完成」文字不足以进入 reported；必须核对：
//   本次 runId 关联的条目、owner（worker 按提示词以单号认领）、新的 report
//   （agentCompletedAt / lastReport.at 晚于本次 startedAt，且显式关联本次 runId——
//   BUG-20260906-004：未带 --run 的旧式兼容调用不构成自动执行的完成证据）、
//   报告文件真实存在且非空。
// 输出只描述事实（reported 与原因），不改条目业务状态。

import fs from 'node:fs';
import path from 'node:path';
import { getItemDetail, resolveItemDir } from './core.mjs';

// run.owner：恢复场景下已记录的执行 owner；提示词约定 worker 以单号认领（会话名=单号）
function expectedOwners(run) {
  const set = new Set([run.itemId]);
  if (run.owner) set.add(run.owner);
  return set;
}

export function verifyCompletion({ run, dataDir }) {
  let item;
  try {
    item = getItemDetail(dataDir, run.itemId);
  } catch {
    return { reported: false, reason: 'item-missing', checks: {} };
  }

  const checks = {
    claimed: item.status === 'in-progress' || item.status === 'done',
    owner: !!item.owner && expectedOwners(run).has(item.owner),
  };

  // 人工已确认完成（done）：report 证据已被人验收过，按幂等成功核对
  if (item.status === 'done' && item.agentCompletedAt && item.agentCompletedAt > run.startedAt) {
    checks.newReport = true;
    checks.reportFile = true;
    return { reported: true, reason: null, checks };
  }

  if (item.status === 'planned' || item.status === 'accepted' || item.status === 'submitted') {
    // planned（已计划，REQ-20260908-010）尚未被认领，与 accepted/submitted 同判：worker 未认领
    return { reported: false, reason: 'worker-did-not-claim', checks };
  }
  if (!checks.claimed) {
    return { reported: false, reason: `item-status-${item.status}`, checks };
  }
  if (!checks.owner) {
    return { reported: false, reason: 'owner-mismatch', checks, owner: item.owner };
  }

  checks.newReport = !!(
    item.agentCompletedAt && item.lastReport && item.lastReport.at
    && item.agentCompletedAt > run.startedAt && item.lastReport.at > run.startedAt
  );
  if (!checks.newReport) {
    return { reported: false, reason: 'no-new-report', checks };
  }
  // 运行关联（REQ-20260906-002 协议；BUG-20260906-004）：本次自动执行必须由
  // 显式关联本次 runId 的 report 作为完成证据——未带 --run 的旧式兼容调用
  // （runId=null）不构成自动执行的完成证据；指向其他 run 的 report 同样排除（旧报告重放）。
  if (run.runId) {
    checks.reportRun = item.lastReport.runId === run.runId;
    if (!checks.reportRun) {
      return {
        reported: false,
        reason: item.lastReport.runId ? 'report-run-mismatch' : 'report-run-missing',
        checks,
      };
    }
  }

  try {
    const dir = resolveItemDir(dataDir, run.itemId).dir;
    const f = path.join(dir, 'test-report.md');
    checks.reportFile = fs.existsSync(f) && fs.statSync(f).size > 0;
  } catch {
    checks.reportFile = false;
  }
  if (!checks.reportFile) {
    return { reported: false, reason: 'no-report-file', checks };
  }
  return { reported: true, reason: null, checks, reportRef: 'test-report.md' };
}
