# 测试报告 — BUG-20260910-001 批量完善的提示词还有 zcode 的词语，请修复，一并排查下其他类似地方的实现

- 时间：2026-09-09T23:27:19.840Z
- 执行者：zcode-batch-029-1
- 测试框架：node:assert + CLI/HTTP 集成（scripts/tests/run-all.mjs）
- 覆盖率：85%

## 总结

新增 normalizePromptForDisplay 展示层全量归一（存量完善三变体/开发侧旧行/旧领取前缀，账本不回写），切换 8 处透出点（refine publicView+create、开发 create/prompt/current+CLI），插件源 worker-spec/SKILL/dev.md 通用化，oncall 与会话名约定不修（结论见 design.md）；新增 13 用例跑红转绿，全量 128 文件 0 失败，真实 48 存量账本归一零残留

## 明细

（可粘贴命令输出、失败用例说明等）
