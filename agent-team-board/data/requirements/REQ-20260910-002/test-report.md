# 测试报告 — REQ-20260910-002 任务模块中的提示词要新增打开 zcode 工作区和打开 codex 工作区

- 时间：2026-09-10T00:40:09.976Z
- 执行者：zcode-batch-029-1
- 测试框架：node:assert 契约/行为测试（vm 双沙箱）+ 实机深链验证
- 覆盖率：100%

## 总结

两子面板提示词页签新增并列「打开 Zcode/Codex 工作区」按钮（共用 workspaceOpenRowHtml + data-open-ws 绑定）：zcode 沿用官方 workspace/open 深链零回归；codex 经实机验证采用 codex://threads/new?path=（不传 prompt，不注入不发送；ChatGPT.app 无纯工作区路由，见 design D1）；新增只读端点 GET /api/workspace/apps 探测深链宿主，明确缺位才禁用+title 说明；未选项目按钮禁用+说明；完善侧缺 prompt 空态按钮随提示词隐藏。新增 workspace-entry-20260910-002.test.mjs 11 用例全绿；run-all 130 文件 0 失败（batch-ui U10/refine-ui/dispatch-launch U1 三处旧契约按新条目语义精化，见 test-report.md）

## 明细

（可粘贴命令输出、失败用例说明等）

### 改动清单

| 文件 | 改动 |
| --- | --- |
| `scripts/lib/dispatch.mjs` | 新增 `buildCodexWorkspaceUrl()`（threads/new?path=，不传 prompt）与 `detectWorkspaceApps()`（宿主 app 存在性探测，exists/platform 可注入）；`buildZcodeWorkspaceUrl`、`ITEM_ID_RE` 未动 |
| `scripts/server.mjs` | 新增只读端点 `GET /api/workspace/apps`（`dispatch.detectWorkspaceApps()`）；既有路由零改动 |
| `scripts/web/app.js` | 新增 `workspaceOpenRowHtml(prefix)`（两面板共用工具行）、`refreshWorkspaceApps()`（一次性宿主探测）、`state.workspaceApps`；批量开发提示词分区改用共用工具行（`#batchOpenZcode` title 句式零变化，新增 `#batchOpenCodex`）；批量完善提示词分区新增 `#refineOpenZcode` / `#refineOpenCodex`（缺 prompt 空态随提示词隐藏）；`bindBatchDrawer()` 统一按 `[data-open-ws]` 绑定并触发探测；既有复制类绑定未动 |
| `scripts/tests/workspace-entry-20260910-002.test.mjs` | 新增（W1–W11 契约 + 行为测试） |
| `scripts/tests/batch-ui.test.mjs` | U10 断言精化：允许否定式「不会自动新建/发送」标题（本条 title 口径），剔除否定式后仍禁肯定式声称；U16 提取夹具补 `workspaceOpenRowHtml` 桩（沿用 taskPaneShell 桩先例） |
| `scripts/tests/refine-ui.test.mjs` | R12-8/9/10 提取夹具补 `workspaceOpenRowHtml` 桩（同上） |
| `scripts/tests/dispatch-launch.test.mjs` | U1 第三条断言收敛：`codex://threads/new` 整体禁令改为 `codex://threads/new?prompt=`（prompt 注入式）——threads/new?path= 为本条「打开工作区」通道（仅打开、不注入），与 REQ-20260906-019 移除的「一键派发深链降级」（自动执行链路）正交 |

### 测试结论

- `node scripts/tests/workspace-entry-20260910-002.test.mjs`：11/11 通过（先跑红 10 项失败 → 实现后全绿）。
- `node scripts/tests/run-all.mjs`：130 个测试文件全部通过（0 失败；body-limit 曾出现一次随机端口环境性闪失，单测复跑 6 次与全量复跑 4 次均通过，与本条无关——该测试不经过本条任何改动路径）。

### 实机验证（Codex 通道，design D1）

环境：macOS（darwin arm64），ChatGPT.app 26.901.41600（`com.openai.codex`，内置 codex-cli 0.153.4）。

1. **scheme**：Info.plist `CFBundleURLTypes` 注册 `codex` scheme；`open 'codex://threads/new?path=<看板项目根>'` exit 0（OS 接受）。
2. **路由静态核查**（app.asar 深链路由器源码）：`codex://` 无纯 workspace/open 类路由（`space` 返回 null）；`threads/new` 识别 `path` 参数并经「resolve → stat isDirectory」解析为新会话工作根目录，路径不存在回落默认。
3. **触发后状态**：ChatGPT.app 激活并创建新会话草稿上下文（`~/.codex/thread-writer-locks/` 瞬时锁文件 + global-state capability 标记）；`~/.codex/state_5.sqlite` threads 表无持久化行、`~/.codex/sessions` 无 rollout 文件、未发送任何内容——只打开到「本项目新会话输入框」草稿态，持久化/发送发生在用户首次发送时。
4. **局限**：无头环境无法截图确认输入框可视绑定路径；以静态路由分析（path 须为存在目录）+ 草稿创建为证。深链未文档化，版本升级可能变化（失效表现为 app 被拉起但停默认视图，不会静默无反应）。

### 既有契约冲突的处理（两处，均在本条目语义下收敛）

1. `dispatch-launch U1`「不得残留 codex 深链降级」：REQ-20260906-019 移除的是**一键派发自动执行**的深链降级（prompt 注入式）；本条经接受的 README 明确要求补 Codex 打开工作区通道且 design 论证 threads/new?path= 为唯一可用路由（不传 prompt、不发送）。断言收敛为禁 `threads/new?prompt=`，一键派发链路移除契约其余部分（无 data-dispatch、无派发函数、无 .command 端点）全部保留并通过。
2. `batch-ui U10`「不得声称自动新建/发送」：原裸正则把否定式说明「深链不会自动发送」误判为声称；改为剔除否定式后再查肯定式声称，原意图不变。

### 人工验收遗留（E1–E3）

- E1 Zcode 按钮：机制与代码路径零改动（同既有 `#batchOpenZcode`），浏览器实测沿用既有验收结论。
- E2 Codex 按钮链路：深链机制已实机验证（上节）；按钮端到端（看板 UI 点击）建议人工点一次复核输入框定位。
- E3 Electron（`npm run app`）与浏览器一致性：两按钮与既有 Zcode 按钮走同一 `location.href` 深链机制与同源 `/api/workspace/apps` 请求（electron/main.mjs 无外部协议拦截、未改动），机制层一致；本会话未启动桌面 app 实测（不自动运行 app 的全局规则），留人工验收。
