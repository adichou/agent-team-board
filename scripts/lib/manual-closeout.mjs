// BUG-20260915-007 无 run 手动 /dev 的系统收口提交 —— 编排层。
// 批量通道（run receipt 核验通过 → gitFlow.autoCommitForRun）与手动通道在此收口为同一
// 内核：`atb report <ID>`（不带 --run）在 core.report 写完 test-report.md 与状态之后，
// 由 CLI 调用 closeoutManualReport，以认领（或例外 status → in-progress）时捕获的工作区
// 快照（git-flow.captureManualTreeSnapshot，与批量预留 treeSnapshot 同构）为归因基线，
// 执行与批量完全同口径的收口提交：
//   · 分组规范 doc / test / 业务（消息「类型: 描述 单号」），只 commit 不 push；
//   · 由 atb 进程内部执行 git，不经 Agent Bash，不受 state-guard 拦截；
//   · 幂等 / 失败续传沿用 autoCommitForRun 自身口径（重复上报只补交报告状态变动，
//     已入库路径退出脏集合天然去重）；
//   · 提交失败 / 归属不明 / 暂扣 → commitIncompleteReason 判定不完整，经 confirm-store
//     声明「待人工确认提交」挂起（任务页呈现 + waitingDevelopConfirm 项目级防呆），
//     上报本身不受阻断、条目照常进入待测试——与批量通道 finishRun 的挂起口径一致。
// 分层约束：core 不能引用 confirm-store（既有依赖方向 confirm-store → git-flow → core），
// 故本编排独立成模块，由 CLI 在 core.report 成功后调用——与 REQ-20260914-007 管理记录
// 提交（mgt-commit，atb status done 后 CLI 编排）同一模式。

import * as gitFlow from './git-flow.mjs';
import * as confirmStore from './confirm-store.mjs';

const clip = (s, n) => String(s ?? '').slice(0, n);

// 手动收口（永不抛错：失败原样记录在结果中，改动保留在工作区，重复上报可重试）。
// 返回 { skipped, suspended: { itemId, reason } | null, autoCommit: <autoCommitForRun 结果> }。
export function closeoutManualReport({ dataDir, projectRoot, itemId }) {
  // 已挂起待人工确认提交：提交动作转入确认闭环（重新核验 / 确认并继续的授权补交），
  // 不越权重放提交——与批量通道 retryAutoCommit 对挂起运行的重试守卫同口径。
  const waiting = confirmStore.confirmOf(dataDir, itemId);
  if (waiting && waiting.kind === 'develop' && waiting.state === 'waiting') {
    return {
      skipped: true,
      suspended: { itemId, reason: waiting.reason || '自动提交不完整' },
      autoCommit: {
        status: 'skipped',
        commits: [],
        reason: `${itemId} 已挂起待人工确认提交：请到 Status Board 任务页「待人工确认」重新核验并确认后继续（授权补交在确认闭环内执行）`,
      },
    };
  }
  const run = gitFlow.readManualRun(dataDir, itemId);
  if (!run) {
    // 历史认领（本机制上线前无快照）：无归因基线。不做猜测归因，也不登记无法经确认
    // 闭环解除的挂起（无快照的确认记录无法核验/补交，会把项目卡死在 waiting）——明确
    // 提示跳过；重新认领（claim / 例外 status → in-progress 均会补拍快照）后再上报即可收口。
    return {
      skipped: true,
      suspended: null,
      autoCommit: {
        status: 'skipped',
        commits: [],
        reason: '缺少认领时工作区快照（历史认领），不做猜测归因；重新认领本条目后再上报即可按快照收口，或人工在终端提交',
      },
    };
  }
  const autoCommit = gitFlow.autoCommitForRun({ dataDir, projectRoot, run });
  const saved = gitFlow.saveManualRunResult(dataDir, itemId, autoCommit);
  const reason = confirmStore.commitIncompleteReason(autoCommit);
  if (!reason) {
    return { skipped: false, suspended: null, autoCommit };
  }
  // 提交不完整挂起：declareCommitConfirm 登记「待人工确认提交」（confirms 账本 +
  // confirmations.md 留痕），waitingDevelopConfirm 使认领/派发在确认闭环前一律拒绝；
  // 手动通道无批次可暂停，项目级防呆即批量 pauseRequested 的等价物。声明失败不吞错，
  // 如实并入挂起原因供人工核对。
  let suspended = { itemId, reason };
  try {
    confirmStore.declareCommitConfirm(dataDir, { run: saved || run, batch: null, autoCommit, projectRoot });
  } catch (e) {
    suspended = { itemId, reason: clip(`${reason}；挂起登记失败：${e && e.message ? e.message : e}`, 200) };
  }
  return { skipped: false, suspended, autoCommit };
}
