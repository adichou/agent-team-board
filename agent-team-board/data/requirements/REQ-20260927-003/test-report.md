# 测试报告 — REQ-20260927-003 待测试的需求支持退回已计划

- 时间：2026-09-27T10:28:59.684Z
- 执行者：zcode-batch-079-1
- 测试框架：node assert/strict 自定义 runner
- 覆盖率：100%

## 总结

需求支持退回已计划（in-progress→planned 人工回退边）：TRANSITIONS 开放新边并更新非法流转合法路径文案；退回清空 owner/agentCompletedAt、删除认领锁、释放实施互斥（与复工/驳回完成同口径）；活跃 hold 拦截退回并引导待人工确认复工，force 不放行，REQ-20260911-007 决策闭环零回归；网页 /api/item/:id/status 放行新边（boardTransitionAllowed）；详情页开发中条目新增「↩ 退回已计划」warn 按钮，活跃 hold 禁用+tooltip，首版不附撤销（移入计划撤销不变）；i18n 中英同步 4 词条；新测 12 例先红后绿，npm test 全量 362 文件 0 失败；Bug 同链路；state-guard 对 Agent 直写 planned 拦截不回归

## 明细

（可粘贴命令输出、失败用例说明等）
