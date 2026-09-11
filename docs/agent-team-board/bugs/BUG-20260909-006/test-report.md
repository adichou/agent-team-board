# 测试报告 — BUG-20260909-006 已计划列表中的选择进入批量开发的功能去掉，因为已经有批量开发队列了。

- 时间：2026-09-09T03:36:25.268Z
- 执行者：zcode-batch-019-1
- 测试框架：node:test 自研聚合 runner（npm test / scripts/tests/run-all.mjs）
- 覆盖率：95%

## 总结

移除已计划列表「进入批量开发」入口与勾选范围推送链路（enterBatchImpl/pushImplScope/#implGo/scopeActive、项目切换清范围、?ids= 拉取、创建勾选回退、Codex 范围提示与 scope-empty 文案、面板 scopeLine）；服务端同步删除 /api/dispatch/scope 路由、scheduler scope 机制与 /api/batch/current ids 过滤；保留 createBatch({ids}) 供 REQ-20260908-026 单条目重试；复选框仅为「移出计划」服务（全选/全不选/防误触/失败分列不回归）；引入来源 REQ-20260906-018+REQ-20260908-010（已核验）；TDD 先红后绿，npm test 112 文件全部通过

## 明细

（可粘贴命令输出、失败用例说明等）
