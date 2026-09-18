# 测试用例 — REQ-20260903-003 一键派发升级：codex CLI 拉起新会话；zcode 深链打开工作区

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 单测目标 `scripts/lib/dispatch.mjs`（纯函数）+ 前端/服务端静态契约 + 临时端口集成（不打扰 7736 实例）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| U1 | `shQuote`：POSIX 单引号包裹，内嵌 `'` 转义为 `'\''`，经真实 `/bin/sh` printf 回读与原文一致（注入探针：prompt 含 `'; echo HACKED; '` 时输出不得多出执行痕迹） | P1 |  ✓ |
| U2 | `buildCommandScript`：内容依次为 shebang、注释含单号、`printf '\033]0;%s\007' '<单号>'`（终端标签标题）、`cd '<项目根>'`、`exec '<CLI>' -C '<项目根>' '<提示词>'`；单号/项目根/提示词/CLI 任一非法（非 REQ-/BUG- 单号、相对路径、空提示词）抛错 | P1 |  ✓ |
| U3 | 注入安全：提示词/路径含引号、`$(...)`、反引号、分号时，`.command` 中均处于单引号包裹内（以 U1 的 shQuote 回读法断言） | P1 |  ✓ |
| U4 | `buildZcodeWorkspaceUrl`：`zcode://workspace/open?path=<encodeURIComponent(根)>`，含中文/空格路径 URL 往返还原 | P1 |  ✓ |
| U5 | `buildCodexThreadUrl`：`codex://threads/new?prompt=<encodeURIComponent(提示词)>`，含换行/#/& 往返还原 | P1 |  ✓ |
| C1 | server 契约：注册 `POST /api/dispatch/codex`（走 `?project=` 项目绑定）；CLI 缺位返回 `{ok:false, fallback:'deeplink'}` 降级信号；成功路径生成 `.command`（0o755）并以 open 命令拉起；open 命令与 CLI 路径可用 `ATB_OPEN_CMD`/`ATB_CODEX_CLI` 环境变量覆写（测试接缝） | P1 |  ✓ |
| C2 | 前端 codex 按钮：先 `navigator.clipboard.writeText`（常驻兜底），再 POST `/api/dispatch/codex`；`ok:true` 显示「已拉起 Codex 会话 ✓」；降级信号/请求失败回退 `codex://threads/new?prompt=`（encodeURIComponent） | P1 |  ✓ |
| C3 | 前端 zcode 按钮：提示词入剪贴板 + `zcode://workspace/open?path=` + `encodeURIComponent(state.project)` 跳转，显示「已复制并打开 ZCode ✓」；无项目定位时仅复制 | P1 |  ✓ |
| C4 | 回归：v1 派发提示词语义不变（zcode 版首行 `/dev <ID>`；codex 版含完整单号），`dispatch.test.mjs` 保持通过（复制兜底路径保留） | P1 |  ✓ |
| I1 | 集成（临时端口 + `ATB_CODEX_CLI=/nonexistent`）：POST 派发返回 200 `{ok:false, fallback:'deeplink'}` | P1 |  ✓ |
| I2 | 集成（临时端口 + 假 CLI 文件 + `ATB_OPEN_CMD` 记录器）：POST 返回 `{ok:true}`；记录器收到 `.command` 路径；文件可执行且内容含标签标题行与 `exec … -C … '<提示词>'` 行 | P1 |  ✓ |
| I3 | 集成：非法单号（`../evil`）POST 返回 400 且不产生临时目录副作用 | P2 |  ✓ |
| M1 | 手工：codex 按钮真实点击 → 新 Terminal 标签标题=单号，codex 于项目根自动执行提示词（用户验收） | P1 | 待用户验收 |
| M2 | 手工：zcode 按钮真实点击 → ZCode 打开/聚焦该项目工作区，剪贴板提示词首行 `/dev <ID>`（用户验收） | P1 | 待用户验收 |
