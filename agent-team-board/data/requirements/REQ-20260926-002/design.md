# 设计 — REQ-20260926-002 发布模块简化为条目与提交组版、挑选合并、文档翻译合并及官网更新流程

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

旧发布流程把「文档完成」作为功能合入 main 的前置门禁（assertMergeDocsGate），把「同一提交关联多个条目」判为混合提交阻断（analyzePublishIsolation.blocked），并用「一键加入所有依赖提交」引导用户纳入未选祖先——组版困难、文档依据不明确。本需求按用户确定的流程重排：先组版挑选合并，再依据实际合入内容编写文档，文档单独提交合入 main，最后发布（推送远端 + 官网资料更新）。

## 方案

（技术选型、接口设计、影响面）

**开源选型（REQ-20260909-015）**：本需求为既有模块的流程重排与数据结构扩展，未引入新的第三方依赖，沿用 Node 内置模块（node:fs / node:child_process / node:crypto 等）。理由：cherry-pick 编排、版本计划快照与门禁求值均是对本仓库既有自研层（build-git / build-store / publish-flow）的改造，无成熟的同构开源库可直接替代（cherry-pick 语义由 git 本身提供，经既有 spawnSync 通道调用）；引入通用 Git 封装库（如 simple-git）仅减少少量 spawn 样板代码，却增加依赖面与 License 审查成本，引入成本高于自研收益。

**五步重定义（publish-flow.mjs）**：`PUBLISH_STEPS = plan（选择条目与提交）→ merge（挑选合并）→ docs（文档与翻译）→ docmerge（文档合并）→ release（发布）`。link 键移除（并入 plan，快照恢复归一 link → plan）；`publishStepsState` 门禁重写：挑选合并只要求有条目且状态可合并（不再要求文档已提交）；文档与翻译在挑选合并完成后解锁（旧计划已有文档提交记录兼容解锁）；文档合并要求 evaluateDocsState overall=committed；发布要求 status=merged 且 `v.docsMerge.commitHash` 落账。

**数据层（build-store.mjs）**：新增 `recordDocsMerge`——把文档合并证据落账到 `v.docsMerge`（commitHash / replayedHash / mainSha / replays / mergedAt / history）；history 逐次累积（已合入事实不抹除）、replays 按 original 去重合并（重复合并幂等）。已合入条目（mergedAt）不可移出、不可更换提交关联（显式 BuildConflictError，非静默）；`assertMergeDocsGate` 随门禁移除整体下线。

**Git 层（build-git.mjs）**：
- `mergeIsolatedIntoMain`：执行循环改为按提交 hash 去重（`uniqueCommits`），共享提交只 cherry-pick 一次，执行结果（outcome Map）复制到每个关联条目（各条目结果一致）；冲突报错附冲突文件清单（abort 前 `git diff --name-only --diff-filter=U`）与提交主题。
- `analyzePublishIsolation`：blocked / exempted 分类整体移除；shared 如实记录，notes 说明「按 hash 去重只执行一次」；perItem 未选祖先明细保留为只读参考。
- 新增 `mergeDocsCommitIntoMain`：临时工作树检出 main 后 `cherry-pick -x` 文档提交；幂等（原始提交已是 main 祖先，或既有重放证据显示已重放且重放提交在 main → alreadyIncluded 不重复执行）；冲突兜底——存量「先文档后合并」计划的增量文档提交其补丁基于上一文档提交而 main 尚无基础文件，abort 后按文档白名单（服务端传入语言集展开清单，防带入业务文件）从该提交树中检出文档内容落到 main 并建「docs: 发布文档 <计划号>（重放 <short>）」重放提交，重放证据保持可溯。

**服务端（server.mjs）**：合并端点删除 assertMergeDocsGate 与 analysis.blocked 前置；`/api/build/version/add-dependencies` 端点不再注册（404，一键纳入引导下线）；新增 `POST /api/build/docs/merge`（文档提交后合入 main，幂等回填）；`/api/build/release/push` 增加 docsMerge 门禁（文档未合并入 main 前推送 400）；publish-plan 的 mergeAnalysis 不再下发 blocked / exempted。

**前端（web/build.js + web/i18n.js）**：五步导航（选择条目与提交 / 挑选合并 / 文档与翻译 / 文档合并 / 发布）；第一步同时展示概况与条目—提交关联（link 并入）；新增文档合并步面板（`data-docs-merge` 动作 + 落账证据展示 + 幂等提示）；合并页移除一键加入按钮 / 跳过清单 / 混合提交与豁免行，新增共享提交单行说明（title 含提交与关联条目明细），未选祖先明细降级只读；发布步改两动作布局（动作一 · 推送远端 `data-pf-push` / 动作二 · 官网资料更新），推送 / 检测结果分别展示；i18n 中英同步（新增五步与文档合并、发布两动作词条；一键纳入与混合阻断词条随界面清理）。

**测试（scripts/tests/req-20260926-002.test.mjs，11 用例）**：L1 纯逻辑五步与门禁 → L2 数据层落账与已合入保护 → L3 Git 层共享提交去重 / 分析不阻断 / 冲突明细 / 文档合入幂等 → L4 服务端全链路（无文档合并、add-dependencies 404、docs/merge、推送门禁、条目删除后快照保留）→ L5 前端契约与 i18n。受行为变更影响的存量测试同步更新为 新口径（req-20260920-003 / req-20260921-007 / 008 / 012 / 013 / 015 / 016、bug-20260920-005 / 20260921-015 / 20260921-016 / 20260921-018 / 20260926-003、bug-build-* ×3、build-plan-edit、build-serve）：add-dependencies 用例改为 404 + 版本范围不变；一键加入交互用例改为「无入口、不发请求」；门禁类断言移到文档合并步。BUG-20260926-003 的归因辅助函数（subjectAttributionItemId / commitPathItemOwners）保留于 git-flow（U1 单元用例不回归），其端点级用例随端点下线移除（与本条目「关联」约定的协调口径：重叠部分以本需求流程重排为准，不重复实现两套引导）。

## 风险与边界

- 挑选合并不再校验文档 → 依据实际合入内容编写文档的顺序约束由流程门禁（docs 步锁定至合并完成）承接；已合入事实通过 mergedAt / docsMerge.history / merge.replays 三层留痕，计划编辑不可静默抹除（removeItems / setItemCommit 显式报错）。
- 增量文档提交的兜底重放按「内容进入 main」语义执行（非逐行补丁），重放提交消息携带原提交短 hash，证据链经 replays 可回溯；若文档白名单与提交树交集为空仍按冲突报错，不猜测内容。
- 推送门禁以 `v.docsMerge.commitHash` 落账为唯一依据：存量已推送计划（release.pushedAt 已存在）不受影响；存量 merged 未推送计划需先完成一次「文档合并」落账后才可推送（兼容路径即本端点的幂等重放）。

---

## 实施记录（2026-09-27，batch-20260927-076）

- 影响面：scripts/lib/{publish-flow,build-store,build-git}.mjs、scripts/server.mjs、scripts/web/{build.js,i18n.js}、scripts/tests/req-20260926-002.test.mjs（新增）与 17 个存量测试文件的口径更新。
- 测试结果：条目测试 11/11 通过；全量 `node scripts/tests/run-all.mjs` 359 个测试文件 0 失败。
- 实施要点：见上文「方案」「风险与边界」（TDD：上一轮中断遗留的测试骨架与 publish-flow 五步重写基础上继续，先补齐 L2–L5 跑红用例的实现，再全量收敛）。
- 关联协调：BUG-20260926-003 的一键加入端点通道随本需求下线（404），其归因辅助函数与单元用例保留；BUG-20260926-003 README 的用户补充（工程单据历史提交）转为「未选祖先只读明细」展示，不再渲染为必须补齐的功能依赖。
