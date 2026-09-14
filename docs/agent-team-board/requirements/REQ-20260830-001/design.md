# 设计 — REQ-20260830-001 根据当前会话所在项目自动切换看板项目

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

server.mjs 启动时以 `process.cwd()` 固定单一数据源（`core.dataDirFrom(cwd)`），所有 API 都隐式用这个项目。多项目并行时每个项目都要起服务、占端口；/board 只能展示启动目录的项目。

## 方案

**单服务 + 显式项目参数 + 项目注册表**（保持零依赖，不引 WebSockets）：

1. **API 层**：所有数据 API 接受 `?project=<项目根绝对路径>`：`/api/board`、`/api/init`、`/api/new`、`/api/item/*`。服务端用 `core.dataDirFrom(projectRoot)` 解析该项目的数据目录——沿用现有向上探测逻辑（项目根传 cwd 即可，git 子目录也兼容）。校验：必须绝对路径且目录存在，否则 400。无参数时用「默认项目」（注册表第一项，首启以启动目录播种），**单项目旧用法完全不变**。
2. **项目注册表**：`~/.agent-team-board/projects.json`（env `ATB_REGISTRY` 可覆盖，测试用）。`/api/health` 返回 `projects`（已知项目列表）与 `defaultProject`；`?project=` 首次命中或 `POST /api/register {path}` 会登记。`/board` 打开带项目参数的 URL 即完成「按会话自动定位」。
3. **前端**：顶栏加项目下拉（`<select>`，列出注册项目，显示绝对路径）；当前项目存 localStorage 并同步到 URL `?project=`（history.replaceState），刷新/分享不丢；切换即整板重拉、关闭抽屉。未初始化项目沿用现有空态「初始化」引导（带 project 参数调用 `/api/init`）。所有 API 调用统一带当前 project。
4. **/board 命令**：打开 `http://127.0.0.1:7736/?project=<encodeURIComponent(项目根)>`——项目根取当前会话 cwd 的绝对路径（服务端向上探测数据目录），不同项目的会话打开各自看板，同一服务实例。
5. **状态不串项目**：流转 API 都带 project，作用于当前展示项目的数据目录，天然隔离。

## 影响面

- `scripts/server.mjs`：URL 解析加 project 参数、注册表读写、health 扩展（主要改动）
- `scripts/web/index.html` + `app.js`：项目选择器、URL/localStorage 同步、API 统一带参；`style.css` 适配
- `commands/board.md`、`skills/agent-team-board/SKILL.md`：/board 流程改为带 `?project=` 深链
- `scripts/lib/core.mjs`：不动（全部函数本就以 cwd 为参）
- 新增 `scripts/tests/multi-project.test.mjs`：真实起服务（随机端口 + 临时注册表）做 API 集成测试

## 风险与边界

- project 参数是本机绝对路径，服务仅绑 127.0.0.1，个人工具可接受；文档读取仍限定在数据目录内白名单 .md，无目录穿越面。
- 注册表按访问登记，项目删除后列表可能残留旧路径——切换时目录不存在会 400，提示重新选择；不做自动清理。
- 多个会话同时操作不同项目互不干扰；同一项目并发流转沿用现有原子写与状态机校验。
