# 设计 — REQ-20260904-001 分派给 codex 和 zcode 的提示词增加一句：将当前会话名改为单号

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- 派发提示词由前端 `scripts/web/app.js` 的 `dispatchPrompt(agent, it)` 生成（REQ-20260902-004 引入、
  REQ-20260903-003 沿用）：
  - zcode 版：`/dev <单号>   # <标题>（看板派发；README/design 见条目目录）`
  - codex 版：`请加载 agent-team-board skill（atb），按其 TDD 流程认领并开发看板条目 <单号>：<标题>。…`
- 会话名约定见 REQ-20260901-005（认领时 `--by` 语义名）。本需求把标识再推进一步：Agent 工具自身的
  会话名也改成单号，会话列表与看板单号一一对应。

## 方案

纯文案改动，不动派发链路（剪贴板 / 深链 / `.command` 生成均不受影响）：

- codex 版在句首插入改名指令，再接原有 skill 指引：
  `请将当前会话名改为 <单号>，然后加载 agent-team-board skill（atb），…`
- zcode 版在 `/dev` 行后追加一行同一句：`请将当前会话名改为 <单号>。`
  首行仍以 `/dev <单号>` 开头，「自动标题含单号」的既有效果保持不变。

契约测试：`scripts/tests/dispatch.test.mjs` 新增用例，断言 `dispatchPrompt` 模板中
`请将当前会话名改为 ${it.id}` 恰好出现两次（zcode/codex 各一），且沿用模板变量而非硬编码。

## 风险与边界

- Agent 能否真的改会话名取决于工具自身能力（ZCode / Codex 的会话重命名入口），本需求只约束提示词
  文本；Agent 若做不到会如实说明，不阻塞认领与开发流程。
- 提示词经 `shQuote` 进 `.command`、经 `encodeURIComponent` 进深链，中文与模板变量均已覆盖
  （REQ-20260903-003 的 U1/U5 注入用例），无新增注入面。
