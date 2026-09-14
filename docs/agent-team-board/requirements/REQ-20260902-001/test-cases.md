# 测试用例 — REQ-20260902-001 收窄 SKILL 触发描述

> S1–S4 由 `scripts/tests/skill-desc.test.mjs` 覆盖。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | 强信号完整保留（/req /bug /dev /board、atb、agent-team-board、Status Board、REQ-/BUG- 编号） | P0 | ✓ |
| S2 | 泛化触发词移除（提需求/需求/缺陷/认领/状态流转/submitted/accepted/in-progress/done/待对齐等） | P0 | ✓ |
| S3 | 仍说明用途：一句话定位，30–300 字符 | P1 | ✓ |
| S4 | 正文结构、CLI、TDD 流程与命令入口引用未受影响 | P0 | ✓ |

## 执行记录（2026-09-02）

- `node scripts/tests/skill-desc.test.mjs` S1–S4 全绿（先红后绿：初跑 S1–S3 失败——强信号缺失项与 331 字符长描述）。
- 新 description（109 字符）："Agent Team Board 看板工具（atb）：用 /req /bug /dev /board 命令，或直接提及 atb、agent-team-board、Status Board、REQ-/BUG-YYYYMMDD-NNN 编号时使用。规定 docs/agent-team-board 数据规范、两阶段 TDD 流程与状态铁律。"
- 11 套测试回归全绿。验收 5（Codex 端 remove+add 重装验证）由用户操作。
