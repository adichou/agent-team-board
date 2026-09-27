# 测试用例 — REQ-20260927-003 待测试的需求支持退回已计划

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 状态机：TRANSITIONS 开放 in-progress → planned；人工退回成功后 status=planned、owner 清空、认领锁删除、history 留痕含「退回已计划」 | P0 | 自动化（C1） |
| 2 | 清理口径：已上报（待测试）单退回已计划时 agentCompletedAt 一并清除，不再呈现「Agent 已上报完成」 | P1 | 自动化（C1b） |
| 3 | 实施互斥恢复：退回释放 impl.lock，其他实施入口可开工；退回后的单可被重新认领（claim 成功、状态回开发中、锁重建） | P0 | 自动化（C2） |
| 4 | hold 拦截：活跃 hold（含未答与已答未复工）时 in-progress → planned 被拒并引导「待人工确认」补齐决策并复工；force 不放行 | P0 | 自动化（C3） |
| 5 | hold 闭环零回退：确认完成未答拦截、补齐 → 复工回已计划、作废后可用退回边，行为与 REQ-20260911-007 一致 | P0 | 自动化（C3） |
| 6 | 非法流转报错文案更新：合法路径说明含「in-progress → planned（退回已计划）」；其余非法边仍拒绝 | P2 | 自动化（C4） |
| 7 | 人工专属铁律：state-guard 对 Agent 执行 `atb status <ID> planned` 与 curl 置 planned 均拦截（退出码 2） | P0 | 自动化（C5） |
| 8 | 网页入口：POST /api/item/:id/status in-progress → planned 返回 200，看板即入已计划档 | P0 | 自动化（C6） |
| 9 | 详情按钮：开发中条目有「✓ 确认完成」+「↩ 退回已计划」（warn）；活跃 hold 时退回按钮禁用 + tooltip 引导 | P0 | 自动化（C7） |
| 10 | toast 口径：退回成功提示「✓ <ID> 已退回已计划」且不附撤销（首版）；「移入计划」撤销口径零回退 | P1 | 自动化（C8） |
| 11 | i18n：按钮文本 / data-label / 禁用 tooltip / toast 模板中英文同步（EN / EN_DYNAMIC） | P1 | 自动化（C9） |
| 12 | Bug 条目同链路：开发中 Bug 亦可人工退回已计划并重新取单（两类型状态机不分开） | P1 | 自动化（C10） |
| 13 | 演示页人工核验：ui-demo.html 各场景（正常开发中 / 活跃 hold / 服务失败）与深浅色展示、档位联动、时间线留痕 | P2 | 人工（M1，浏览器打开演示页） |
