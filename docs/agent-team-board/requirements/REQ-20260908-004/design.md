# 设计 — REQ-20260908-004 回退 CI 看板

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260902-002 为 Status Board 引入第六模块「CI」（看板服务自运维 + 项目构建任务），
实施完成后用户要求整体回退。本仓库无 git 历史可用，采用「功能回退」方式：删除 CI
专属文件并手工摘除各文件中的 CI 代码段，使行为与 CI 引入前一致。

## 方案

### 1. 删除文件（3 个）

- `scripts/lib/ci-store.mjs`（CI 数据层）
- `scripts/web/ci.js`（CI 前端模块 window.ATBCi）
- `scripts/tests/ci-board.test.mjs`（CI 专属测试；run-all.mjs 按目录 glob 收集，删除即出列）

### 2. scripts/server.mjs

- 移除 `import * as ci from './lib/ci-store.mjs'`；`spawn` 仅剩 selfRestart 使用，import 缩回
  `spawnSync`；
- 端口持久化整段移除（SERVER_CONFIG_PATH / readServerConfig / writeServerConfig /
  resolveServerPort / ATB_SERVER_CONFIG）；保留 `DEFAULT_PORT = 8888` 显式常量
  （default-port V1 契约仍断言它），解析改为 `Number(process.env.ATB_PORT) || DEFAULT_PORT`；
- 移除 validatePortInput / selfRestart / handleCiApi 与 `/api/ci/` 路由分发段；
- 移除 ATB_BIND_RETRY 绑定重试与 EADDRINUSE 重试分支，EADDRINUSE 恢复为直接提示退出。
- 保留 `/api/health` 的 pid/startedAt（属 BUG-20260907-017，非 CI 需求引入）。

### 3. web/index.html

- 模块导航删除 `data-view="ci"` 按钮（注释同步回五模块）；
- 删除 `#ciView` 容器段与 `<script src="/ci.js">`。

### 4. web/app.js

- 项目切换处理删除 `state.view === 'ci'` 分支；MODULE_SUB 删 ci 条目；VIEWS 去 `'ci'`；
  setView 删 ciView 显隐与 ATBCi.poll；搜索隐藏条件去掉 ci（仅 settings 隐藏）。

### 5. web/style.css

- 删除「CI 模块（REQ-20260902-002）」整段样式（.ci-view 起至文件尾，均为 CI 专属）。

### 6. 既有测试契约同步

- `workbench-layout.test.mjs` W2：导航顺序回退为 `['oncall','status','runs','files','settings']`，
  删除 CI 栏目断言；
- `default-port.test.mjs` V1：注释改为回退后口径（不再提 resolveServerPort/持久化），
  `const DEFAULT_PORT = 8888;` 断言保留（常量仍存在）。

### 7. 新增回退验证测试 `scripts/tests/revert-ci-board.test.mjs`

静态契约用例（回退前跑红、回退后跑绿）：文件删除 / 无 CI 页签与视图注册 /
server.mjs 无 /api/ci 与持久化 / 端口解析表达式 / style 无 .ci- 样式。

## 风险与边界

- 无 git 历史，回退以「功能等价」为准（行为回到 CI 引入前），不逐字恢复旧代码形态；
  DEFAULT_PORT 常量等无害结构保留。
- BUG-20260908-003（SIGTERM 滞留）为 REQ-20260902-002 实施时发现的既有缺陷，独立修复，
  不随本回退消失，也不在本回退范围内处理。
- 不清理用户磁盘数据（docs/agent-team-board/ci/ 与 ~/.agent-team-board/server.json）。

## 实施记录

- 2026-09-08 zcode-batch-013-1：按上述方案完成回退，revert-ci-board 用例 5/5 绿，
  npm test 78 文件 0 失败（删除 ci-board、新增 revert-ci-board）。
