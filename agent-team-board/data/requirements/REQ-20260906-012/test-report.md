# 测试报告 — REQ-20260906-012 单条派发任务中，会话名更改为单号 标题

- 时间：2026-09-06T04:07:41.506Z
- 执行者：atb-0906-0cae
- 测试框架：node:assert/strict 静态契约 + 自建 runner（scripts/tests/run-all.mjs）
- 覆盖率：100%

## 总结

dispatchPrompt 两版改名指令由「单号」升级为「单号 标题」（scripts/web/app.js:456-461，zcode 版第二行与 codex 版句首）；P1.5 契约同步改造（新形态恰好 2 次 + 旧形态残留 0）先跑红后跑绿；dispatch.test/dispatch-launch 全绿、node --check 通过；scripts/lib/dispatch.mjs 与深链未动（终端标签标题仍单号）；全量 31 测试文件与基线一致，5 个既有失败均属并行中的批量派发/调度需求（batch-*/scheduler），与本条无关。

## 明细

（可粘贴命令输出、失败用例说明等）
