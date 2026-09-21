# 设计 — BUG-20260921-018 隔离分析误判已在 main 的共享提交为混合提交，合并被误阻断

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260920-003（构建和发布流程整改——`analyzePublishIsolation` 落定
  「同一 commit 关联多条目视为混合提交，列入 blocked（无法安全拆分）」的口径，
  未区分该提交是否已在目标分支上；已核验真实存在，状态 done）

## 根因分析

分析口径与执行语义不一致：

- **分析侧**（scripts/lib/build-git.mjs `analyzePublishIsolation`）：`shared` 收集
  「同一 hash 关联多条目」，一律生成 blocked，不检查该提交与目标分支的关系。
- **执行侧**（同文件 `mergeIsolatedIntoMain`）：
  - 已是目标分支祖先的提交走 `isAncestorOf` 幂等跳过（alreadyIncluded），多条目
    共享同一 hash 时每个（条目 × 提交）行都记成功，无任何风险；
  - 不在目标分支上的共享 hash 才有真实隐患——`replayPairsOrdered` 按（条目 × 提交）
    展开后只排序不跨条目去重，同一 hash 会被 cherry-pick 两次，第二次因补丁已应用
    变成空提交而失败；且 `replays` 重放证据按条目归属记录，共享 hash 归属含糊
    （这正是「无法安全拆分」的本意）。

触发条件：某提交主题列出多个条目编号（基线大提交 6f2ead6009aa 主题列了 250 个），
归因口径「commit 台账 ∪ 提交主题单号」使这些条目全部关联该 hash；当该提交同时已
在 main 上（本例：仓库基线提交，main 顶端已有多条 BLD-20260920-001 的 build 合并
提交），阻断即成为误伤——把必然幂等成功的合并整体挡住。

## 方案

`analyzePublishIsolation` 的 `shared` 计算加豁免过滤：共享 hash 若
`isAncestorOf(root, commit, targetBranch)` 为真（已是目标分支祖先），不列入
`blocked`，改为归入 `notes` 一条豁免说明（保留可见性，不静默）。不在目标分支上的
共享 hash 维持 blocked 与现有文案不变。

- 服务端 merge 端点（server.mjs，`analysis.blocked` 即抛 BuildConflictError）复用
  同一函数，自动同口径，无需单独改。
- 前端（scripts/web/build.js 合并页单行状态条）沿用 blocked 计数展示，无需结构
  改动；若豁免 note 需要展示则走既有 notes 通道。涉及文案改动同步
  scripts/web/i18n.js 中英双语。
- 测试：req-20260920-003 既有「L3-4 混合提交被分析阻止」用例拆为两条
  （不在 main 的混合仍阻断 / 已在 main 的共享豁免）；新增
  `scripts/tests/bug-20260921-018.test.mjs` 覆盖豁免分支（临时 git 仓库构造
  「两分支、共享提交、目标分支已含该提交」场景）先红后绿。

**开源选型（REQ-20260909-015）**：纯既有代码逻辑修正（一处过滤 + 文案 + 测试），
无合适库可替代，自研；不引入依赖，不创建 licenses.md。

## 风险与边界

- 豁免判定只认「目标分支祖先」（`git merge-base --is-ancestor`），与执行侧幂等
  判定完全同一函数同一口径，不存在「分析放行、执行失败」的缝隙。
- 已在 main 的共享提交在 perItem intermediates 中本来就不会产生未选祖先
  （`git log targetBranch..commit` 为空），依赖分析与「一键加入依赖提交」行为
  均不受影响（owners>1 跳过路径不动）。
- 不做更激进的「共享 hash 一律不算混合」：不在 main 的共享 hash 放行会在执行中
  双重 cherry-pick 失败并把版本置 failed，前置干净阻断优于执行中途失败。
- 历史误伤场景（本例 BLD-20260920-001）修复后自动解除，无需数据迁移。

## 实施记录（2026-09-21，owner: BUG-20260921-018）

按 design 方案落地，改动四处 + 测试两条线：

- `scripts/lib/build-git.mjs` `analyzePublishIsolation`：`shared` 遍历改分流——
  `isAncestorOf(root, commit, targetBranch)` 为真进 `exempted`（新字段，含 commit 与
  itemIds 明细），否则进 `blocked`（文案不变）；`notes` 首位追加豁免提示（含短 hash、
  关联条目数，不静默）。返回值新增 `exempted`。
- `scripts/server.mjs`：`/api/build/publish-plan` 的 mergeAnalysis 白名单透传
  `exempted`；merge 端点复用同一函数自动同口径（blocked 为空即放行），未改。
- `scripts/web/build.js` `renderMergePane`：blockedLine 之后渲染豁免单行
  （`bld-iso-note`、非 `role="alert"`——是提示不是阻断），title 附
  「短 hash（关联 N 个条目）」明细；无依赖分支同样展示。
- `scripts/web/i18n.js` EN_DYNAMIC 新增
  `已豁免 ◇ 处共享提交的混合判定（提交已在 ◇ 上，合并时幂等记成功）` 中英词条
  （计数与目标分支名双插值，往返已测）。
- 测试：新增 `scripts/tests/bug-20260921-018.test.mjs`（B1 豁免判定 / B2 分析与执行
  口径一致（alreadyIncluded 幂等 + 未在 main 提交仍重放）/ B3 不在 main 仍阻断 /
  B4 前端与 i18n 契约）；req-20260920-003 的 L3-4 拆为 L3-4a（不在 main 仍阻断，
  原“文案不变”口径）+ L3-4b（已在 main 豁免）。
- 真实场景复核：BLD-20260920-001（341 条目）修复前 blocked=1，修复后
  blocked=0、exempted=1（6f2ead6009aa，关联 250 条目）、notes 首条即豁免说明——
  合并误阻断解除。
- 全量 `npm test`：本单相关全部通过；仅 req-20260918-002 / req-doc-entry-20260916-003
  两文件因工作区中 REQ-20260921-005（BLD-20260920-001 发布文档重写，尚未接受落地）
  的 README.md / AGENTS.md 未提交改动而红——已在 HEAD 干净基线复跑确证与本次改动无关，
  归属该条目落地时同步，不另登记。
