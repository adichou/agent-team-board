# BUG-20260919-001 已终止批次被在途回执复活为 running，队首永久 stop=aborted 阻塞后续批次派发

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-18T17:11:51.809Z

## 现象

现象：atb batch next / batch check 均返回 stop=aborted（队首 batch-20260913-048），其后排队的 batch-20260918-049 永远无法派发，主调度会话卡死在 stop。

复盘（账本证据）：2026-09-18T03:47:28 人工终止 batch-20260913-048（run-273~280 落 skipped『任务终止，剩余项出局』，abortBatch 应将 status 置 finished）；5 秒后人工创建 batch-20260918-049 承接。但 048 的在途 run-20260918-272（BUG-20260916-002）在终止后继续实施，2026-09-18T17:06:59.516 补交 run receipt --result reported；finishRun（scripts/lib/batch.mjs）第 1075-1077 行按 counts.remaining>0 重算 batch.status='running'，未判 abortRequested（batch.lastActivityAt=17:06:59.652 与该 saveBatch 吻合）。此后 048 呈 aborted=true + status=running 并存：queueHeadBatch 命中 048 → nextItem 674 行返回 stop=aborted，永不结束也永不让位 049。

次生问题：abortBatch 幂等分支（batch.abortRequested 已 true）直接返回『任务已终止（幂等返回）』，不重算/修复 status 与剩余项出局，人工重复执行终止也无法自愈。

建议：finishRun 收尾重算 status 时 guard abortRequested（保持 finished 不复活）；abortBatch 幂等分支顺带把 status 修复为 finished 并补齐剩余项 skip；代码修复后当前 048 账本仍需人工收尾（重建或人工修复账本），本 bug 登记不改动任何代码与账本。

## 复现步骤

### A. 真实账本时间线（本仓 2026-09-18 已发生，账本证据可复核）

1. 2026-09-18T02:37:33 batch-20260913-048 派发 run-20260918-272（BUG-20260916-002，owner zcode-batch-048-56），处于在途。
2. 2026-09-18T03:47:28 人工终止 batch-20260913-048（`atb batch abort`）：在途 run-272 落 interrupted，剩余项 run-273~280 落 skipped「任务终止，剩余项出局」，批次置 abortRequested=true + aborted=true + status=finished（已核验账本：run-273~280 均 skipped 且归属 048）。
3. 5 秒后（03:47:33）人工 `atb batch create` 创建 batch-20260918-049 承接。
4. 048 的在途子代理未被停止，继续实施并最终走完上报：2026-09-18T17:06:59.516 补交 `atb run receipt run-20260918-272 --result reported --report-ref test-report.md`（回执证据核对全通过，autoCommit committed）。
5. finishRun（scripts/lib/batch.mjs）收尾重算走 `result === 'reported' || safe` 分支（第 1075-1077 行）：`batch.status = counts.remaining > 0 ? 'running' : 'finished'`，未判 abortRequested。因候选按实时口径盘点（effectiveCandidates 含账面外 planned 未认领条目），remaining>0，048 被改写回 status='running'（batch.lastActivityAt=2026-09-18T17:06:59.652 与该 saveBatch 吻合）。补交能通过的原因：interrupted 不在 FINAL_RUN_PHASES（= reported|blocked|failed），finishRun 不拒绝已终止批次的在途回执——这就是复活入口。
6. 复活后 048 = abortRequested=true + status='running' 并存：unfinishedBatches 以「status !== finished」命中 048 为队首 → `atb batch next` / `atb batch check` 返回 stop=aborted，永不结束也永不放行；049 因「前序任务 048 尚未结束」永远排队，主调度卡死在 stop。
7. 次生问题：对 048 重复执行 `atb batch abort` 走幂等分支（batch.mjs 第 1269-1270 行）直接返回「任务已终止（幂等返回）」，不重算 status、不补剩余项 skip，人工重复终止无法自愈。

### B. 最小确定性复现（临时目录，不碰真实账本；脚手架与 scripts/tests/batch-core.test.mjs 同法）

1. 临时项目（mkdtemp → initData → ensureDispatch），建 4 个条目并置 planned：item1~item3 将入批次候选，item4 留在账面外（用于让实时盘点 remaining>0）。
2. `atb batch create` 创建批次 A（候选 item1~item3）→ `atb batch next --batch A --by w1` 领取 item1，得到在途 run R1。
3. `atb batch abort --batch A`：R1 → interrupted，item2/item3 → skipped，A 置 abortRequested=true + status=finished。
4. 模拟在途子代理继续收尾：item1 完成 `atb report`（关联 R1）后执行 `atb run receipt R1 --result reported --report-ref test-report.md`。
5. 观察缺陷：A 的 batch.json 变为 abortRequested=true + status='running'（finishRun 第 1076 行无 abortRequested guard，item4 使 remaining>0）。
6. 后果验证：`atb batch next`（缺省解析队首=A）返回 stop=aborted；新建批次 B 后 `atb batch next --batch B` 报「排队中：前序任务 A 尚未结束」；再次 `atb batch abort --batch A` 幂等返回且 A 仍 running——队首永久卡死，B 永不派发。

## 期望行为

1. finishRun 收尾重算批次状态时（batch.mjs 第 1075-1077 行）必须 guard abortRequested：批次已人工终止（abortRequested=true）时，无论补交回执 result 为何，批次保持 finished 终态不复活；回执本身照常落账（run.phase / reportRef / autoCommit 与证据核对不受影响）。
2. abortBatch 幂等分支（第 1269-1270 行）不能只返回：应顺带把账本修复到终止终态——status 非 finished 时重算置 finished、未出局候选补 skipped、清 currentRunId，使重复终止具备自愈能力（可修复「已复活」的历史账本）。
3. 队列接续：已终止批次 status=finished 后不再进 unfinishedBatches / 队首，`atb batch next` / `batch check` 缺省解析落到下一个未结束批次（如 049），后续批次正常派发，主调度不再卡死在 stop=aborted。
4. 正常路径不回归：未终止批次在 reported / safe 回执后仍按 remaining 正确置 running 或 finished；failed（needs_attention）、提交不完整挂起（pauseRequested + paused）等既有分支行为不变。
5. 存量账本说明：登记时（2026-09-18）048 账本处于复活态需人工收尾；本单补录时复核（2026-09-19）048 已呈 finished + aborted=true、049 已恢复 running（当前队列未被阻塞；由谁以何种方式修复待确认）。代码修复须保证此后任何在途回执都无法复活已终止批次。

## 验收说明

1. 新增回归测试 scripts/tests/bug-20260919-001.test.mjs（先红后绿），至少覆盖：
   - 已终止批次补交 reported 回执：回执落账成功，但 batch.status 保持 finished，abortRequested/aborted 不被改写；
   - 终止幂等自愈：人为构造 abortRequested=true + status='running' 的账本，再次 abortBatch 后 status=finished、剩余候选补 skipped、currentRunId 清空；
   - 队列接续：上述复活场景修复后，新建批次可被 next 正常解析派发（队首不再卡死）；
   - 正常路径回归：未终止批次 reported/safe 回执后 status 按 remaining 正确置 running/finished。
2. `npm test` 全量通过，既有批次测试（batch-core 等）无回归。
3. 人工验收：真实看板对已终止且账本已收尾的批次执行 `atb batch next` / `atb batch check`，队首解析与派发正常，不再返回 stop=aborted 卡死；后续批次可接续派发。
4. 本 Bug 为纯账本/状态机逻辑缺陷，不涉及界面改动，无 UI 验收项。
