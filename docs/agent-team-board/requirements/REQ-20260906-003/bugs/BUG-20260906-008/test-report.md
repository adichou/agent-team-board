# 测试报告 — BUG-20260906-008 执行详情恢复本项未绑定当前 runId 可能恢复其他条目

- 时间：2026-09-06T16:09:36.279Z
- 执行者：zcode-batch-002-08
- 测试框架：node:test
- 覆盖率：90%

## 总结

resumeItem(runId) 必须绑定当前查看的 run：scheduler 按号精确取 run 并核对 blocked/interrupted 与确切 threadId 后经 hub+impl.lock 占用续跑，缺号/不存在/状态不符/无会话均拒绝不再代选；server 端点校验 runId 非空字符串否则 400；前端请求体携带 detail.runId。新增 scheduler D20 / dispatch-api T4b / codex-ui U12 先红后绿，探针 C-A5 转绿（8/8）。run-all 42/43，唯一失败 detail-close-btn 为既有 BUG-20260906-017。引入来源 REQ-20260906-003 已核验并写入 README。

## 明细

（可粘贴命令输出、失败用例说明等）
