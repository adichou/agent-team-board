# 测试用例 — REQ-20260910-002 任务模块中的提示词要新增打开 zcode 工作区和打开 codex 工作区

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 设计依据：design.md D1–D4。自动化覆盖 W1–W12；E1–E3 为人工/实机项，结论记 test-report.md。
> 自动化实现：`scripts/tests/workspace-entry-20260910-002.test.mjs`（W12 为全量回归）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| W1 | lib 纯函数：`buildZcodeWorkspaceUrl` / `buildCodexWorkspaceUrl` 前缀正确；项目根含中文、空格、`&`、`?`、`#`、`%`、引号时 `encodeURIComponent` 生效（URL 编码 + 路径注入转义） | 高 | 通过 |
| W2 | lib 纯函数：`detectWorkspaceApps` darwin 下按注入 exists 返回两宿主存在性；非 darwin 一律 false；默认实现走真实 fs | 高 | 通过 |
| W3 | 服务端：`GET /api/workspace/apps` 返回 200 且 `{ zcode: boolean, codex: boolean }`（起真实 server 实测，不断言本机具体值）；不依赖项目初始化 | 高 | 通过 |
| W4 | 前端渲染（批量开发）：提示词分区并列 `#batchOpenZcode`（title 句式零变化）与 `#batchOpenCodex`，均带 `data-open-ws`；「重新复制 / 复制续接提示词」保留 | 高 | 通过 |
| W5 | 前端渲染（批量完善）：提示词分区新增 `#refineOpenZcode` / `#refineOpenCodex`，与「重新复制」并存、位于 `<pre id="refinePrompt">` 之后的底部工具行（与开发侧同款） | 高 | 通过 |
| W6 | 空态：批量完善缺 `prompt` 时工具行随提示词一起隐藏（仅空态说明）；启动区（两面板无批次态）不出现任何 `data-open-ws` 入口 | 中 | 通过 |
| W7 | 未选项目：`state.project` 为空时两面板全部工作区按钮 `disabled` + title 含「未选择项目」；有项目时不 disabled、title 为正常口径（含「不会自动」字样） | 高 | 通过 |
| W8 | 通道不可用：`state.workspaceApps.codex === false` 时 Codex 按钮 disabled + title 含 ChatGPT.app 说明，Zcode 按钮不受影响；`zcode === false` 对称；`undefined`（未知/探测失败）时按钮保持可用（回落现状口径） | 高 | 通过 |
| W9 | 点击行为（vm）：两面板 zcode 按钮点击 → `location.href = zcode://workspace/open?path=<encoded 项目根>`（既有行为零回归）；codex 按钮 → `codex://threads/new?path=<encoded>`（无 prompt 参数）；disabled 按钮点击无效果 | 高 | 通过 |
| W10 | 探测拉取：`refreshWorkspaceApps` loaded 防重（只请求一次）；出现明确 false 才重渲染；`api` 失败保持未知不抛错 | 中 | 通过 |
| W11 | 零回归源码契约：`bindBatchDrawer` 仍绑定 `#batchRecopy` / `#batchResumeCopy` / `#refineRecopy`；`generatePrompt` / `buildRefinePrompt` 不被本条改动；服务端 `/api/batch/*`、`/api/refine/*` 路由集合无增删 | 高 | 通过 |
| W12 | 全量回归：`node scripts/tests/run-all.mjs` 全部通过（含既有 tasks-tabs / batch-ui / agent-generic 等） | 高 | 通过（130 文件 0 失败） |
| E1 | 实机：点击「打开 Zcode 工作区」打开/聚焦 ZCode 本项目工作区（人工） | 中 | 待人工验收（机制与既有按钮相同，未改动） |
| E2 | 实机：点击「打开 Codex 工作区」打开/聚焦 ChatGPT.app 且新会话输入框定位到本项目根，不注入不发送 | 中 | 深链机制已实机验证（见 test-report「实机验证」）；按钮链路待人工验收 |
| E3 | 实机：浏览器直连与 Electron（`npm run app`）两场景按钮可用性一致（人工） | 中 | 机制层论证一致（见 test-report）；实机走查待人工验收 |
