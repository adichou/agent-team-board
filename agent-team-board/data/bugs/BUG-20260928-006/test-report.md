# 测试报告 — BUG-20260928-006 官网资料更新的 AI 提示词的版本号不对，请修改。

- 时间：2026-09-28T05:27:00.767Z
- 执行者：zcode-batch-084-2
- 测试框架：node:assert（L1 纯逻辑 + L2 真实 server + L3 源码契约）
- 覆盖率：100%

## 总结

官网提示词版本号同源修复：buildSiteWritingPrompt 新增可选 version 参数（x.y.z 优先，未传回退 planId 派生 YYYYMMDD-NNN，存量口径不变），server publish-plan 调用点传 v.version；提示词两处版本号与 versionNumber 同源，完整计划号保留。归因 REQ-20260922-006；同构缺口（总结/翻译/校对提示词）已登记 BUG-20260928-007。npm test 371 文件全过。

## 明细

（可粘贴命令输出、失败用例说明等）
