# 测试用例 — REQ-20260902-002 提供 CI Board，支持一些常见项目的构建自动化命令，例如自动重启 server，更改服务端口

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| V1 | 静态契约：index.html 含 `data-view="ci"` 页签与 `#ciView` 容器并引 ci.js；app.js 的 VIEWS 含 `ci`；存在 lib/ci-store.mjs 与 web/ci.js；server.mjs 含 `/api/ci/` 路由注册 | P0 | ✅ |
| V2 | store：createJob 校验——名称必填（≤120）、命令必填（≤2000）、cwd 必须存在目录的绝对路径、timeoutSec 1–600；非法输入抛 AtbError | P0 | ✅ |
| V3 | store：任务 CRUD 往返——创建后 listJobs 可见，updateJob 改命令生效，deleteJob 后消失；运行记录目录初始为空 | P0 | ✅ |
| V4 | store：startRun 执行 `echo` 类命令——轮询至 success，exitCode 0，输出日志包含命令输出；listRuns 返回该记录 | P0 | ✅ |
| V5 | store：startRun 执行失败命令（exit 3）——status failed、exitCode 3，日志含输出；超时任务被 kill 判 failed(timeout)（用 2s 短 timeoutSec 验证机制） | P1 | ✅ |
| V6 | API：起真实 server 后 `/api/ci/jobs` 增删改查可用；`POST /api/ci/jobs/:id/run` 返回 runId；`GET /api/ci/runs/:id` 轮询到 success 且日志含输出；未知接口 404 | P0 | ✅ |
| V7 | API：`/api/ci/server` 返回 port/pid/startedAt 与 health 一致；`POST /api/ci/server/restart` 非法端口（0/70000/abc）报错 | P0 | ✅ |
| V8 | 集成：restart 换端口——旧进程自动退出、新端口 health 就绪、端口写入持久化配置；再起一个新进程（不传 ATB_PORT）沿用持久化端口 | P0 | ✅ |
| V9 | 集成：同端口重启——restart 后同端口 health 恢复（绑定重试生效） | P1 | ✅ |
