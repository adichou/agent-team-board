# 设计 — REQ-20260906-012 单条派发任务中，会话名更改为单号 标题

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260904-001 在两版派发提示词里各加了一句「请将当前会话名改为 <单号>」，使被派发会话在会话
列表里可按单号寻址。但单号本身不承载任务内容，多会话并行时仍需点开比对。看板抽屉导航的悬停提示
（`drawerNavBtn` 的 `${target.id} ${target.title}`）已经是「单号 标题」形态，会话名对齐该格式即可
不点开辨识任务。

## 方案

改动点唯一：`scripts/web/app.js` 的 `dispatchPrompt()`（scripts/web/app.js:456-461）。

- codex 版句首：`请将当前会话名改为 ${it.id}` → `请将当前会话名改为 ${it.id} ${it.title}`（后续
  「按其 TDD 流程认领并开发看板条目 ${it.id}：${it.title}」保持不变）。
- zcode 版第二行：`请将当前会话名改为 ${it.id}。` → `请将当前会话名改为 ${it.id} ${it.title}。`
  （首行 `/dev ${it.id}   # ${it.title}…` 不动）。
- 前端 `it` 来自 `/api/board`，本就携带 `id` 与 `title`，无新增取数逻辑。
- 函数上方注释补一行 REQ-20260906-012 说明。

契约测试（`scripts/tests/dispatch.test.mjs` P1.5）同步：正则
`/请将当前会话名改为 \$\{it\.id\}/g` → `/请将当前会话名改为 \$\{it\.id\} \$\{it\.title\}/g`，
仍断言恰好 2 次（zcode/codex 各一）；用例名同步标注 001→012 演进。

**不改** `scripts/lib/dispatch.mjs`：

- 终端标签标题（OSC 0 `printf` 行）保持单号。`ITEM_ID_RE` 兼作 .command 文件名与标签标题白名单，
  标题是自由文本，拼进终端转义序列会扩大注入面而收益有限；且需求范围是「会话名」而非终端标签。
- 深链构造（`buildZcodeWorkspaceUrl` / `buildCodexThreadUrl`）不变；server `/api/dispatch/codex`
  的 body 仍只传 `id` + `prompt`，无需传 title。

## 风险与边界

- 标题过长 → 会话名过长：接受，与悬停提示同格式，标题本身就是任务摘要。
- 标题含空格/标点：会话名是自由文本，无格式约束，无影响。
- 批量派发（`scripts/lib/batch.mjs`、codex-adapter 的 worker 认领名）不在本条范围：那是认领者
  标识（--by）体系，与单条派发的会话名指令是两回事。

## 实施记录

- 2026-09-06（zcode-dispatch-session-title）：
  - 基线：`node scripts/tests/dispatch.test.mjs`、`dispatch-launch.test.mjs` 全绿；全量 31 文件中
    5 个既有失败（batch-cli/batch-core/batch-serve/batch-ui/scheduler，属并行进行中的批量派发需求，
    与本条无关）。
  - 跑红：`dispatch.test.mjs` P1.5 改造为新契约（新形态恰好 2 次 + 旧形态残留为 0），运行 1 用例失败。
  - 跑绿：`app.js` `dispatchPrompt()` 两处改名指令 `${it.id}` → `${it.id} ${it.title}`，函数注释补
    REQ-20260906-012 一行；dispatch 两套测试全绿，`node --check` 通过。
  - `scripts/lib/dispatch.mjs`、server、深链均未改动。
