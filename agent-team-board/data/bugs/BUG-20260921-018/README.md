# BUG-20260921-018 隔离分析误判已在 main 的共享提交为混合提交，合并被误阻断

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260920-003（构建和发布流程整改，引入隔离分析「同一 commit 关联多条目即判混合提交并阻断合并」的口径）
- 创建：2026-09-21T15:21:03.917Z

## 现象

版本计划 BLD-20260920-001（draft，341 条目）「合并入 main」页隔离分析显示
「⚠ 1 处混合提交无法安全拆分，合并将被阻止」，合并无法进行。

定位到的混合提交是 `6f2ead6009aa721c82ccc7f044a56cd89a9f2c49`（2026-09-12 02:13
`feat: 支持需求管理模块`，主题里列出 2026-08-29 至 09-11 约 250 个条目编号，
1506 个文件、+179905 行，即当时整个仓库状态的基线大提交）。条目↔提交归因口径是
「commit 台账 ∪ 提交主题单号」，该提交主题把 250 个单号全列了，于是版本内
250/341 个条目的提交集合都恰好只有这一个 hash → 被判同一 hash 关联多条目 → blocked。

关键事实：该提交**已经是 main 祖先**（内容早已在 main 上；main 顶端已有多条
BLD-20260920-001 的 build 合并提交）。执行侧 `mergeIsolatedIntoMain` 对已在 main
的提交幂等记成功（alreadyIncluded），无双重 cherry-pick、无冲突风险——分析口径
把这类提交判成混合提交属于误伤，与执行语义自相矛盾。

## 复现步骤

1. 打开 Status Board 版本计划 BLD-20260920-001「合并入 main」页，隔离分析节出现
   「⚠ 1 处混合提交无法安全拆分，合并将被阻止」（完整原因在单行状态条 title 里，
   指向 6f2ead6009aa 关联 250 个条目）；点击合并主按钮被阻断。
2. `git merge-base --is-ancestor 6f2ead6009aa721c82ccc7f044a56cd89a9f2c49 main`
   退出码 0 —— 该提交已在 main。
3. 服务端同口径复现：`analyzePublishIsolation(root, v.items)` 返回 `blocked` 长度 1，
   `shared[0].commit === 6f2ead6009aa…`，关联条目 250 个。

## 期望行为

- 已是目标分支（main/master）祖先的共享提交**不判混合提交**：分析口径与执行侧
  幂等语义（alreadyIncluded）一致，不再阻断合并。
- 不在目标分支上的共享 hash **仍判混合并阻断**：执行序列 `replayPairsOrdered`
  按（条目 × 提交）展开后不跨条目去重，共享 hash 会被 cherry-pick 两次，第二次
  因补丁已应用变成空提交而失败；且重放证据按条目归属记录，共享 hash 下归属含糊。
  现有「请调整关联或先合并为一个条目」的引导保留。

## 验收标准

1. `analyzePublishIsolation` 对 `isAncestorOf(commit, targetBranch)` 为真的共享
   hash 不列入 `blocked`（可降级为 notes 提示已豁免）；服务端 merge 端点因复用该
   函数自动同口径。
2. 不在目标分支上的共享 hash 仍列入 `blocked`，阻断文案不变。
3. 依赖反查路径（add-dependencies 的 owners>1 跳过）行为不变——依赖集合来自
   `git log main..commit`，已在 main 的提交本就不会进入依赖反查，无需同改。
4. 前端合并页单行状态条与 i18n 中英双语同步；既有测试
   req-20260920-003 的「L3-4 混合提交被分析阻止」用例拆为
   「不在 main 的混合仍阻断」+「已在 main 的共享豁免」两条。
5. TDD：新增 `scripts/tests/bug-20260921-018.test.mjs` 先红后绿；`npm test` 全量通过。
