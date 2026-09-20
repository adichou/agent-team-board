# 测试用例 — REQ-20260904-001 分派给 codex 和 zcode 的提示词增加一句：将当前会话名改为单号

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 改动为前端文案，用 `scripts/tests/dispatch.test.mjs` 静态契约断言（沿用既有测试形态）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | `dispatchPrompt` 模板中「请将当前会话名改为 ${it.id}」恰好出现两次（zcode/codex 各一），沿用单号模板变量而非硬编码 | P1 | ✓ |
| C2 | 既有语义回归：zcode 版仍以 `/dev ` 入口且含 it.id/it.title，codex 版仍含 skill 指引（原 P1 用例继续通过） | P1 | ✓ |
| M1 | 手工：看板点「派发给 zcode / codex」，剪贴板或拉起的提示词含改名句，Agent 会话名变为单号（用户验收） | P1 | 待用户验收 |
