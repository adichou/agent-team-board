# 测试用例 — REQ-20260922-007 AI 开发过程中忽略文档的编写差异，不要提交文档到 git。文档有另外的流程提交

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 载体：`scripts/tests/req-20260922-007.test.mjs`（真实 git 临时仓库，模式对齐
> bug-20260918-003 / dev-flow-20260911-009）。全量 `npm test`（335 个测试文件）通过。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 批量收口不含条目文档：认领后在条目目录写 design.md/test-cases.md、改 README，同时改源码+测试 → report+finishRun 后，全部新提交（git show --name-only）不含本单条目目录任何路径、无 doc: 前缀提交；test/业务组提交主题与路径归因不变；文档改动保留在工作区（dirty） | P0 | 通过 |
| R2 | 文档被忽略而非丢失：收口后条目文档仍 dirty，可经文档讨论轮形态（pathspec + `doc: … <单号>` 主题）正常提交入库，`atb commit log` 关联该 doc 提交 | P0 | 通过 |
| R3 | 手动 /dev 通道同口径：atb claim（CLI 拍快照）→ 写文档+源码 → atb report（CLI）→ 收口提交不含条目文档、无 doc 提交、文档保留在工作区 | P0 | 通过 |
| R4 | 仅文档改动：批量 finishRun → skipped、无新提交、回执不误报 committed、原因注明不随收口提交；不挂起（receipt.suspended 无、批次不 paused、无确认记录、可继续派发）；auto-commit.json 明细如实（status=skipped + ignoredDocs）；手动通道同样 skipped 不挂起 | P0 | 通过 |
| R5 | 板级共享维持现状：他条目与本单条目目录内 confirmations.md 的删除（出库迁移）、看板共享文件 git mv 重命名（R 码）仍随本单 doc 组提交（主题带本单号） | P1 | 通过 |
| R6 | 回归：预留前已脏非看板路径 → pendingManual 暂扣与挂起照常（test/业务不提交、批次暂停）；此时条目文档同样不提交（保留工作区） | P1 | 通过 |
| R7 | 幂等：收口成功（含被忽略文档）后重试 `run autocommit` 不产生新提交、文档仍未提交、不挂起 | P1 | 通过 |
| R8 | 表述同步：AGENTS.md、skills/agent-team-board/SKILL.md、skills/agent-team-board/dev-closeout.md 收口范围表述已按新口径更新（收口只提交源码与测试；条目文档走文档讨论轮） | P1 | 通过 |
| R9 | 结果字段：autoCommitForRun 结果携带 ignoredDocs（含本单条目目录文档路径）；批量回执 receipt.autoCommit.ignoredDocs 如实携带 | P2 | 通过 |

既有测试同步（旧口径 → 新口径，随本单行为变更调整）：

| 测试 | 调整 |
| ---- | ---- |
| dev-flow-20260911-009 | D5/D6 三组→test/业务两组、目录干净→文档保留工作区；D7 幂等计数 2→1、重试原因接受文档口径；D13/D11 长标题与索引计数 3→2 |
| auto-commit-pre-dirty-20260913-006 | P3 暂扣场景 committed(doc)→skipped 零提交；P4 三组→两组；P6 计数 1→0；P7 借板级共享文件保留 doc 长标题场景 |
| bug-report-closeout-20260915-007 | 场景 A 3 组→2 组、条目文档不入库保留工作区；场景 B 重复 report 不再补交 doc（报告属条目文档） |
| confirm-block-20260914-001 | C01/C11 暂扣场景 committedGroups 1→0；C02 借板级共享文件保住「部分提交 hash 保留」；C09 无改动任务可验证原因纳入 ignoredDocs 口径 |
