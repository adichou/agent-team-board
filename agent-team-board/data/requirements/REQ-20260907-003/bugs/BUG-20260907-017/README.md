# BUG-20260907-017 使用该功能报错。请修复

- 状态：in-progress（已上报，待人工确认）
- 归属需求：REQ-20260907-003
- 引入来源：REQ-20260907-003（经 `atb list` 核验存在；排查过程见「根因」）
- 创建：2026-09-07T15:36:59.950Z

## 现象

在看板使用「需求完善」功能（任务模块 → 需求完善子面板，或待接受列「需求完善」入口）时，
面板立即弹出红色报错 toast：`未知接口：GET /api/refine/current`（刷新页面重试同样报错，
创建批次亦不可用）。经排查，用户正在运行的看板服务进程（127.0.0.1:8888，PID 85400，
启动于 2026-09-07 02:51:46）加载的仍是旧版路由集——不含 REQ-20260907-003 于当日 14:13
新增的 `/api/refine/*` 接口（实测 `curl /api/refine/current` → 404
`{"error":"未知接口：GET /api/refine/current"}`）；而网页静态文件由服务每次请求实时从磁盘
读取，浏览器刷新即拿到含「需求完善」入口的新前端，形成前后端版本漂移：新前端调用旧服务，
必然 404 报错。同时 `atb serve` 探活只看 `/api/health` 是否 200，一律复用旧实例，health
也不暴露服务启动时间，用户重跑 `atb serve` 无法自愈。佐证：本项目 `docs/agent-team-board/`
下无 `refine/` 目录、`.gitignore` 无 refine 条目——完善批次在本项目从未创建成功（用户卡在
面板第一步即报错）。

## 复现步骤

1. 启动看板服务后更新代码（或保持服务长运行，如 `atb serve` 起的常驻进程），使磁盘
   server.mjs 新于服务进程启动时间（本 Bug 现场：服务 02:51 启动，refine 代码 14:13 写入）。
2. 浏览器刷新看板页面（拿到含「需求完善」入口的新前端）。
3. 点击待接受列「需求完善」入口（或任务模块 → 需求完善子面板）。

实际：toast 报错 `未知接口：GET /api/refine/current`；curl 该接口得 404 同样错误。

## 期望行为

- 「需求完善」功能在服务为当前版本时可正常使用（本 Bug 根因不在功能代码本身，已验证
  refine 全链路在新服务下正常：candidates/create/next/done/check/pause/records）。
- 服务版本过旧不再裸报「未知接口」：前端给出可操作指引（运行 `atb serve` 自动重启过旧
  服务后刷新页面）。
- `atb serve` 探活复用前校验版本：磁盘服务代码（server.mjs + lib/*.mjs）新于服务启动
  时间、或 health 无 `startedAt`（早于本修复的服务）→ 自动 SIGTERM 优雅重启加载新版本，
  一条命令自愈；无法定位旧进程时给出手动指引并明确失败，不误杀。
- 服务不旧时维持原复用语义，不重启、不误杀。
- `/api/health` 暴露 `pid` 与 `startedAt`，供客户端判定服务新旧与定位进程。

## 验收说明

1. `node scripts/tests/serve-stale.test.mjs` 全部通过（T1 health 含 pid/startedAt；
   T2 磁盘新于服务自动重启替换；   T3 服务不旧照常复用不误杀；   T4 前端「未知接口」
   错误带 atb serve 重启指引；   T5 复刻用户现场——无 startedAt 的旧服务被 lsof 定位、
   优雅停止并以新服务替换，refine 路由可达）。
2. 全量 `npm test`（75 个测试文件）0 失败。
3. 用户现场自愈验证路径：终端运行 `node scripts/atb.mjs serve`（或 `atb serve`）→ 输出
   「⚠ 看板服务版本过旧…已自动重启」→ 刷新看板页面 → 「需求完善」面板正常展示候选。

## 根因

- 引入来源：REQ-20260907-003（实施新增「需求完善」前端入口与 `/api/refine/*` 服务接口，
  编号经 `atb list` 核验）。该实施正确交付了功能，但未考虑常驻服务的版本漂移：看板服务
  为常驻进程（nohup 脱离监管），API 路由集随进程启动固化；静态前端由 `server.mjs` 每次
  请求 `createReadStream` 实时读盘。用户服务 02:51 启动、功能代码 14:13 写入且服务未重启
  → 新前端 + 旧路由集 → `/api/refine/*` 404「未知接口」→ 面板 toast 报错（15:36 用户
  提交本 Bug）。`atb serve` 与 Electron 壳探活均"200 即复用"、health 不暴露启动时间，
  使漂移无法被发现与自愈。
- 排查过程：Bug 文档无现象/复现信息 → 按归属需求调查 refine 功能全链路（CLI `atb refine
  next/done/check`、服务 `/api/refine/*`、前端面板）在临时项目均正常 → 发现本项目无
  refine 账本目录（create 从未成功）→ 定位用户 8888 服务进程启动时间（02:51:46，`ps`）
  早于功能代码写入（14:13，REQ status.json）→ 实测该服务 `/api/refine/current` 404
  「未知接口」→ 根因落定。

## 修复记录（BUG-20260907-017，zcode-batch-010-01）

- `scripts/server.mjs`：`/api/health` 响应增加 `pid`（process.pid）与 `startedAt`
  （进程启动 ISO 时间，模块加载时采样）。
- `scripts/atb.mjs`：`serve` 子命令新增版本过旧检测与自动重启——探活成功后解析 health
  `startedAt`，与磁盘服务代码（server.mjs + lib/*.mjs 最新 mtime，1 秒容差）比较；无
  `startedAt`（老形态服务）视为过旧。过旧时定位旧进程 pid（health.pid，缺省回退
  `lsof -ti tcp:<port>`）→ SIGTERM（走服务既有优雅关停）→ 等端口释放 → 后台拉起新服务
  → 探活就绪；无法停止旧进程时输出手动指引（kill 命令）并以非零码退出，不 kill -9、
  不强占端口。
- `scripts/web/app.js`：`api()` 对 404 且 `error` 以「未知接口：」开头的响应，把错误消息
  增强为「…。看板服务版本过旧：请在终端运行 atb serve 自动重启过旧服务，然后刷新页面」，
  所有面板（需求完善 / 批量实施 / Codex 派发等）统一受益。
- 测试：新增 `scripts/tests/serve-stale.test.mjs`（T1–T5，先跑红后修复跑绿）；全量
  `node scripts/tests/run-all.mjs` 75 个测试文件 0 失败。
