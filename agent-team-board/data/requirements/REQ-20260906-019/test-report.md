# 测试报告 — REQ-20260906-019 Codex 一键派发要使用批量实施的方案，放弃当前的方案

- 时间：2026-09-06T17:27:10.553Z
- 执行者：zcode-batch-003-21
- 测试框架：node:assert 契约/集成测试（npm test 聚合）
- 覆盖率：82%

## 总结

一键派发codex改走批量实施方案：调度器新增dispatchItem（共用hub/项目锁/账本/结算，不改写开关与scope），server以POST /api/dispatch/codex/item替换旧.command+open端点并清理OPEN_CMD/ATB_CODEX_CLI接缝，前端launchCodex改调新端点成功后打开批量实施抽屉Codex页签，移除codex://深链与剪贴板兜底及lib旧构建函数；新增D21-D25/T7并重写dispatch-launch契约与集成用例，npm test全量46文件0失败

## 明细

（可粘贴命令输出、失败用例说明等）
