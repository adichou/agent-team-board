# 设计 — BUG-20260916-002 任务记录重新执行无法续接已认领后 blocked 的条目

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260908-026（引入任务记录「重新执行」及其终态承接路径——终态任务以该条目重建新的待启动任务并自动复制调度提示词；重建经 `createBatch` scoped ids 走「已计划且未认领」候选过滤，未覆盖 blocked 后仍被原 owner 认领的条目。经 `atb show` 核验存在，2026-09-11 已 done）

## 根因分析

（2026-09-16 文档讨论第 1 轮核实；仅登记不实施）

- blocked 回执是终态运行（`FINAL_RUN_PHASES = {reported, blocked, failed}`，`scripts/lib/batch.mjs:42`），但**不改变条目业务状态**：条目保持 in-progress、owner 不变——沿用「认领后的失败保持业务状态」既有口径。
- 任务结束后在任务记录页点「重新执行」，前端 `retryRunFromRecord`（`scripts/web/app.js:5475`）判定任务终态（finished / aborted）即走重建路径 `createBatchAndCopy({ids:[itemId]})`；`createBatch` 的 scoped 候选来自 `candidateItems`——只收「planned 且未认领」（`scripts/lib/batch.mjs:696`），该条目 in-progress 被过滤 → scoped 空集 → 报「指定的条目均不可入队：可能已被认领或不在已计划状态」（`batch.mjs:525`）。
- 任务仍活跃的分支走 `/api/batch/retry` → `retryRun`：对 `st.status !== 'planned' || st.owner` 一律拒绝并指引人工「回到已计划且未认领」（`batch.mjs:809-813`）。两条分支都没有「沿用原 owner 续认」的通路。
- 关键事实：**同 owner 续认机制已经存在**——`claim()` 对 in-progress 同 owner 放行（补锁幂等、快照同周期保留，`scripts/lib/core.mjs:944-955`）。缺的只是「重新执行」流程里识别「blocked + 仍被原 owner 认领」场景并生成续接提示词这一层路由，而非底层认领能力。

## 方案

（草案，供讨论；实施须待人工接受并移入计划后按 /dev 流程认领执行）

**路由**：`retryRunFromRecord` 增加前置分支（或后端新增如 `POST /api/batch/continue`）：记录结果为 blocked 且条目当前 in-progress、`st.owner` 与运行记录 owner 一致、且该条目无在途（非终态）运行时，返回续接提示词；否则维持现有两条路径与报错口径不变。

**续接提示词内容（对齐验收）**：

- 条目编号与标题、原认领身份（owner）、项目根；
- 文档入口：条目 README.md / design.md、`docs/agent-team-board/dispatch/worker-spec.md`；
- 指令：开工前核对旧 worker 已停止且无活动 worker（后端核账本无在途运行；旧子代理会话是否停止需人工确认，界面 toast 同步提示）；用原 owner 执行 `atb claim <条目> --by <原owner>` 同 owner 幂等续认；按单项流程（读文档 → TDD → `report` 不带 `--run` 收口）继续实施、测试、上报；
- 红线：不走普通新批次入队、不复用终态旧运行、不新建 run；不得代替人工接受需求或确认完成；不与 hold 复工机制耦合（不扩展为 hold 复工方案）。

**边界与待讨论点**：

- 活跃任务分支（retryRun 现有拒绝文案已给人工指引）是否同样改走续接提示词，还是保持现状仅修终态重建分支（复现路径）？建议：仅修终态分支、最小改动；活跃分支维持「人工处理」指引，如需覆盖另立单。
- refine（批量完善）记录不涉及认领（条目全程 accepted），不在本单范围。

**开源选型（REQ-20260909-015）**：自研（无合适库的原因）——本改动是插件私有前端路由与提示词生成逻辑的窄扩展，属本项目自有交互协议，无成熟开源库可复用，也无引入第三方依赖的必要。

## 风险与边界

- 「旧 worker 已停止」无法程序化确证，只能核账本在途运行 + 提示词/界面双重提示人工确认；若旧 worker 实际未停止，同 owner 续认后存在双执行风险——提示词须把「先确认旧会话已停止」放在第一步。
- 不自动修改人工管理的业务状态：续接不退回已计划、不清 owner；人工仍可随时按状态机处理条目。
