# 测试报告 — BUG-20260928-005 推送完成即判定已正式发布并锁定范围，未以用户点击发布按钮并二次确认为准

- 时间：2026-09-28T05:12:26.294Z
- 执行者：zcode-batch-084-1
- 测试框架：node:assert/strict 自定义用例
- 覆盖率：90%

## 总结

正式发布判定换基准：isPushed(pushedAt 即锁定) 改 isReleased(release.confirmedAt，发布按钮二次确认后一键发布链路 start 落账，幂等首认固化)；推送只落事实不锁定。锁点全换基准文案不变：build-store 条目增删/换 commit/重开合并/语言集/自定义文档、五步门禁 docs/docmerge/merge、server version/merge 与 docs/merge 守卫；/state pushed 键改 released，前端 pushedOf→releasedOf；发布步动作一已推送未确认就近说明推送≠正式发布(i18n 中英同步)；存量已推送未确认版本(如 BLD-20260927-001)自动解锁，补确认路径即发布按钮。新增 7 例先红后绿，16 个既有测试文件同步口径迁移，npm test 全量 370 文件 0 失败；引入来源归因 REQ-20260926-002

## 明细

（可粘贴命令输出、失败用例说明等）
