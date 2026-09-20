# 测试用例 — REQ-20260909-010 支持需求完善后自动转入计划，提供配置，默认是手动

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| A1 | 默认关闭零回归：未改设置时 done 回执后条目保持 accepted、完善账本记已完善；CLI 输出「未开启自动转入计划」提示行；history 无 accepted → planned 流转记录 | P0 | ✅ |
| A2 | 开启生效：`refine: { autoPlanAfterDone: true }` 保存后 done 核验通过 → 条目自动 accepted → planned（status.json 变化、history 记录 by=system、note 含 runId）；回执 JSON `autoPlan.transitioned=true`；CLI 输出「已自动转入计划」；条目进入批量开发候选（candidateItems） | P0 | ✅ |
| A3 | 条件流转（人工提前移入计划）：开启后条目被人工置 planned 再 done 回执 → 回执成功不报错、不重复流转（history 无新增流转记录）、`autoPlan.reason='not-accepted:planned'`、CLI 输出原因说明；完善账本仍记已完善 | P0 | ✅ |
| A4 | 其他状态仍拒绝：条目被驳回回 submitted 后 done → 沿现状报错「条目已离开已接受状态」（完善结果需人工核对） | P1 | ✅ |
| A5 | 仅 done 触发：开启设置下 `refine fail` / `refine release` / 批次 abort 出局条目均不发生流转（保持 accepted / 未完善） | P0 | ✅ |
| A6 | 失败不丢单：`autoPlanRefinedItem` 前置读取失败（条目目录损坏 → status-read-failed）返回 transitioned:false 且不抛错；done 回执仍成功、账本记已完善 | P1 | ✅ |
| A7 | 设置存储：`saveTaskSettings` patch `refine` 分区持久化往返；非法值（字符串 / 数字）整体拒绝不落半截配置；`loadTaskSettings` 存量无字段回退 false；`autoPlanAfterRefineDone` 助手缺省 false | P0 | ✅ |
| A8 | server 双路径同口径：`/api/tasks/settings` POST 透传 refine 分区；server.mjs settle done 核验与 precheck 对齐 accepted（源码断言）；settle done 分支接入 autoPlanRefinedItem（源码断言） | P1 | ✅ |
| A9 | 设置页 UI：`taskSettingsHtml` 含「完善完成后自动转入计划」开关（默认不勾选、已开启回显勾选、位于批量完善块与批量开发块之间）；开关变更提示「有未保存的更改」；保存 body 携带 `refine.autoPlanAfterDone`；保存成功 toast 含「仅对后续完善回执生效」 | P0 | ✅ |
| A10 | Agent 纪律不变：state-guard 对 `atb status <ID> planned` 的拦截规则源码不变（HUMAN_ONLY_TO 语义不放宽） | P0 | ✅ |
| A11 | 面板记录标注：`runAttemptsHtml` 对 done + `autoPlan.transitioned` 记录显示「已自动转入计划」；未开启（not-enabled）不显示标注；`listRefineRuns` records 透传 autoPlan | P1 | ✅ |
| A12 | 人工操作不回退：自动置计划后的条目可「移出计划」回 accepted（状态机边 planned → accepted 保持；回 accepted 钩子重置未完善——沿既有口径） | P1 | ✅ |
