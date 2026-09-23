# 测试用例 — REQ-20260923-002 开发收口恢复提交条目文档并忽略根目录文档变更（回退 REQ-20260922-007）

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| N1 | 批量收口恢复提交条目文档：认领后在条目目录新增/修改 markdown（design / test-cases / README / test-report）+ 改源码与测试 → 收口 3 组；doc 提交（`git show --name-only`）含本单条目目录路径、主题 `doc: <标题> <单号>`；回执与运行账本不再出现本单条目目录的 `ignoredDocs` 条目；条目目录收口后干净；test / 业务组归因不变 | P0 | 通过（req-20260923-002.test.mjs N1） |
| N2 | 根目录文档忽略（run-20260923-356 对照）：认领前根 README.md / AGENTS.md 已有人工未提交改动 + 运行期本单又改同一根文档（含新增未跟踪根 .md）→ 全部新提交不含任何根第一层文档路径；根文档差异保留工作区（未提交未还原）；无 `pendingManual`、不挂起（回执无 suspended、批次不暂停、无确认记录）、test / 业务组照常提交、实施锁释放；`confirmScopeForRun` 候选（attributed / uncertain / excluded）不含根文档 | P0 | 通过（N2） |
| N3 | 手动 /dev 通道（atb claim → atb report）同口径：条目文档随收口 doc 组提交、根文档不提交保留工作区 | P0 | 通过（N3） |
| N4 | 仅根文档改动（直接调 `autoCommitForRun`）：skipped、无新提交、不误报 committed、不挂起（`commitIncompleteReason` 为 null）、明细 auto-commit.json 如实记录 `ignoredDocs` | P0 | 通过（N4） |
| N5 | 板级共享维持：本单与他条目 confirmations.md 出库删除、看板共享文件 `git mv` 重命名（R 码）仍随本单 doc 组提交；本单条目普通文档同入 doc 组 | P1 | 通过（N5） |
| N6 | 回归：预留前已脏非看板源码 + 运行期再改 → pendingManual 暂扣与挂起照常、test / 业务组暂扣；doc 组照常提交（含条目文档），状态 committed（部分提交） | P1 | 通过（N6） |
| N7 | 幂等：收口成功后 `run autocommit` 重试不产生新提交、根文档仍未提交 | P1 | 通过（N7） |
| N8 | 仅条目文档改动（无源码）：doc 组提交（committed）、不挂起、不误报 | P1 | 通过（N8） |
| N9 | 表述同步：AGENTS.md / SKILL.md / dev-closeout.md 收口范围口径已按新口径更新 | P1 | 通过（N9） |

配套修订（007 期间写入的既有断言，随本单翻转）：`confirm-block-20260914-001` C09、`dev-flow-20260911-009` D5/D6、`bug-report-closeout-20260915-007`、`auto-commit-pre-dirty-20260913-006` P3/P4/P6；移除 `req-20260922-007.test.mjs`（断言整体反转，由本文件覆盖）。
