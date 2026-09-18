# REQ-20260904-001 分派给 codex 和 zcode 的提示词增加一句：将当前会话名改为单号

- 状态：in-progress（zcode-session-rename 实施中）
- 创建：2026-09-04T15:36:03.750Z

## 描述

Status Board「一键派发」生成的提示词（`scripts/web/app.js` 的 `dispatchPrompt`）目前只含任务入口信息：
zcode 版首行 `/dev <单号>`，codex 版是加载 agent-team-board skill 的指引。派发出去的会话在
Project Board / 会话列表里只有自动标题，多会话并行时不易一眼对上单号。

本次在两版提示词里各增加一句：**请将当前会话名改为 `<单号>`**，让被派发的 Agent 开始工作前先把
会话名改成单号（REQ-/BUG-YYYYMMDD-NNN），与 REQ-20260901-005 的会话名约定衔接——认领者标识之外，
会话本身也按单号可寻址。

## 验收标准

- [ ] zcode 版提示词在 `/dev <单号>` 行之外，含「请将当前会话名改为 <单号>」一句（带单号变量）
- [ ] codex 版提示词含同一句改名指令（带单号变量）
- [ ] 两版句子措辞一致，均用模板变量注入单号，不硬编码示例号
- [ ] 既有派发语义不变：zcode 版首行仍是 `/dev <单号>`，codex 版仍是 skill 指引措辞
- [ ] `scripts/tests/dispatch.test.mjs` 新增契约用例，`npm test` 全绿
