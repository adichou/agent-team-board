# 测试用例 — BUG-20260902-001 Codex 命令迁移缺失

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | dev.md ≤3600 字节（硬上限断言，防回归） | P0 | ✓ |
| T2 | loop-mode 契约 7 条全绿（压缩后骨架 + SKILL 细则兜底） | P0 | ✓ |
| T3 | 压缩后 dev.md 保留契约关键词：/dev loop、循环模式、直到没有 accepted、失败跳过、批量对齐、总结 | P0 | ✓ |
| T4 | Codex 沙箱/真实重装后 migrated-command-skills 含 4 个 source-command-* | P1 | ◐（沙箱压缩版可行已由登记时验证；真实重装由用户操作） |
