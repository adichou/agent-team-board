# 测试报告 — REQ-20260922-001 命令看板中要隐藏那些只能在 AI Agent 中执行的命令，例如 AI 开发，AI 分析相关的

- 时间：2026-09-22T00:40:24.783Z
- 执行者：dev-1
- 测试框架：node:assert 自研测试脚本
- 覆盖率：8%

## 总结

命令看板隐藏 AI Agent 命令：注册表 agentOnly 标记（batch/run/refine/summary/translate 五组 + claim/report/hold declare），visibleGroups 过滤 /api/cli/commands（12→7 组），validateRunRequest 拒绝网页下发，前端最近执行残留过滤与全隐藏空态；CLI 命令面与 C1 同步校验不变；新增 8 用例 + req-20260920-004 断言按新口径更新，相关回归全过

## 明细

（可粘贴命令输出、失败用例说明等）
