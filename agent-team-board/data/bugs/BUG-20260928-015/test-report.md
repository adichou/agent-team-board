# 测试报告 — BUG-20260928-015 发布运行失败后确认锁不回滚：计划被误锁为已发布、无法调整范围与重新提交

- 时间：2026-09-28T16:06:15.674Z
- 执行者：zcode-batch-089-1
- 测试框架：node:test 风格脚本
- 覆盖率：8%

## 总结

双层修复：写侧 rollbackReleaseConfirm（失败/取消终态清确认锁、保留推送事实、成功不可逆）接入 build-publish 六处收尾；读取侧 isReleased(v, dataDir) 兜底（确认运行 failed/canceled 判未发布，账本缺失保守判已发布）覆盖 build-store 全部锁口径与 server 三处；publishStepsState 增 released 覆盖参；recordReleaseConfirm 改最近一次有效确认。新增 6 用例先红后绿，存量 BLD-20260927-001 兜底核验恢复可编辑，npm test 全量 378 文件通过。引入来源 BUG-20260928-005。

## 明细

（可粘贴命令输出、失败用例说明等）
