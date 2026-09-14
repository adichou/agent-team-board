# 测试报告 — REQ-20260902-001 收窄 agent-team-board SKILL.md 触发描述，仅保留强信号避免误触发

- 时间：2026-09-02T10:08:23.000Z
- 执行者：atb-0902-4838
- 测试框架：node:assert 静态契约（skill-desc.test.mjs S1–S4）
- 覆盖率：未统计

## 总结

SKILL 触发描述收窄完成（按对齐方案）：frontmatter description 从 331 字符的泛化词长文改为 109 字符强信号版——仅 /req /bug /dev /board 命令、atb、agent-team-board、Status Board、REQ-/BUG-YYYYMMDD-NNN 编号触发，并保留一句话用途定位；移除全部泛化词（需求/提需求/Bug 泛指/缺陷/看板泛指/认领任务/状态流转/submitted 等状态名/test-report），避免日常开发会话误触发灌入 10KB 正文并逐轮重发的 token 放大。正文（数据规范/铁律/CLI/流程）与命令入口零改动。TDD：新增 skill-desc.test.mjs S1–S4 先红后绿全过；11 套测试回归全绿。副作用（README 已声明）：弱提及（如「帮我记个 bug」）不再自动挂载，需显式 /bug 或提及 atb/编号；Codex 端 remove+add 重装验证由用户操作。版本 0.3.9→0.3.10。

## 明细

（可粘贴命令输出、失败用例说明等）
