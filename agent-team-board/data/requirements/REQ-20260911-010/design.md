# 设计 — REQ-20260911-010 回退批量 Commit 的相关功能，但需保留已完成需求的 commit 号显示这个功能

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260911-009（开发完成到待测试自动提交 + 条目↔commit 双向索引）已实施上报
（`scripts/lib/git-flow.mjs`：`autoCommitForRun` 自动提交、`itemCommitLog`/`itemOfCommit` 双向索引、
自动提交账本落 `commits/runs/` 与 `committedItemIndex` 同源）。本单在此基础上回退人工触发的
批量 Commit（CMT 批次）流程，并把已完成列表提交状态徽标的取数切换到 REQ-009 索引。

## 方案

### 1. 数据层：`scripts/lib/commit-store.mjs` 裁剪为共享内核

- 移除 CMT 批次执行流程全部函数：`createCommitBatch` / `nextCommitItem` / `finishCommitRun` /
  `releaseCommitRun` / `abortCommitBatch` / `pauseCommitBatch` / `checkCommitBatch` /
  `listCommitRuns` / `commitBatchPublicView` / `commitBatchBrief` / `commitSummary` /
  `buildCommitPrompt` / `commitCandidates` / `getCommitBatch` / `getCommitRun` /
  `listCommitBatches` / `unfinishedCommitBatches` / `queueHeadCommitBatch` / `ensureCommits`，
  及其私有依赖（批次/运行账本读写、impl 互斥包装、实时吸收、出局落账、回执核验
  `validateItemCommits` / `inspectCommit`、提示词与规范摘要、批次常量）。
- 保留共享内核（REQ-009 自动提交与索引的底层，待确认 3 的取舍：**保留复用**）：
  提交规范常量（`COMMIT_TYPES` / `DESC_MAX_CHARS` / `TEST_PATH_PREFIX`）、
  `validateCommitSubject`、`gitLogMessages`、`itemCommittedInGit`、`committedItemIndex`
  （REQ-009 自动提交账本正向聚合；存量 CMT 核验记录天然留在账本中，不破坏）。
- 存量数据（待确认 2）：`docs/agent-team-board/commits/` 下既有账本文件、`settings.json`、
  `.gitignore` 条目一律不删（未确认前不做破坏性删除）；本仓库当前无 `commits/` 目录、
  无在途 CMT 批次，无过渡期处置问题。

### 2. 索引换源：`scripts/lib/git-flow.mjs` 新增批量函数

新增 `itemCommitStatusIndex(dataDir, projectRoot)`——REQ-009 索引（`itemCommitLog` 单条版）
的批量版：`committedItemIndex`（账本，含 REQ-009 自动提交记录）∪ git 历史**一次** `git log`
扫描（消息含单号即关联），返回 `Map<itemId, { itemId, commits, lastCommittedAt }>`。
一个 commit 消息含多个单号时自然关联多条（一个 commit 关联多个单号）；非 git 项目退化为
仅账本聚合。`itemCommitLog` / `itemOfCommit` / `autoCommitForRun` / `ensureDevWorkflow`
不动（REQ-009 实现保持原样，本单不改其行为）。

### 3. 服务端：`scripts/server.mjs`

- 移除路由 `/api/commit/current`、`/api/commit/create`、`/api/commit/pause`、
  `/api/commit/abort`、`/api/commit/records`（未知接口统一 404）。
- `/api/commit/item-status` 保留换源：改调 `gitFlow.itemCommitStatusIndex`，响应
  `{ statuses: { [itemId]: { commits, lastCommittedAt } } }`（去掉 CMT 批次字段 `batches`，
  前端只用 `commits`）。
- 全局聚合 `projectTaskRows` 移除 CMT 批次简报行；`aggregateGlobalTasks` 移除
  `commits/batches` 账本损坏检查（全局看板不再依赖 CMT 账本）。

### 4. CLI：`scripts/atb.mjs`

- usage 移除「批量 commit」分组；`commitCmd` 只保留 REQ-009 的 `commit log` / `commit which`。
- 旧子命令（create/next/done/fail/release/check/summary/records/pause/abort 与未知子命令）
  统一明确报错：「批量 commit 已回退（REQ-20260911-010）：人工批量提交流程已下线，
  开发完成到待测试由系统自动提交」，不产生任何 git 操作、不落任何账本。
- `atb run autocommit`（REQ-009）不受影响。

### 5. 前端：`scripts/web/app.js`（+ i18n 词典死键清理）

- 移除：任务模块「批量 Commit」页签与面板（`state.commit`、`refreshCommit`、
  `renderCommitPanel`、`commitRecordsHtml`、创建/暂停/终止动作、`commitPane` 快照、
  prompt 复制的 commit 分支）；需求模块「已完成」档「▶ 开始 Commit」快捷入口
  （accepted「开始完善」/ planned「开始开发」不受影响）；全局看板 CMT 类型档 / 标签 /
  前缀兜底 / 计数分支 / 空态文案中的「批量 Commit」字样。无死控件、禁用态或空占位残留。
- 保留：已完成（done）与待测试（in-progress 已上报）条目提交状态徽标 + 详情「提交状态」
  字段（四态：已提交+提交号可复制 / 未提交 / 加载失败+重试 / 加载期间沿用上次数据），
  取数仍走 `/api/commit/item-status`（已换源）。「N 个提交号」多 hash 展开保留。
- `scripts/web/i18n.js`：删除仅被已移除文案使用的死键（保留仍使用的键）。

### 6. 守卫：`scripts/state-guard.mjs`

移除 CMT 在途豁免（`hasActiveCommitBatchRun` / `COMMIT_RUN_FINAL`）与提示中的
「人工创建的批量 commit 批次」通道；流程外 git commit 拦截提示只剩「到待测试自动提交
（atb 内部执行）+ 人工终端」两通道。REQ-009 的自动提交不经 Bash，不受影响。

### 展示口径（待确认 1 的先行取舍，最终以人工确认为准）

REQ-009 已按仓库提交规范实现 doc/test/业务分组（一单多 commit），本单若强行「一单只展示
唯一 commit」将与已上线的 009 实现和提交规范冲突；按 README 预留分支「若待确认 1 结论为
一单多 commit，则维持多提交号展示」执行：**维持一单多提交号展示**，索引天然支持
「一个 commit 关联多个单号」。若人工后续裁定一单一 commit，需同步修订 REQ-009 分组实现
与两单验收口径（待确认 1/4 一并人工确认）。

### 测试

新增 `scripts/tests/commit-rollback-20260911-010.test.mjs`（CLI 回退 / 内核保留 / 服务端
404 与换源 / 前端静态契约 / 守卫豁免移除）；改写或修剪存量测试：`commit-batch-20260910-013`
（删，流程已不存在）、`commit-serve-20260910-014`（改写为 404 + item-status 换源）、
`commit-ui-20260910-014`（改写为面板移除 + 徽标保留）、`commit-rollback-20260911-006`
（修剪掉依赖已删函数的 U2/U3/U4）、`global-commit-20260911-006`（改写为不再聚合 CMT）、
`lane-quick-entry-commit-20260911-005`（改写为已完成档无入口）、以及
`lane-quick-entry-20260909-007` / `caption-toolbar-20260910-008` / `global-kind-fallback-20260911-007` /
`dev-setting-removed-20260910-027` / `bug-btn-disabled-visual-20260911-009` /
`session-entry-copy-20260911-008` 的相关断言同步。

**开源选型（REQ-20260909-015）**：本单为纯回退 + 既有 REQ-009 实现复用，无新增第三方库；
自研理由：无合适库（回退自身仓库功能不需要外部依赖）。未使用开源库，不创建 licenses.md。

## 风险与边界

- 不做任何 git 历史改写（不 push / reset / rebase / checkout 丢弃）；回退改动本身按仓库
  现行流程落库（本单回执时由 REQ-009 自动提交链路处理）。
- REQ-009 处于待人工确认（in-progress）：本单不修改其自动提交实现与行为，仅移除守卫提示
  中已失效的 CMT 通道引用；其 README 验收句「现有人工触发的批量 commit 流程不回归」随本单
  落地而失效，是否同步修订该单文档属待确认 4，留人工确认，本单不动 REQ-009 条目文档。
- 条目状态机与人机分工不变：不写任何 `status.json`，不改 accepted/planned/in-progress/done
  流转语义。
- 浏览看板全程纯只读（item-status 为只读聚合，不执行 git 写操作）。
