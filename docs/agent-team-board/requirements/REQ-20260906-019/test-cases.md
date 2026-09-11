# 测试用例 — REQ-20260906-019 Codex 一键派发要使用批量实施的方案，放弃当前的方案

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 分布：scheduler.test.mjs（D21～D25）、dispatch-api.test.mjs（T7）、dispatch-launch.test.mjs（重写：U1～U4 / C1～C2 / I1～I3）、dispatch.test.mjs（P1/P1.5 改写）。
> 结果：2026-09-07 全部通过（定向套件 + `npm test` 全量 46 文件 0 失败）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D21 | dispatchItem：未开启自动派发开关也能为指定 accepted 条目创建 run，后台执行并落账 reported（fake CLI worker-ok），不改写 enabled | P0 | 通过 |
| D22 | dispatchItem：条目不存在 / 非 accepted（submitted、in-progress）拒绝 ok:false 且不建 run | P0 | 通过 |
| D23 | dispatchItem：依赖未满足拒绝，并指出未满足前置 | P1 | 通过 |
| D24 | dispatchItem：当前有执行进行中拒绝；上一项收尾后可再派 | P0 | 通过 |
| D25 | dispatchItem：项目被手工认领（unknown in-progress 无账本）占用时拒绝 | P1 | 通过 |
| T7 | API 端到端：POST /api/dispatch/codex/item 合法单号 → run 创建并 reported（不 toggle 开关）；非法单号 400；不存在条目 ok:false | P0 | 通过 |
| U1 | 前端 launchCodex：调用新端点 /api/dispatch/codex/item，无 codex:// 深链、无剪贴板调用，成功打开批量实施抽屉 Codex 页签 | P0 | 通过 |
| U2 | 前端按钮与文案：codex 按钮 title 说明后台执行且指向 Codex 页签；zcode 按钮/提示词/深链不变 | P1 | 通过 |
| U3 | 服务端契约：注册新端点、校验单号（ITEM_ID_RE）、调用调度器 dispatchItem；旧端点与 .command 生成（mkdtempSync/.command/OPEN_CMD）移除 | P0 | 通过 |
| U4 | lib 清理契约：buildCommandScript/buildCodexThreadUrl/shQuote/CODEX_CLI_DEFAULT 不再导出；ITEM_ID_RE、buildZcodeWorkspaceUrl 保留可用 | P0 | 通过 |
| C1 | dispatchPrompt 仅 zcode 版：/dev 首行 + 单号 + 「请将当前会话名改为 单号 标题」；无 codex 版提示词残留 | P1 | 通过 |
| C2 | 回归：launchZcode 剪贴板 + zcode://workspace/open 深链不变 | P1 | 通过 |
| I1 | 集成：临时 server + 假 CLI，POST /api/dispatch/codex/item 后 runs 账本出现该条目并 reported；无 atb-dispatch-* 新增（终端脚本零副作用） | P0 | 通过 |
| I2 | 集成：未配置 CLI 时返回 ok:false（原因含「CLI」），不产生 run、不弹终端 | P1 | 通过 |
| I3 | 集成：非法单号（路径穿越形态）400，不创建任何执行记录 | P1 | 通过 |
