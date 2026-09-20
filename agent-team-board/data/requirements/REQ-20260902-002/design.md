# 设计 — REQ-20260902-002 提供 CI Board，支持一些常见项目的构建自动化命令，例如自动重启 server，更改服务端口

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

Status Board 已有五模块（讨论/需求/任务/文件/设置）。日常项目运维里高频出现两类
「构建自动化」操作：看板服务自身的重启与换端口（目前只能手动 kill + `ATB_PORT=… node server.mjs`），
以及对常见项目执行构建/测试命令（只能开终端）。本需求把这两类操作收进看板，成为第六模块「CI」。

## 方案

沿用既有架构分层：数据层 store（lib）+ HTTP 路由（server.mjs）+ 独立视图 JS（web/ci.js）。

### 1. 数据层 `scripts/lib/ci-store.mjs`（新增，仿 oncall-store.mjs）

事实源 `<dataDir>/ci/`（项目级，与 REQ/BUG 状态机完全隔离、不占 impl.lock）：

```
ci/
├── jobs.json      # { version, counters:{run: 按日}, jobs: [{id,name,cwd,command,timeoutSec,createdAt,updatedAt}] }
└── runs/RUN-YYYYMMDD-NNN/   # run.json（status/exitCode/起止时间）+ output.log（运行输出）
```

- 任务 CRUD：`listJobs/createJob/updateJob/deleteJob`；校验：名称 1–120 字、命令非空 ≤2000 字、
  `cwd` 必须存在的绝对路径、`timeoutSec` 1–600 缺省 600；id 用 `JOB-<随机8位>`（无业务序号，删除不留洞）。
- 运行：`startRun` 以 `spawn(command, { cwd, shell: true })` 后台执行（用户自填命令，本就是功能本体），
  流式追加写 `output.log`，超过 `LOG_MAX_BYTES`(1MB) 截断标记；结束写 `status: success|failed`、`exitCode`；
  超时 kill 判 `failed(timeout)`。并发写用每 run 独立目录 + 原子写 run.json 规避。
- 查询：`listRuns(jobId?, limit=20)`、`readRunLog(runId, tailBytes)`。

### 2. 服务端口持久化 + 自动重启（server.mjs）

- 端口优先级：`ATB_PORT` 环境变量 > 持久化配置 > 8888。配置文件路径 `ATB_SERVER_CONFIG` 可注入
  （测试隔离），缺省 `~/.agent-team-board/server.json`，内容 `{ version:1, port:N }`。
- `POST /api/ci/server/restart { port? }`：
  1. 可选校验/写入新端口到配置文件（`writeServerConfig`）；
  2. `spawn(node, [server.mjs], { detached:true, stdio:'ignore', env:{ ATB_PORT: 新端口, ATB_BIND_RETRY:'1' } }).unref()`；
  3. 响应 `{ ok, oldPort, newPort }` 后延迟 ~400ms `server.close()+process.exit()`。
- 新进程 `ATB_BIND_RETRY=1` 时 `EADDRINUSE` 每 500ms 重试（≤20 次，覆盖同端口重启的旧进程退出窗口）；
  换端口场景无冲突直接绑定。前端重启后轮询新旧端口 `/api/health`，新地址就绪即提示并跳转。
- `GET /api/ci/server`：port/pid/startedAt/persisted port（前端服务卡）。

### 3. HTTP API（server.mjs `handleCiApi`，复用 `apiGuardReason` 跨站防护与错误包装）

```
GET    /api/ci/server                 # 服务信息
POST   /api/ci/server/restart         # { port? } 重启（可换端口）
GET    /api/ci/jobs                   # 任务列表（含每任务最近一次运行摘要）
POST   /api/ci/jobs                   # 新建 { name, cwd, command, timeoutSec? }
PUT    /api/ci/jobs/:id               # 编辑
DELETE /api/ci/jobs/:id               # 删除
POST   /api/ci/jobs/:id/run           # 触发运行 → { runId }
GET    /api/ci/runs?jobId=            # 运行历史
GET    /api/ci/runs/:run              # 单次运行详情 + 日志尾部
```

未初始化项目：jobs 相关接口报「未找到 docs/agent-team-board」错误，`/api/ci/server` 仍可用（服务卡不依赖项目）。

### 4. 前端（web/）

- `index.html`：顶栏新增 `data-view="ci"` 页签「CI」；新增空容器 `<section id="ciView">`；引 `ci.js`。
- `app.js`：`VIEWS`/`MODULE_SUB` 增加 `ci`；`setView('ci')` 显隐容器并调 `window.ATBCi.poll()`；
  CI 模块隐藏全局搜索（同设置模块口径）。
- `web/ci.js`（新增，独立模块 `window.ATBCi`，渲染进 `#ciView`）：
  - 服务卡：端口/PID/启动时间；「重启服务」按钮（确认后调 restart）；端口输入 + 「更改端口并重启」。
    重启期间显示过渡态；换端口成功后轮询新端口 health 就绪 → 提示并 `location.href` 跳新地址。
  - 任务卡列表：名称、命令、目录；按钮 运行/日志/编辑/删除；运行中卡片置 running 态并轮询刷新；
    日志在展开面板显示（含状态、退出码、时间），编辑用行内表单复用创建表单。
- `style.css`：新增 `.ci-*` 少量样式，主体复用既有卡片/按钮/表单类。

## 风险与边界

- **任意命令执行**：CI 任务本质就是执行用户自填命令，防护依赖既有边界——服务仅回环绑定、
  `/api/*` 有 Host/Origin 跨站拒绝（BUG-20260907-005），本需求不放宽任何一项；不提供远程触发。
- **自重启竞态**：同端口重启存在新旧进程端口竞争窗口，用 `ATB_BIND_RETRY` 绑定重试兜底；
  spawn 失败（如 node 路径异常）时旧进程不退出并回报错误，避免服务失联。
- **日志与超时**：输出 1MB 截断、600s 超时 kill，防失控任务拖垮本地磁盘/进程。
- **范围**：不做定时触发、不做并行队列（同任务串行：运行中再点运行返回错误提示）、不做远程 CI 对接。

## 实施记录

- 2026-09-08（zcode-batch-011-01）：按上述方案实施；新增 `scripts/lib/ci-store.mjs`、
  `scripts/web/ci.js`、`scripts/tests/ci-board.test.mjs`；`server.mjs` 增端口持久化/绑定重试/
  `/api/ci/*` 路由；`index.html`/`app.js`/`style.css` 接入第六视图。
