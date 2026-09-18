# 设计 — REQ-20260910-002 任务模块中的提示词要新增打开 zcode 工作区和打开 codex 工作区

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

见 README「背景 / 现状」：提示词已通用化（REQ-20260909-011），但工作区快捷入口只有批量开发一侧的
Zcode 一个按钮；批量完善一侧没有，Codex 一端完全没有。本设计定夺 README「待确认」四项，核心是
Codex「打开工作区」机制。

## 方案

（技术选型、接口设计、影响面）

### D1 Codex 打开通道（核心选型）：`codex://threads/new?path=<项目根>` 深链（候选 A 变体）

**实机验证过程与结论（2026-09-10，本机 ChatGPT.app 26.901.41600 / codex-cli 0.153.4）**：

1. **scheme 注册**：`/Applications/ChatGPT.app/Contents/Info.plist` 的 `CFBundleURLTypes` 注册
   `codex` scheme（`com.openai.codex`）——`codex://` 深链宿主即 ChatGPT.app。
2. **路由静态核查**（解包 `app.asar` 提取深链路由器源码）：`codex://` 全部 host 路由为
   `plugins / mcp-app / activate / pets / automations / codex-app / connector / chatgpt / browser /
   launch / new / settings / shared-thread / space / skills / threads`，**没有与
   `zcode://workspace/open` 对应的纯「打开工作区」路由**（`space` 直接返回 null）。
   `threads/new` 路由识别 `browserUrl / mode / originUrl / path / prompt` 参数；带 `path` 时经
   「resolve → stat isDirectory → 返回目录」把该路径解析为新会话的工作根目录（另有按 git
   originUrl 匹配工作区的通道），路径不存在则回落默认。
3. **实机触发**：`open 'codex://threads/new?path=<看板项目根>'` → OS 接受（exit 0）、ChatGPT.app
   激活并创建新会话草稿上下文（`~/.codex/thread-writer-locks/` 出现瞬时锁文件、
   `~/.codex/.codex-global-state.json` 出现该 thread id 的 capability 标记）；而
   `~/.codex/state_5.sqlite` threads 表**无**持久化行、`~/.codex/sessions` **无** rollout 文件、
   未发送任何内容——即深链只把 app 打开到「本项目新会话输入框」的草稿态，持久化与发送都发生在
   用户首次发送时。

**结论**：采用 `codex://threads/new?path=<encodeURIComponent(项目根)>`，**不传 `prompt` 参数**
（不注入、不发送任何文本，用户手动粘贴提示词）。

- 与 README 目标 3「不自动新建会话」的口径说明：Codex 桌面端没有纯 workspace/open 路由（见上），
  `threads/new?path=` 是唯一能把「本项目工作区」带进去的已验证通道。Zcode 流程是「打开工作区 →
  手动新建会话 → 粘贴」，Codex 端等价于把「新建会话」一步并入深链（落在输入框草稿，不发送），
  「手动粘贴」这一关键动作保持不变。按钮 title 如实说明，不与 Zcode 句式混淆。
- **候选 B（CLI 拉终端）不选**：REQ-20260906-019 已明确移除「.command + open 拉终端」链路（弹
  终端、无账本、体验重），恢复它与该决策冲突，且本条只需「打开」不需要服务端拉起进程。
- **候选 C（只开 app 不绑项目）不选**：不满足 README 目标 1/3「打开**本项目**在对应 Agent 中的
  工作区」，能力最弱。
- **风险与降级**：该深链未公开文档化，ChatGPT.app 版本升级可能变化（版本演进记录：26.901.41600
  已验证）。降级链：端点探测 ChatGPT.app 缺位 → 按钮禁用 + title 说明（见 D2）；若未来路由失效但
  app 存在，OS 仍会拉起 app（scheme 常驻），最坏落在 app 默认视图——不会静默无反应。

### D2 服务端最小配合：新增只读端点 `GET /api/workspace/apps`

- 响应 `{ zcode: boolean, codex: boolean }`：darwin 按 `/Applications/ZCode.app`、
  `/Applications/ChatGPT.app` 存在性探测（即 `zcode://` / `codex://` 深链宿主）；非 darwin 一律
  false（两个桌面 app 均为 macOS app）。
- 探测逻辑封装为纯函数 `detectWorkspaceApps({ exists, platform })` 放 `scripts/lib/dispatch.mjs`
  （与 `buildZcodeWorkspaceUrl` 并列，exists 可注入便于单测）。
- **边界**：仅此一个只读端点，不改批次账本、不改 `/api/batch/*`、`/api/refine/*` 任何既有响应
  结构（验收零变化项）。
- **探测语义**：探测不到 ≠ 深链必然失败（app 可能在非默认路径），禁用 + title 说明属于「如实
  反馈」而非拦截；端点本身失败时前端保持「未知」态，按钮维持可用，行为回落现状（深链触发静默，
  宿主存在与否由 OS 决定）——避免探测通道故障反而砍掉功能入口。

### D3 前端改动（`scripts/web/app.js`，两面板共用渲染与绑定）

1. **共用工具行** `workspaceOpenRowHtml(prefix)`：`<div class="dep-toolbar">` 内两枚
   `btn`（`data-open-ws="zcode|codex"`，id 前缀区分面板）：
   - 批量开发（运行态提示词页签）：复用既有 `#batchOpenZcode`（title 句式零变化）+ 新增
     `#batchOpenCodex`，替换现有单按钮工具行；
   - 批量完善（运行态提示词页签）：新增 `#refineOpenZcode` + `#refineOpenCodex`，位于
     `<pre id="refinePrompt">` 之下的底部工具行（与开发侧同款布局）。
   - title 口径：Zcode 沿用现状句式（「打开/聚焦本项目 Zcode 工作区；需手动新建会话并粘贴，深链
     不会自动新建或发送」）；Codex 为「打开/聚焦本项目 Codex 工作区（新会话输入框定位到本项目
     根）；需手动粘贴提示词，深链不会自动发送」。
2. **共用绑定**：`bindBatchDrawer()` 以 `drawer.querySelectorAll('[data-open-ws]')` 统一绑定，
   点击时 `state.project` 非空才构造深链并赋 `location.href`（zcode 沿用
   `zcode://workspace/open?path=`；codex 用 `codex://threads/new?path=`，均
   `encodeURIComponent`）。既有 `#batchRecopy / #batchResumeCopy / #refineRecopy` 绑定不动。
3. **URL 构造纯函数**：`buildCodexWorkspaceUrl(root)` 加入 `scripts/lib/dispatch.mjs`（与
   `buildZcodeWorkspaceUrl` 并列，单测覆盖编码与路径注入转义）。前端 app.js 为经典脚本无法
   import ESM，沿用现状内联构造（README 已注明前端未复用 lib 函数；两边以测试锁同一契约）。
4. **可用性探测**：`state.workspaceApps = { zcode, codex, loaded }`（undefined = 未知）；
   `refreshWorkspaceApps()` 在 `bindBatchDrawer()` 内触发一次（loaded 防重），仅在出现明确
   `false` 时重渲染（页签记忆不受影响）。

### D4 「待确认」四项结论

| 待确认项 | 结论 |
| --- | --- |
| Codex 打开机制 | D1：`codex://threads/new?path=`（实机验证见上；不传 prompt） |
| 未选项目（`state.project` 空）按钮形态 | **禁用 + title 说明**（「未选择项目：请先在顶栏选择项目后再打开工作区」），两面板一致；替代现状「点击静默无反应」，满足验收「不出现可点但无效果的入口」。既有 Zcode 按钮一并升级为该口径（有项目时行为零回归） |
| 启动区（无批次）与「启动」toast | **不加**工作区入口与引导文案（默认口径；启动区无提示词页签，入口只归提示词页签） |
| 存量批次缺 `prompt` 空态 | 工具行**随提示词一起隐藏**（批量完善缺 prompt 时整块不渲染，仅空态说明；默认口径，与 ui-demo 呈现一致）。批量开发提示词页签现状无空态分支，运行态始终渲染工具行 |

### 开源选型（REQ-20260909-015）

自研。理由：**无合适库**——本条实现为两个字符串模板深链 + 一个目录存在性探测端点 + 少量
DOM 渲染/绑定，均为平台原生能力（URL scheme、`fs.existsSync`），不存在可复用的成熟三方库
场景；引入依赖反而增加供应链面。未引入开源库，不创建 licenses.md。

## 影响面

- `scripts/lib/dispatch.mjs`：+`buildCodexWorkspaceUrl()`、+`detectWorkspaceApps()`（既有
  `buildZcodeWorkspaceUrl`、`ITEM_ID_RE` 不动）。
- `scripts/server.mjs`：+`GET /api/workspace/apps`（只读；位于任务模块端点区，`/api/tasks/settings`
  附近）。
- `scripts/web/app.js`：两处提示词分区模板、`bindBatchDrawer()` 绑定改造（`#batchOpenZcode`
  既有行为保持）、+`state.workspaceApps`、+`workspaceOpenRowHtml()` / `refreshWorkspaceApps()`。
- 不改：提示词文本生成（`generatePrompt` / `buildRefinePrompt`）、批次账本、`atb` CLI 参数、
  一级/二级页签结构与记忆、启动区、Electron 壳（`electron/main.mjs`）。
- 浏览器直连与 Electron（`npm run app`）一致性：两按钮与既有 Zcode 按钮走同一
  `location.href` 深链机制、同一 `/api/workspace/apps` HTTP 端点（同源请求），机制层面两场景
  一致；Electron 内置页面实机走查留人工验收（本条不启动桌面 app，见 test-report.md）。

## 风险与边界

- **深链未文档化**（最大风险）：Codex `threads/new?path=` 为 app 内部构造格式（同
  REQ-20260903-003 对 `threads/new?prompt=` 的定性），已实机验证当期版本；版本升级若失效，
  表现为「app 被拉起但停在默认视图」（不会静默无反应），届时按新版本重新核查路由。
- **探测盲区**：app 装在非 `/Applications` 路径时端点返回 false 误禁用——已知局限，title 文案
  按实测情况可再放宽（探测语义见 D2）。
- **threads/new 语义**：打开的是「新会话输入框草稿」，不是「工作区首页」——Codex 端无更精确
  路由可用（D1 论证），title 已如实说明。
- 不做（README 边界重申）：不自动新建 Zcode 会话（无官方参数）、不注入/发送提示词、不做一键
  派发、不动自动执行链路（调度器 `codex exec`）。
