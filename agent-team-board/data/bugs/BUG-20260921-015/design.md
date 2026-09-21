# 设计 — BUG-20260921-015 一键加入依赖跳过已关联条目的其他提交，导致发布范围不完整及实现代码漏发风险

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260921-015（版本计划「合并入 main」页隔离分析与「一键加入所有依赖提交」；
  `git blame` 定位 scripts/server.mjs add-dependencies 接口 02cde5ad，编号已经 `atb list` 核验存在）

## 根因分析

1. **接口按条目去重而非按提交去重**：`POST /api/build/version/add-dependencies` 把依赖提交经
   itemCommitStatusIndex 反查归属条目后，若 `inVersion.has(itemId)` 直接 skipped（原因文案
   「条目 … 已在本版本（当前关联另一提交）」）——默认「一条目只能关联一个提交」。
2. **版本数据模型一条目一提交**：build-store.normalizeItems 禁止 itemId 重复、条目形态为
   `{ itemId, commit }` 单提交；新依赖条目有多个依赖提交时接口只保留一个「最新」提交
   （pick by date），其余提交不进发布范围。
3. **隔离合并只重放所选提交**：build-git.mergeIsolatedIntoMain 按条目逐个 cherry-pick
   `it.commit`，同条目未选中的实现 / 测试提交不会进入 main；隔离分析
   （analyzePublishIsolation）也按单提交构建 selected 集合，与合并执行 / 发布包含性校验
   （build-publish.assertItemsIncluded、product-release-git.verifyItemsOnMain 均按
   `item.commit` 单提交核验）口径耦合在单提交模型上。
4. 既有回归测试 req-20260921-015.test.mjs B2 把「已在本版本条目其他提交被跳过」写成预期，
   掩盖了该缺陷。

## 方案

**开源选型（REQ-20260909-015）**：无合适库——本修复是本仓库版本计划数据模型与 git 隔离
合并流程的内部一致性修复（Node 内置 child_process/git CLI 即全部依赖），无对外引入库；
未引入任何开源依赖，不创建 licenses.md。

**数据模型（一条目多提交，向后兼容）**：

- 条目形态升级为 `{ itemId, commit, commits: [hash…], title, mergedAt, mergeError }`：
  `commits` 为事实源（40 位 hash、小写、条目内去重）；`commit` 保留为首个提交的别名
  （旧读取方 / 冻结快照向后兼容）。
- 兼容迁移：读取路径（readVersion / listVersions）对旧单提交数据就地补全
  `commits = [commit]`（不落盘、不抛错）；任一后续写操作整体写回新形态。旧单提交版本数据
  零迁移可用。
- 新增 build-store.appendItemCommits：给已在本版本的条目追加提交（保留原有关联与顺序、
  按 hash 去重幂等、mergedAt/mergeError 复位待重新合并）；锁定口径与 addItems 一致
  （merging / 已推送 BuildConflictError）；补入联动 markDocsScopeStale。
- scopeFingerprintOf / publishScopeFingerprint 改为 commits 全量参与指纹（补入提交即
  范围变化，旧文档提交标识失效）。

**一键加入按提交 hash 去重**：

- 归属条目已在本版本 → 补入该条目其余符合纳入条件的依赖提交（不再「已在本版本」跳过）；
  同一新条目多个依赖提交全部保留（收集序新→旧，统一反转为旧→新，主提交取最早一个）。
- 真正无法纳入的保持跳过并逐条说明原因：无法归属 / 混合提交（一提交关联多条目）/ 条目
  不在看板 / 未完成（非 done）/ 跨版本占用。响应新增 `appended`（既有条目补入清单），
  `added` 为新入条目（含 commits 全量）。

**隔离分析 / 合并执行 / 包含性校验同一提交集合**：

- analyzePublishIsolation：selected = 全部条目全部提交；perItem 按条目聚合其全部提交的
  未选祖先（hash 去重）；同条目不同提交不算混合提交。
- mergeIsolatedIntoMain：（条目 × 提交）展开为逐提交行，按 Git 依赖顺序重放
  （rev-list --topo-order --reverse，排除目标分支可达历史后过滤回所选集合；失败回退输入
  顺序）；新增 replays 入参——原始提交或其已记录重放提交已在主分支 → 幂等记成功
  alreadyIncluded，不重复 cherry-pick（避免空提交失败），支撑补入后重开合并的增量续传。
- mergeCommitsIntoMain / precheckMerge 同步多提交展开（旧 --no-ff 路径行为语义不变）。
- finishMerge：results 按（itemId, commit）逐提交一行，同条目多行聚合判定——任一行失败
  即条目失败（保留首个原因），全部成功才记已合并；merge 端点 allMerged 判定与
  mainSha 冻结同步按聚合口径。
- 发布包含性校验三处（build-publish.assertItemsIncluded 并导出供回归、
  product-release-git.verifyItemsOnMain、/api/product-release/from-build 冻结与额外提交
  剔除）均改为 commits 全量核验；产品发布冻结快照带 commits 全量（旧快照 commit 兜底）。

**前端**：关联条目与提交列表以 chips 展示条目全部提交（锁定态 title 说明）；搜索匹配
覆盖全部提交哈希；合并确认清单列出全部提交；一键加入 toast 区分「新入条目 / 补入提交」；
新增文案 i18n 中英同步（EN / EN_DYNAMIC）。

**测试（先红后绿）**：新增 scripts/tests/bug-20260921-015.test.mjs（G1–G4 数据层与 git 层
直连：模型 / 迁移 / appendItemCommits / topo 重放乱序存储仍成功 / replays 幂等续传 /
finishMerge 多行聚合；H1–H3 真实临时 Git 仓库 + HTTP 端到端：复现场景补入不再跳过、隔离
分析收敛、幂等、合并入 main 后主分支含 doc/feat/test 真实内容、包含性校验一致通过、无法
纳入逐条说明）；同步修正 req-20260921-015.test.mjs B2 旧预期（已在本版本 → 补入）与
bug-20260920-005 / build-release-card-items-search-20260915-003 的行内锁态断言（换选下拉
改为全部提交 chips 展示）。

## 风险与边界

- 兼容：旧单提交版本数据读取即迁移（内存补全，不强制改盘）；旧产品发布冻结快照（仅
  commit）读取方按 commits || [commit] 兜底；单提交场景行为与修复前一致（含 B1/B3/B4、
  L3 隔离合并既有用例全部保持通过）。
- 依赖顺序重放：rev-list 排序失败时回退输入顺序（保留旧行为）；已在目标分支内的提交不
  参与排序、执行侧 isAncestorOf / replays 幂等跳过。
- 「一键加入」不自动执行合并与文档提交：补入后按既有机制标记发布范围变化（文档需重新
  核对 / 提交），门禁与人工确认流程不变。
- 祖先关系仍只是 Git 依赖证据：补入后隔离分析对「全部依赖均可纳入」场景收敛为无未选
  祖先；真正无法纳入的依赖（无归属 / 混合 / 未完成 / 占用）持续在跳过清单说明，不静默、
  不隐藏警告。
