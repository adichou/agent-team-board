# BUG-20260916-002 任务记录重新执行无法续接已认领后 blocked 的条目

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260908-026（引入任务记录「重新执行」及其终态承接路径——终态任务以该条目重建新的待启动任务；该路径经 `createBatch` scoped ids 走「已计划且未认领」候选过滤，未覆盖 blocked 后仍被原 owner 认领的条目；经 `atb list` 核验存在）
- 创建：2026-09-16T01:47:43.508Z

## 现象

复现：条目被原 worker 认领后因边界待确认上报 blocked；确认边界后在任务记录页点击重新执行。实际：提示“指定的条目均不可入队：可能已被认领或不在已计划状态”。预期：生成续接提示词，指示新执行代理沿用原 owner 续认，按单项流程继续实施、测试、上报；不走普通新批次入队，不复用终态旧运行。验收：提示词携带条目编号、原认领身份、项目根与 README/design/worker-spec 文档入口；执行前核对旧 worker 已停止且无活动 worker；使用现有同 owner 续认，不冒充人工接受或完成。仅登记，不实施；不扩展为 hold 复工方案。

## 复现步骤

（依据源码核实，2026-09-16 文档讨论第 1 轮补全）

1. 条目被 worker 认领（in-progress、owner=X）后上报 blocked 回执：运行记为终态 blocked，条目业务状态保持 in-progress、owner 不变（`scripts/lib/batch.mjs` finishRun；`blocked` 属 `FINAL_RUN_PHASES`）。
2. 本轮任务结束（实时队列取空后收尾为 finished，或被终止）。
3. 任务记录页该 blocked 记录仍在「重新执行」可操作集合内（`scripts/web/app.js` runAttemptsHtml：failed / interrupted / blocked 均可重试）。
4. 点击后前端判定任务已终态，走「按原配置重试本项」重建路径 `createBatchAndCopy({ids:[条目]})`（`scripts/web/app.js` retryRunFromRecord）。
5. `createBatch` 按「planned 且未认领」过滤候选，该条目仍 in-progress 被过滤出局 → scoped 空集 → 抛出「指定的条目均不可入队：可能已被认领或不在已计划状态」（`scripts/lib/batch.mjs:525`）。
6. 另一分支：任务仍活跃（未结束）时点击走 `/api/batch/retry` → retryRun，对被认领条目同样拒绝并指引人工「回到已计划且未认领」（`scripts/lib/batch.mjs:809-813`）——两条分支都无法续接。

## 期望行为

- 「重新执行」遇到「blocked 终态记录 + 条目仍被原 owner 认领」时，不再尝试普通新批次入队，而是生成**续接提示词**并自动复制（复制失败可展开手动复制，沿用现有交互），指示新执行代理：
  - 沿用**原认领身份（原 owner）**执行 `atb claim <条目> --by <原owner>` 续认——现有同 owner 幂等续认机制（`scripts/lib/core.mjs` claim：in-progress 同 owner 放行补锁），不修改人工管理的业务状态、不把条目退回已计划；
  - 按单项流程（/dev 口径：读文档 → TDD → `report` 不带 `--run` 收口）继续实施、测试、上报；
  - 不走普通新批次入队、不复用终态旧运行、不新建 run 账目。
- 验收（同现象节所载）：提示词携带条目编号、原认领身份、项目根与 README/design/worker-spec 文档入口；执行前核对旧 worker 已停止且无活动 worker（后端核验该条目无在途运行，旧子代理会话是否停止由提示词与界面提示人工确认）；不冒充人工接受或完成。
- 范围约束：仅登记，不实施；不扩展为 hold 复工方案。
