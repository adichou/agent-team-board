# 设计 — REQ-20260903-003 一键派发升级：codex CLI 拉起新会话；zcode 深链打开工作区

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

v1（REQ-20260902-004）只做「复制提示词」，用户要「真·一键」：codex 侧拉起终端新会话并自动执行；zcode 侧打开项目工作区，会话标题以单号关联。方案对比与实机调研结论见 README（选定 codex 自带 CLI + `.command` 拉起，深链降级；zcode 仅 `workspace/open` 深链，无会话创建参数）。

## 方案（实施记录）

### 新增 `scripts/lib/dispatch.mjs`（纯函数，server 与单测共用）

- `CODEX_CLI_DEFAULT`：`/Applications/ChatGPT.app/Contents/Resources/codex`（ChatGPT.app 内置 codex-cli，与桌面版共用 `~/.codex` 登录态）。
- `ITEM_ID_RE`：`^(?:REQ|BUG)-\d{8}-\d{3}$`——单号白名单，兼作 `.command` 文件名与终端标签标题的安全约束。
- `shQuote(s)`：POSIX 单引号包裹（内嵌 `'` → `'\''`）。注入安全的核心：单引号内无任何展开。
- `buildCommandScript({id, projectRoot, prompt, cliPath})`：生成 `.command` 脚本——`printf '\033]0;%s\007' '<单号>'`（终端标签标题）→ `cd '<项目根>'`（失败即退出）→ `exec '<CLI>' -C '<项目根>' '<提示词>'`。参数非法（单号不合规/项目根非绝对路径/空提示词/空 CLI）抛错。
- `buildZcodeWorkspaceUrl(root)` / `buildCodexThreadUrl(prompt)`：两条降级深链的构造，`encodeURIComponent` 编码。

### server.mjs：`POST /api/dispatch/codex`（`?project=` 项目绑定，仅 127.0.0.1）

- 探测 CLI（`ATB_CODEX_CLI` 可覆写，缺省 `CODEX_CLI_DEFAULT`）；缺位返回 `200 {ok:false, fallback:'deeplink', reason}`，前端回退深链。
- 参数校验经 `buildCommandScript`（包装为 `AtbError` → 400，实测非法单号 400 且无副作用）。
- 成功路径：`mkdtemp`（`atb-dispatch-*`）下写 `dispatch-<单号>.command`（0o755），`spawn(open, [file], {detached})` 拉起 Terminal 新标签。`ATB_OPEN_CMD` 可覆写 open 命令——测试接缝，避免单测真开终端。

### 前端 app.js（派发区两按钮，v1 位置与样式不变）

- 剪贴板常驻兜底抽为 `copyDispatchText`（失败 toast），按钮反馈抽为 `flashDispatchBtn`（沿用 `.copied` 态）。
- codex（`launchCodex`）：先复制 → POST `/api/dispatch/codex`；`ok:true` 显示「已拉起 Codex 会话 ✓」；降级信号/请求失败 → `location.href = codex://threads/new?prompt=<enc>`。
- zcode（`launchZcode`）：先复制 → `location.href = zcode://workspace/open?path=<enc(state.project)>`，显示「已复制并打开 ZCode ✓」；无项目定位时仅复制。
- 提示词模板不变（C4 回归）：zcode 版首行 `/dev <ID>`；codex 版 skill 指引措辞含完整单号。

### 测试（`scripts/tests/dispatch-launch.test.mjs`，node:assert + t() 风格）

U1–U5 单测（含真实 `/bin/sh` 回读注入探针）、C1–C4 静态契约、I1–I3 临时端口集成（假 CLI + open 记录器，不打扰 7736 实例）。v1 `dispatch.test.mjs` P3 契约随代码结构调整更新（剪贴板通道意图不变）。

## 风险与边界

- `.command` 首次执行 macOS 可能弹「无法验证开发者」——由 `open` 拉起本地生成脚本属正常路径，实测即知；失败有深链+剪贴板两级兜底。
- `codex://threads/new?prompt=` 参数未文档化，降级路径以实测为准（README 已声明）。
- zcode 会话名不可程序化设置：仅靠提示词首行 `/dev <ID>` 使自动标题含单号（README 边界）。
- 临时 `.command` 留在系统临时目录（os 会清理），脚本内注释标明可删。
- 守卫残留：开发中发现 `atb claim` 成功提示文案仍写「状态待对齐——请出实现方案并等人工对齐确认」，与 REQ-20260903-001 取消对齐闸门后的实际流转不符（实际已进 in-progress）——已按 /bug 登记，不在本条目内修。
