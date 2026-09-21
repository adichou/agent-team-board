# 测试报告 — REQ-20260921-015 版本计划详细内容页签的合并入 main 页面去掉隔离分析下方的一大堆红色字体的文字，并提供一键加入所有依赖提交的按钮

- 时间：2026-09-21T10:42:49.201Z
- 执行者：zcode-batch-060-6
- 测试框架：node:assert 自研测试脚本
- 覆盖率：11%

## 总结

合并页隔离分析红色长文移除（单行状态条+title+点击toast三通道反馈）；新增 POST /api/build/version/add-dependencies 一键加入全部依赖提交（itemCommitStatusIndex 归因、沿用 addItems 校验与 scopeStale 联动、跳过清单不静默）；前端一行汇总+明细details+一键按钮（merging/推送锁定、depBusy 防重复）；i18n 中英同步；npm test 313 文件全过

## 明细

（可粘贴命令输出、失败用例说明等）
