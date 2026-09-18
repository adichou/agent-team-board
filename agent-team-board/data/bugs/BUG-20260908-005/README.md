# BUG-20260908-005 execution-verifier.test.mjs V9 偶发失败（时间边界敏感）

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-08T03:21:40.225Z

## 现象

scripts/tests/execution-verifier.test.mjs 的 V9 用例偶发失败（实测 15 次挂 3 次，单独重跑即过，与被测功能无关的 flaky）。疑似原因：V9 用 new Date().toISOString() 取 run.startedAt，随后 core.report 以当前时间写 lastReport，两者落在同一毫秒时 verifyCompletion 走到与预期不同的分支（期望 report-run-missing），assert.equal 报 Expected values to be strictly equal。建议：V9 改用与 V1 相同的固定回拨时间夹具，或核对逻辑对同毫秒的顺序做明确约定。发现于 REQ-20260908-005 实施期间全量回归（run-all 首轮失败、复跑 4 次全过）。

根因（已对照源码核实）：

- 测试侧：`scripts/tests/execution-verifier.test.mjs` V9（第 147 行）以 `runFor(dataDir, root, st.id, new Date().toISOString())` 取**真实当前时刻**作 `run.startedAt`；随后第 148-149 行才执行 `core.claim` 与 `core.report`（真实入口）。
- 上报侧：`scripts/lib/core.mjs` 的 `report()`（第 649 行）在调用瞬间取 `now = new Date().toISOString()`，写入 `lastReport.at` 与 `agentCompletedAt`（第 670-671 行）。两次取时之间只隔数次本地文件写，常落在同一毫秒。
- 判定侧：`scripts/lib/execution-verifier.mjs` 的 `verifyCompletion`（第 51-54 行）要求 `item.agentCompletedAt > run.startedAt && item.lastReport.at > run.startedAt`（**严格大于**）。同毫秒时两条件不成立 → `checks.newReport = false`，在第 56 行提前返回 `reason: 'no-new-report'`，根本走不到第 61-69 行的 runId 关联检查（本应返回 `report-run-missing`）。
- 于是 V9 的断言 `assert.equal(r.reason, 'report-run-missing')`（测试第 154 行）失败，报错即 "Expected values to be strictly equal"（测试只打印报错首行，不展示实际/期望值）。同毫秒是概率事件，故重跑即过。本条目复核时再实测 40 轮挂 8 次（均为 V9、报错同上），与该机制一致。

结论：`verifyCompletion` 本身行为符合 REQ-20260906-003 设计（新报告须严格晚于 run 开始），缺陷在 V9 夹具用了真实时钟且未保证时间先后，属测试自身的 flaky。

## 复现步骤

1. 在项目根目录循环单跑该测试文件（实测约 1/5 概率触发）：

   ```bash
   for i in $(seq 1 15); do
     node scripts/tests/execution-verifier.test.mjs || echo "FAIL at round $i"
   done
   ```

2. 失败轮的输出特征：`✗ V9 (对齐探针 C-A1) core.report 真实入口未传 run → verifyCompletion 拒绝`，下一行为 `Expected values to be strictly equal`（实际 `r.reason` 为 `no-new-report`，期望 `report-run-missing`）。
3. 触发条件即「`run.startedAt` 与 `core.report` 写入的 `lastReport.at`/`agentCompletedAt` 落在同一毫秒」，同一文件单独重跑通常即过。
4. 亦可稳定复现（等价构造）：把 V9 中 `run.startedAt` 临时改为与 `core.report` 必然同毫秒的值（例如连续两次 `new Date().toISOString()` 通常相同），失败由偶发变为必现——仅用于验证根因，不要提交该临时改动。

## 期望行为

- `scripts/tests/execution-verifier.test.mjs` 连续运行（如 50 次）100% 稳定通过，不再依赖真实时钟的毫秒运气；`npm test` / `node scripts/tests/run-all.mjs` 首轮即过。
- V9 的测试意图保持不变：走 `core.report` 真实入口且不传 run → `detail.lastReport.runId === null`，`verifyCompletion` 以 `reason: 'report-run-missing'` 拒绝（即到达 runId 关联检查分支，而非被 no-new-report 提前拦下）。
- 修复方向（二选一，倾向 a；最终以实施时确认为准）：
  - a. 测试侧（推荐，低风险）：V9 的 `run.startedAt` 改为固定的过去时间戳（与 V1-V8 的回拨夹具风格一致，如 `'2026-09-06T04:00:00.000Z'`），或 `new Date(Date.now() - 60_000).toISOString()`，保证真实 report 时刻严格晚于 startedAt，同时保留真实 `core.report` 入口。
  - b. 逻辑侧：在 `verifyCompletion` 中对「同毫秒」语义做明确约定（如放宽为 `>=`）。这会改变 REQ-20260906-003 对「新报告」的判定边界（同毫秒的旧报告将计为新），属产品语义调整，须先与 REQ-20260906-003 / BUG-20260906-004 的核对口径确认后才可实施。

## 验收说明

1. 稳定性：修复后连续执行 `node scripts/tests/execution-verifier.test.mjs` ≥ 50 次全部通过（可用循环脚本验证，任一轮失败即不通过）。
2. 语义不回退：V1-V8 全部保持通过；V9 仍断言 `detail.lastReport.runId === null` 且 `r.reason === 'report-run-missing'`，`r.checks.newReport === true`。
3. 改动范围：若采用方向 a，仅 `scripts/tests/execution-verifier.test.mjs` 有 diff，`scripts/lib/execution-verifier.mjs` 与 `scripts/lib/core.mjs` 无改动；若采用方向 b，须在条目内先补充与 REQ-20260906-003 口径的确认记录再动逻辑。
4. 全量回归：`npm test`（即 `node scripts/tests/run-all.mjs`）首轮通过，无本条目相关的 flaky 复现。
5. 本条目为测试稳定性缺陷，不涉及 docs 数据规范与看板行为，无需改 docs/ 下任何业务文档。
