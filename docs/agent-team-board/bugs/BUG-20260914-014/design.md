# 设计 — BUG-20260914-014 回退 BUG-20260914-010

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：**BUG-20260914-010**（「批量开发暂扣待人工提交的改动缺少人工提醒通道」的实现单
  run-20260914-232 引入三通道改动：batch check 暂扣 notice、`/api/holds` `pendingCommits` 汇总与
  看板「待人工提交」分组、调度提示词 pendingManual 立即报告指令；人工判定实现方案太差要求回退。
  `atb list` 核验存在，状态 in-progress，处置待人工确认）。本单为回退承接，不重新设计替代方案。

## 根因分析

010 实现被人工判定为太差（具体维度登记时未说明，待人工确认），但其全部 7 处改动以未提交
形态暂扣在工作区，且与 BUG-20260914-003/004/005/006/009/011/012 等单的暂扣改动混在同一批
文件中——需要 hunk 级撤除，不能整文件还原，否则会波及他人改动。

## 方案

**开源选型（REQ-20260909-015）**：纯回退任务，无新功能、无新依赖，不涉及开源库引入（自研
理由：回退即删除既有代码，无「库可复用」的场景；未使用开源库，不创建 licenses.md）。

1. 先以 010 独有标识（`pendingManualRuns` / `pendingCommits` / 单号注释 / 测试文件名 /
   「待人工提交」UI 文案）写回退回归测试 `bug-revert-held-notice-20260914-014.test.mjs`
   跑红（残留清零 A1/A2、提示词 B1、notice C1、/api/holds D1 红；他人完好 E1 与历史保留 F1
   为基线绿）；
2. 逐处回退 7 处：`batch.mjs`（工作区差异 100% 为 010，restore 等价 hunk 级回退）、
   `git-flow.mjs` 删 `pendingManualRuns()`（保留 BUG-003 `ensureMainBranch()`）、
   `server.mjs` 删 `/api/holds` 的 `pendingCommits` 行（保留 004/009/011 build API 改动）、
   `app.js`（工作区差异 100% 为 010，restore）删 `pendingCommitCardHtml()`/`pendingExpanded`
   并还原 `renderHolds()` 单组形态、`i18n.js` 删 010 静态与动态词条（保留分支浏览词条）、
   `style.css` 删 `.hold-group-head/-foot`、`.hold-detail`、`.hold-paths`（保留其他单样式）、
   删除 010 测试文件；
3. 全量 `node scripts/tests/run-all.mjs`（229 文件）+ 前端资产语法与 vm 用例回归。

**实施记录**：实施中途人工授权的补交会话（`docs/agent-team-board/commit-recovery-20260914.md`）
按依赖顺序补交了 13 个暂扣条目（`06c5c34`…`a9fd6ea6` 等），其中明确「保留本回退结果，不
重新引入 010」，010 不补交——本回退的 7 处撤除随该批补交进入 Git 历史（提交时工作区已为
回退后内容，逐字节一致），本单新增的 014 测试文件按运行收尾自动提交归因。

## 风险与边界

- 回退不触碰 BUG-20260914-010 条目文档与 `dispatch/runs/` 账本（历史保留，F1 用例锁定）；
  010 的看板状态由人工处置（待确认），本单不动其状态机。
- 验收口径 `node scripts/web/build.js` 并非 Node 入口（浏览器脚本，`document` 未定义报错为
  既有现状）；「构建正常」以全量套件中真实执行 `app.js`/`i18n.js` 的 vm 用例 + 语法解析
  （`vm.Script` 全通过）等价核对。
- auto-commit 暂扣账本机制（`pendingManual` 明细写入，010 之前已有）不受影响，C1 用例
  锁定账本照常生成。
