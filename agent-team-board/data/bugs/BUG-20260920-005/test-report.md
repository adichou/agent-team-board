# 测试报告 — BUG-20260920-005 已经合并入 main 的版本计划允许重新关联条目和提交

- 时间：2026-09-20T16:27:45.700Z
- 执行者：zcode-batch-055-1
- 测试框架：node:assert 自研 runner（数据层锁定基准 + publishStepsState 门禁 + vm 前端行为 + i18n 断言）
- 覆盖率：7%

## 总结

锁定基准后移：新增 buildStore.isPushed（=release.pushedAt 落盘，待确认1默认；published/官网命中不计入），assertItemsEditable 与 beginMerge 改为 merging/推送完成锁、merged 未推送放行（重开合并沿用只补未合并条目的增量语义，已并入提交幂等）；merge 端点移除 merged 拒绝改推送后 409，/api/build/state 附 pushed；publishStepsState link/docs/merge 门禁同口径后移（待确认2默认 docs 随后移，文档门禁与 scopeStale 不放宽）；前端卡片 AI 完善/合并键、详情条目锁、合并步按钮与 openAnswerModal 防御路径同步，文案中英同步 i18n（清理旧词条）。待确认3/4 无默认口径维持现状（删键不锁、meta 阶段文案不改）。新增 bug-20260920-005.test.mjs 7 例全绿；同步 build-store B3/B5、build-serve S6+推送后锁定、card-acts B2/B7、items-search R8、published-chip P3。npm test 292 文件仅 req-20260920-003.test.mjs 失败：夹具硬编码 REQ-20260920-* 编号、本地日期已过 2026-09-20 所致（失败在 setStatus 夹具阶段，先于本单改动路径，独立临时目录复现确认为日期敏感），已登记 BUG-20260921-001 待人工处理

## 明细

（可粘贴命令输出、失败用例说明等）
