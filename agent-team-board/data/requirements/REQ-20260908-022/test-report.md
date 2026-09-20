# 测试报告 — REQ-20260908-022 支持就单一需求和 Agent 进行讨论的功能

- 时间：2026-09-08T14:20:50.031Z
- 执行者：zcode-batch-018-1
- 测试框架：node:assert/strict + 自研聚合（npm test / run-all.mjs）
- 覆盖率：85%

## 总结

讨论单新增可选 reqId 需求绑定：store 层创建校验（仅 REQ- 且存在）+卡片/按需过滤+reqContext（README/design/test-cases 全文，需求删除 missing 不崩）；oncall show 与 codex worker 提示词自动注入需求文档上下文；CLI oncall new --req / list --req / show 归属展示；server 新增 /api/oncall/tickets?req=；Web 需求抽屉「需求讨论」区块（2 秒轮询刷新）+统一弹窗关联需求输入（抽屉发起预填只读）、讨论卡片/抽屉归属徽标 atb:open-req 双向跳转。新增 oncall-req-bind.test.mjs（R1-R7），全量 91 测试文件 0 失败，未绑定老单零回归。

## 明细

（可粘贴命令输出、失败用例说明等）
