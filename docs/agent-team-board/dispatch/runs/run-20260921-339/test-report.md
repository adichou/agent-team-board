# 测试报告 — BUG-20260921-015 一键加入依赖跳过已关联条目的其他提交，导致发布范围不完整及实现代码漏发风险（run-20260921-339）

- 日期：2026-09-21　执行：BUG-20260921-015（批次 batch-20260921-061，TDD 先红后绿）
- 测试框架：node:assert + 真实临时 Git 仓库 + HTTP 集成（仓库自研测试骨架，node scripts/tests/run-all.mjs 聚合）
- 覆盖率：86%（新增回归覆盖本次全部改动层：store 模型 / git 分析与重放 / server 接口 / 发布包含性校验；前端交互经既有 F 系列与更新后的行内锁态断言覆盖）
- 完整输出：`docs/agent-team-board/dispatch/runs/run-20260921-339/test-output.log`

## 先红后绿

新增 `scripts/tests/bug-20260921-015.test.mjs`（7 例）在实现前 6 例失败（H3「真正无法纳入仍跳过」修复前即通过，作为对照保留），实现后 7/7 通过：

- G1 数据模型：commits 数组建版 / 旧单提交数据读取迁移（不落盘零迁移）/ appendItemCommits 追加去重幂等、保留原有关联、mergedAt 复位、scopeStale 联动、merging / 已推送锁定、非法 hash 与条目不在版本报错；
- G2 一致集合与依赖顺序重放：多提交条目隔离分析无未选祖先、同条目多提交不算混合提交；同文件 doc→feat→test 三提交乱序存储仍按 Git 依赖顺序（topo）重放成功，main 含全部三段内容；
- G3 幂等续传：已重放提交经 replays 证据记成功不重放，main 提交数不变（不制造空提交失败）；
- G4 finishMerge 多行结果：一条目多提交部分失败 → 条目失败保留原因；重试全成功 → merged；
- H1 复现场景修复（HTTP + 真实仓库）：已关联条目的其余依赖提交被补入（不再「已在本版本」跳过）、条目原有关联保留不替换、隔离分析收敛为 0、重复执行幂等不重复添加、scopeStale 联动；
- H2 数据路径验收（HTTP + 真实仓库 + 数据层合并）：同一新条目多个依赖提交全部保留（不再只取最新一个）；一键加入后合并入 main，主分支真实包含 doc/feat/test 与新条目两提交内容（逐文件 git show 断言，非仅提示消失）；assertItemsIncluded 以同一提交集合 + 重放证据通过；
- H3 真正无法纳入的仍逐条说明原因（无归属 / 未完成 / 跨版本占用 / 混合归属），且不存在「已在本版本」类跳过；既有校验不弱化。

同步修正既有测试的旧缺陷预期（README「定位记录」第 5 条）：

- `req-20260921-015.test.mjs` B2：改按修复后口径断言（已在本版本条目补入其余提交、新条目多提交全保留），11/11 通过；
- `bug-20260920-005.test.mjs` U3 与 `build-release-card-items-search-20260915-003.test.mjs` R8：条目行由单选项「换选下拉」改为全部提交 chips 展示，锁态断言改按 chips title（锁定原因仍可见），均通过；
- `product-release-store.test.mjs` A1：产品发布冻结快照随模型带 commits 全量，断言同步。

## 实现范围

- `scripts/lib/build-store.mjs`：条目多提交模型（commits 事实源 + commit 别名；读取路径旧数据零迁移补全）；appendItemCommits；finishMerge 逐提交结果聚合；scopeFingerprintOf 全量提交。
- `scripts/lib/build-git.mjs`：precheckMerge / analyzePublishIsolation / mergeCommitsIntoMain / mergeIsolatedIntoMain 多提交展开；replayPairsOrdered 按 rev-list --topo-order --reverse 依赖排序（失败回退输入顺序）；replays 已重放幂等跳过。
- `scripts/server.mjs`：add-dependencies 按提交 hash 去重（已在本版本补入 appendItemCommits、新条目多提交全保留、响应新增 appended）；merge 端点传入既有 replays、allMerged 按条目聚合；/api/product-release/from-build 冻结与额外提交剔除用全量提交。
- `scripts/lib/build-publish.mjs`（assertItemsIncluded 导出 + 全量提交核验）、`scripts/lib/product-release-git.mjs`（verifyItemsOnMain 全量提交）、`scripts/lib/product-release-store.mjs`（冻结快照带 commits）、`scripts/lib/product-release-pipeline.mjs`、`scripts/lib/publish-flow.mjs`（publishScopeFingerprint 全量提交）。
- `scripts/web/build.js`（commitsOf / 关联列表 chips / 搜索覆盖全部提交 / 合并确认清单 / AI 完善提示词 / 一键加入 toast 分场景）、`scripts/web/i18n.js`（EN 2 条 + EN_DYNAMIC 4 条）、`scripts/web/style.css`（chips 样式）。

## 回归验证（同 log 文件）

- bug-20260921-015（7/7）、req-20260921-015（11/11，含 B1/B3/B4 与 F1–F6/S1 前端契约不回归）；
- bug-20260920-005（7/7）、build-release-card-items-search-20260915-003（11/11）、product-release-store（10/10）、req-20260920-003（22/22，隔离合并 / 文档门禁 / 推送语义不回归）；
- npm test 全量 318 文件仅 2 个失败：req-20260918-002.test.mjs 与 req-doc-entry-20260916-003.test.mjs——均为在途发布文档（BLD-20260920-001 未提交 README/AGENTS 重写）触发的既有断言失败，仅读取 README.md / AGENTS.md / state-guard.mjs，本次未触碰这些文件（已核 git diff），与本单无关。

## 归因

引入来源：REQ-20260921-015（add-dependencies 接口 02cde5ad；编号经 atb list 核验存在），已写入条目 design.md。
