# 测试用例 — REQ-20260830-003 /dev 支持 loop：连续开发直到所有已接受条目完成

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 本需求为提示词/文档型，测试形态为**文档契约测试**（`scripts/tests/loop-mode.test.mjs`），断言命令与 skill 文档中必须存在的 loop 契约点。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | `commands/dev.md` 的 `argument-hint` 含 `loop` | P0 | ✅ 绿 |
| 2 | dev.md 有「循环模式」章节，说明 `/dev loop` 反复执行 next 语义直到无 accepted | P0 | ✅ 绿 |
| 3 | dev.md 声明跳过规则：claim 冲突跳过；单条目失败不中断循环 | P0 | ✅ 绿 |
| 4 | dev.md 声明循环结束输出总结（完成/跳过/剩余状态分布） | P1 | ✅ 绿 |
| 5 | dev.md 保持 `/dev <ID>` 与 `/dev next` 语义说明（兼容不破坏） | P0 | ✅ 绿 |
| 6 | dev.md 声明铁律不变：不置 accepted/done，submitted 不入选 | P0 | ✅ 绿 |
| 7 | `skills/agent-team-board/SKILL.md` 会话调度规则包含 loop 语义（单会话串行认领不变） | P1 | ✅ 绿 |
