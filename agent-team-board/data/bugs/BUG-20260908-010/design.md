# 设计 — BUG-20260908-010 批量完善实时队列提前结束并漏掉重新接受条目

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260908-020（重构批量流程和任务管理：完善候选切换为「已接受未完善、每轮实时读取」，`atb list` 核验存在，in-progress）。该需求实现时把实时候选吸收 `absorbNewRefineCandidates` 只挂在了 `nextRefineItem` 一处，`checkRefineBatch` / 回执收尾仍按创建时冻结的 `batch.candidates` 快照算 `remaining`；领取循环以 `finalByItem` 历史终态排除条目，未识别「驳回再接受」对完善状态的重置，也未对重领条目重冻结文档基线。

## 根因分析

数据层 `scripts/lib/refine-store.mjs` 三个缺口（行号为修复前）：

1. **实时吸收只在领取入口**：`absorbNewRefineCandidates`（约 591 行）仅被 `nextRefineItem`（623 行）调用。`checkRefineBatch`（约 883 行 `state.counts.remaining === 0` 判 stop）、`finishRefineRun` 收尾（约 763 行）、`releaseRefineRun`（约 789 行）、`settleRefineBatch`（约 855 行）都只按创建时快照计算 → 运行中新接受的条目不在 `batch.candidates` 内，`remaining === 0` 被提前判 stop / 批次提前 finished（D01）。
2. **`finalByItem` 无条件排除历史终态条目**：领取循环（637 行）`if (state0.finalByItem.has(cand.id)) continue;`，不校验条目当前完善状态。条目被驳回再接受后 `core.mjs` 进入 accepted 钩子已把完善状态重置为「未完善」（`setRefineItemState(id,'unrefined')`，无 runId、整体替换），且 `absorbNewRefineCandidates` 的 `known` 集合含本批已有候选，重新接受的条目既不会被吸收也不会被重领（D03）。
3. **基线不重冻结**：即便重新进入领取循环，候选 `baseline` 仍是创建/吸收时冻结的旧指纹，上一轮 done 已修改过文档 → 651 行误判「冻结后文档已被人工编辑，基线失效」出局。

配套口径辨析（决定修复形态）：
- fail / release 回执也把完善状态回置「未完善」，但置位记录带 `runId`（`setRefineItemState(..., { runId })`）；人工再接受的置位来自 core.mjs 钩子，**无 runId 且 `updatedAt` 晚于最后一个终态回执**。两者必须区分——否则 fail 的单会被同轮无限重领（既有测试 refine-store R5/R6、refine-cli R10a 的「fail 出局」语义，以及 R9/R10b「release 换单」语义都要保持）。
- `skipRun` 不写 states 索引：基线失效出局的条目 states 仍是首接受时的旧记录（`updatedAt` 早于 skip 终态），不能被「重新接受」判定误捞，否则人工编辑出局保护失效并形成 skip 循环。

## 方案

全部改动收敛在 `scripts/lib/refine-store.mjs`（数据层），不动 core.mjs 状态机与既有保护：

1. **再接受判定**：`core.mjs` 进入 accepted 钩子置「未完善」时，若该条目已有索引记录（再接受）则带确定性事件标记 `reaccepted: true`（`refine-states.mjs` 的 `setRefineItemState` 扩展透传；首次接受无记录不带）。`refine-store.mjs` 新增内部函数 `reacceptedForRerun(dataDir, itemId)`——条目在本批已有终态回执，且 `refine/states.json` 当前记录为 `unrefined`、无 `runId`、带 `reaccepted` 标记、条目当前 `status === 'accepted'`。条件缺一不可：
   - 带 `runId` 的 unrefined 是 fail/release 回置（置位整体替换会清除标记）→ 不重领（fail 出局、release 换单语义不变）；
   - 无标记的 unrefined 是 skipRun 场景（skip 不写索引，states 仍是首接受记录）→ 不重领（人工编辑出局保护不变，防 skip 循环）；
   - 非 accepted（如已移入计划）→ 不重领。
   不用时间戳比较（updatedAt vs finishedAt）：终态回执与人工再接受可能落在同一毫秒，判定不稳定（单测实测约半数概率翻转）。
2. **`refineBatchState` 增强**：计算 `reacceptable` 集合；计数口径——可再处理条目不计入 done/failed/skipped/interrupted，计入 `remaining`（`total = 四类终态 + remaining` 恒等式保持，「remaining = 当前尚需完善」）。
3. **重新入队（重排队到队尾 + 重冻结基线）**：`nextRefineItem` 在吸收新候选之后、领取循环之前，把所有「再接受」条目移到 `batch.candidates` 队尾（README 期望行为「重新进入本轮队列」的字面实现），并按**当前文档**重冻结 `baseline`、刷新 `reasons` 后 `saveRefineBatch`。重冻结使上一轮 done 的修改不视为人工篡改；done 核验「文档确有变更」口径不变（基线是重冻结时点指纹）。同轮内一条目只重排队一次（每轮 next 扫描一次集合），再次领取仅源于「终态回执之后重新接受」，不会无限重领。
4. **实时吸收扩展到判定 stop 的全部路径**：`checkRefineBatch`、`finishRefineRun` 收尾、`releaseRefineRun`、`settleRefineBatch` 在计算 `refineBatchState` 前先 `absorbNewRefineCandidates`（吸收幂等：known 集合含本批已有候选，无新候选不落盘）。运行中新接受的单在 check/回执时点即计入 `total/remaining`，`nextAction` 为 continue，批次不在尚有实时候选时转 finished（D01）。`abortRefineBatch`/`pauseRefineBatch` 不吸收——终止/暂停语义不因新单改变，恢复后由 next 吸收。

## 风险与边界

- **fail 重领边界**：重新接受过的条目重排队后被再次领取，若二次尝试仍 fail，其 states 被 fail 回置（带 runId）→ 不再重领，本轮出局；人工再次驳回再接受可再次触发。主调度侧 fail 重试由人工用 pause/abort 控制（D08/D12 语义不回归）。
- **时钟依赖已消除**：再接受判定用事件标记而非时间戳比较（同毫秒不可靠，见方案 1）；标记生命周期 = 「再接受置位 → 重领/回执置位整体替换清除」，无残留。
- **计数展示**：再接受条目从 done 挪入 remaining，看板/摘要的 done 数暂时减少一次属预期（「当前待处理」口径优先）；执行记录 `records` 保留全部历史运行（同条目多次运行可追溯）。
- **不破坏既有保护**：完善中不可驳回（core.mjs，判定前置保护不动）、在途未收尾拒绝二次领取（refine 互斥）、终止后迟到回执拒绝、暂停/恢复语义均不动；深测 D07/D08/D09/D10/D11 保持 PASS。
- 影响面：`scripts/lib/refine-store.mjs`（判定/重排队/吸收）、`scripts/lib/refine-states.mjs`（标记透传）、`scripts/lib/core.mjs`（进入 accepted 钩子置标记，仅再接受路径多一个字段）三个文件；CLI（atb refine check/next/done/fail/release）与看板批量完善面板走同一数据层，无需各自改动。

## 实施记录（zcode-batch-018-1，2026-09-08）

- `scripts/lib/refine-store.mjs`：`refineBatchState` 新增 `reacceptable` 集合与计数口径（再接受条目计入 remaining、不占终态计数）；新增 `reacceptedForRerun`（标记判定）与 `requeueReacceptedRefineItems`（重排队尾 + 重冻结基线 + 刷新缺失原因）；`nextRefineItem` 领取循环放行再接受条目；`checkRefineBatch` / `finishRefineRun` / `releaseRefineRun` / `settleRefineBatch` 在判定 stop 前调用 `absorbNewRefineCandidates` 实时吸收。
- `scripts/lib/refine-states.mjs`：`setRefineItemState` 透传 `reaccepted` 标记。
- `scripts/lib/core.mjs`：进入 accepted 钩子时，条目已有索引记录（再接受）则置 `unrefined` + `reaccepted: true`（首次接受不带）。
- TDD：先建 `scripts/tests/refine-reaccept.test.mjs`（V1/V2/V7 跑红，V3~V6 语义护栏先行通过），实现后全绿；曾用「updatedAt > finishedAt」时间戳判定，单测实测同毫秒约半数翻转（V7 偶发红），改为确定性事件标记后连续 15 次稳定。
- 验证：深测夹具 D01/D03 由 FAIL 转 PASS（D07~D11 保持 PASS；D02/D04/D05/D06/D12 分别属 BUG-20260908-011/012/013/014/015，不在本条范围）；`npm test` 全量 94 个测试文件失败 0。
