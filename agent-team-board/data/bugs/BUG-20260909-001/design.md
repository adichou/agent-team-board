# 设计 — BUG-20260909-001 开发任务终止后看板不显示「已终止」口径：/api/batch/current 未透出 aborted 字段

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260908-020（重构批量流程和任务管理）。
  该需求引入开发批次人工终止链路：`scripts/lib/batch.mjs` 的 `abortBatch`（账本写 `abortRequested`/`aborted`/`status:'finished'`）、CLI `batch abort`、HTTP `POST /api/batch/abort` 与前端「终止任务」入口，并让 `scripts/web/app.js` 的 `renderZcodeBatchPanel` 依赖 `b.aborted` 渲染「已终止」徽标/警告（app.js 内注释「REQ-20260908-020：aborted（人工终止）显示「已终止」」）。但同一需求未同步在两处公开视图透出字段：`scripts/server.mjs` `GET /api/batch/current` 手工构造的 `batch` 对象、`scripts/atb.mjs` `batchPublicView`（`batch summary --json`/`batch pause --json` 共用），导致前端分支永远拿到 `undefined`。完善侧 `refineBatchPublicView` 在同一需求中已用 `Boolean(...)` 公开两字段，开发侧遗漏即本 Bug。ID 已经 `atb list` 核验真实存在（in-progress）。项目目录非 git 仓库，无提交历史可追溯，归因以代码内 REQ 标注注释与看板核验为准。

## 根因分析

两处视图在 REQ-20260908-020 合入人工终止能力时未随账本字段演进：

1. `scripts/server.mjs` `/api/batch/current`（约 1395-1405 行）：`batch` 对象逐字段白名单构造，仅含 `batchId/mode/status/pauseRequested/createdAt/lastActivityAt/developer/prompt`，缺 `abortRequested`/`aborted`。
2. `scripts/atb.mjs` `batchPublicView`（约 752 行）：同样的白名单解构，缺两字段；影响 `batch summary --json` 与 `batch pause --json` 的 `batch` 视图。

前端 `renderZcodeBatchPanel`（app.js 3478-3519 行）已按 `b.aborted` 分支渲染终止徽标、警告与「任务已终止」文案，HTTP 缺字段使其恒为 falsy，面板只能落到「已结束」自然完成口径。账本（batch.json）数据本身正确，属读取层遗漏，非写入层缺陷。

## 方案

最小改动，两处视图按 `Boolean(...)` 归一化补齐字段（口径对齐完善侧 `refineBatchPublicView`）：

1. `scripts/atb.mjs` `batchPublicView`：返回对象新增 `abortRequested: Boolean(b.abortRequested)`、`aborted: Boolean(b.aborted)`；存量缺字段批次输出 `false`，自然结束（仅 `status:'finished'`）不误判为人工终止。
2. `scripts/server.mjs` `/api/batch/current` 的 `batch` 对象：新增 `abortRequested: Boolean(s.batch.abortRequested)`、`aborted: Boolean(s.batch.aborted)`。
3. 前端零改动：`renderZcodeBatchPanel` 的终止分支（s-aborted 徽标、notice warn 警告、「任务已终止」当前项文案、batchPause 隐藏）在字段透出后自然生效；既有 UI 测试（batch-ui U16）已覆盖该分支。
4. queue 视图核对结果（README 期望行为 4）：**不改动**。`unfinishedBatches` 只返回 `status !== 'finished'` 的批次，而 `abortBatch` 在同一次 `saveBatch` 中原子置 `abortRequested + aborted + status:'finished'`，终止批次不可能停留在未结束队列；队列成员的两个字段恒为假值，逐项补 Boolean 字段只会引入恒 false 噪声，故 queue 成员维持现有字段集。测试断言「终止批次不入队」已在 batch-abort-view / batch-serve 用例中固化，FIFO 队首切换由既有 batch-queue 用例回归。

TDD：先新增 `scripts/tests/batch-abort-view.test.mjs`（HTTP + CLI 双路径：终止批次 true、存量缺字段/运行中/暂停/自然结束 false、终止批次不入队、类型为布尔），确认跑红（两用例均因字段缺失失败）后实施上述 1、2，跑绿；顺带把 `batch-cli.test.mjs` Z14b 中过时注释「aborted 不在公共视图」修正为透出断言（`abortRequested/aborted === true`）。

## 风险与边界

- 仅扩字段不改语义：`batchPublicView` 消费方（主调度 summary、pause JSON）对新增键天然容忍（append-only）；不触碰终止收尾、条目业务状态、项目队列调度与锁。
- 存量兼容：旧批次账本无两字段 → `Boolean(undefined) === false`，与「不能把所有 finished 推断为人工终止」的要求一致；异常旧账本仅含单个终止字段时也按原始字段分别布尔化，不互相推断。
- 覆盖率口径：新增测试覆盖 HTTP current 与 CLI summary/pause 两视图 ×（终止/存量/自然结束/暂停）状态矩阵；全量 101 个测试文件回归通过。
