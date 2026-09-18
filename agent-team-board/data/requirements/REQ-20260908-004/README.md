# REQ-20260908-004 回退 CI 看板

- 状态：accepted（已领取实施）
- 创建：2026-09-08T01:52:07.739Z

## 描述

回退 REQ-20260902-002 引入的「CI」看板模块（第六视图），Status Board 恢复为五模块
（讨论 / 需求 / 任务 / 文件 / 设置）。回退范围 = REQ-20260902-002 的全部代码面：

- 前端：顶栏「CI」页签、`#ciView` 容器、`web/ci.js`、`app.js` 中 ci 视图注册/轮询、
  `style.css` 的 `.ci-*` 样式段；
- 服务端：`/api/ci/*` 全部路由（服务信息/重启/任务 CRUD/运行/日志）、
  `lib/ci-store.mjs`、服务自重启（selfRestart）与 EADDRINUSE 绑定重试（ATB_BIND_RETRY）；
- 端口持久化：`~/.agent-team-board/server.json` 的读写（ATB_SERVER_CONFIG / readServerConfig /
  writeServerConfig / resolveServerPort）一并回退，端口解析恢复为 `ATB_PORT 环境变量 > 8888`；
- 测试：`tests/ci-board.test.mjs` 删除，`workbench-layout` W2 与 `default-port` V1 契约
  同步回退后的形态。

数据残留处理：项目 `docs/agent-team-board/ci/` 任务数据目录与 `~/.agent-team-board/server.json`
不主动删除（本项目当前无 ci/ 数据目录；server.json 回退后被忽略，无副作用）。

## 验收标准

- [ ] 顶栏模块导航回到「讨论 / 需求 / 任务 / 文件」+ 末位「设置」，无「CI」页签与 CI 视图
- [ ] `/api/ci/*` 全部接口移除（请求落到未知接口 404）
- [ ] `scripts/lib/ci-store.mjs`、`scripts/web/ci.js`、`scripts/tests/ci-board.test.mjs` 三个文件删除
- [ ] 端口解析恢复 `ATB_PORT > 8888`，不读写 server.json；EADDRINUSE 直接提示退出（无绑定重试）
- [ ] `node scripts/tests/revert-ci-board.test.mjs` 全部通过
- [ ] `npm test` 全量回归零失败
