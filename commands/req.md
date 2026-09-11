---
description: 创建一条新需求（REQ）
argument-hint: <需求描述>
skills: agent-team-board
---

按 `agent-team-board` skill 的数据规范，为下面的描述创建需求：

$ARGUMENTS

步骤：

1. 项目尚未初始化时先执行 `node <插件根>/scripts/atb.mjs init`。
2. 提炼一句不超过 120 字的标题；细节放 `--desc`。
   **涉及 UI 时必须在描述中讲清界面与交互设计**：界面布局（哪些元素、放哪）、交互行为（点击/输入后发生什么、
   状态如何变化）、异常与反馈（空态/失败提示），并在 README 提供「界面展示」——创建阶段可先内嵌 ASCII 线框 /
   结构示意，让人工在接受前直观看到界面形态（REQ-20260908-015；完善批次按此判定「涉及 UI 需界面展示」）。
   完善阶段会把界面展示升级为条目目录内可交互 `ui-demo.html` 演示（README 链接并保留文字说明，
   REQ-20260908-021），创建时不强制。
   复杂交互逐条列出；纯后端/流程类需求可省略。
3. 执行 `node <插件根>/scripts/atb.mjs new req "<标题>" --desc "<描述>"`。
4. 向用户回报新编号（形如 REQ-YYYYMMDD-NNN），并提醒：需求处于 submitted，需要人工到 Status Board 点「接受」
   后 Agent 才能认领开发。不要替用户接受。接受即视为对描述与 UI 设计的认可。
