# 设计 — REQ-20260902-001 收窄 agent-team-board SKILL.md 触发描述，仅保留强信号避免误触发

> 由 Agent 在 /dev 阶段一补充，人可随时批注。**状态：待对齐（方案初稿，未经人工确认不得实施）。**

## 背景

（README 已给归因）现 frontmatter description 塞满「需求/Bug/看板/认领/状态流转」等日常高频词，任何项目
会话聊到这些词都会自动挂载约 10KB 的 SKILL 正文，且注入后逐轮重发放大 token 消耗。命令（/req /bug /dev
/board）是显式入口，不依赖自然语言触发——泛化词只带来误触发成本。

## 方案（初稿，待对齐）

**只改 frontmatter description 一行**，正文不动。新描述（强信号 + 一句话定位）：

```yaml
description: Agent Team Board 看板工具（atb）：用 /req /bug /dev /board 命令或直接提及 atb、agent-team-board、Status Board、REQ-/BUG-YYYYMMDD-NNN 编号时使用。规定 docs/agent-team-board 数据规范、两阶段 TDD 流程与状态铁律。
```

- 删除的泛化词：需求、提需求、Bug、缺陷、看板（保留「Agent Team Board 看板工具」整体专名——它是强信号
  专名的一部分，不构成泛化匹配）、认领任务、开发某个需求、状态流转、submitted/accepted/in-progress/done、
  test-report、待对齐等流程细节词。
- 强信号保留：`/req` `/bug` `/dev` `/board`、`atb`、`agent-team-board`、`Status Board`、`REQ-/BUG-编号格式`。
- 「一句话定位」兼顾用途说明（验收 3）。

## 影响面

`skills/agent-team-board/SKILL.md` frontmatter 一行；两端触发行为同步（弱提及不再自动挂载）。命令入口、
正文、其他文件零改动。

## 风险与边界

- 副作用（README 已声明）：自然语言弱提及（"帮我记个 bug"）不再自动触发——需显式 /bug 或提及 atb/编号。
  若你在某些项目希望弱触发，可在该项目 AGENTS.md 里自行加一句指引（不影响本 skill）。
- Codex 端与 ZCode 端描述共用（同一 SKILL.md），行为一致；验收 5 的 remove+add 重装由你操作。

## 测试（对齐后执行）

traceability 或新增断言：description 不含泛化词清单、含全部强信号、长度合理（<300 字符）。
