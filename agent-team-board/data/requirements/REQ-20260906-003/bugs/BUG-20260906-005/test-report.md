# 测试报告 — BUG-20260906-005 Codex 依赖全部阻塞时错误显示队列已空

- 时间：2026-09-06T15:51:40.906Z
- 执行者：zcode-batch-002-01
- 测试框架：node:test 自定义 runner + 静态契约断言（scheduler D18 / codex-ui U11 / 探针 C-A2）
- 覆盖率：100%

## 总结

修复依赖阻塞误报队列已空：selectCandidate 收集仅因依赖未满足被排除的已接受条目，无候选时返回 waiting=deps-blocked（count+items+unsatisfied，截断防膨胀；scope-empty/empty 语义不变）；UI 新增 cxDepBlockedText 显示被阻塞条目与前置 ID 并明示与空队列不同、前置验收后自动继续，动态值全 esc。新增 D18（含前置 done 后自动派发、多条目截断）U11 先红后绿，探针 C-A2 转绿；全量 npm test 仅 detail-close-btn T2 既有在途失败（BUG-20260906-011~013/016~018，与本修复无关）。引入来源：REQ-20260906-003。

## 明细

（可粘贴命令输出、失败用例说明等）
