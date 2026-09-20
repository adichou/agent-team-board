# 测试用例 — REQ-20260908-015 需求完善功能只需完善说明文档即可，设计文档是开发时需要写的。说明文档需要有 UI 设计，需要有界面展示。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | store：requirement 夹具 README 完整（描述 + 验收标准合计 ≥30 字）、design 仅模板、test-cases 无用例——`analyzeItemDocs` 返回 complete=true，reasons 不含 design/test-cases 任何原因（scripts/lib/refine-store.mjs） | P0 | ✅ S1/S2 用例 |
| S2 | store：requirement 目录缺 design.md / test-cases.md 文件——同样不影响 complete 判定，不再报「design 缺失」「test-cases 缺失」 | P0 | ✅ S1/S2 用例 |
| S3 | store（回归）：requirement README 描述仅「（待补充）」/ 验收标准仅编号占位 / 描述+验收合计 <30 字——仍分别报「README 描述待补充」「验收标准待补充」「README 说明过简」 | P0 | ✅ S3 用例（含 R1 回归） |
| S4 | store（回归）：Bug 四项判定不变——缺现象 / 缺复现 / 缺期望 / 缺验收与说明过简照旧报原因；Bug 侧不引入界面展示判定 | P0 | ✅ S4 用例（含 R1 回归） |
| S5 | store：requirement 描述节含 UI 关键词（如「按钮」「弹窗」）且 README 无「界面展示」节——reasons 含「涉及 UI 需界面展示」 | P0 | ✅ S5 用例（词表 11 词逐词断言） |
| S6 | store：README 已含「界面展示」节但正文仅「（待补充）」占位——reasons 含「界面展示待补充」；节内有 ASCII 线框等实质内容时不报 | P0 | ✅ S6 用例（占位/线框/误判兜底三态） |
| S7 | store：描述不含 UI 关键词的非 UI 需求（纯流程类）——无「界面展示」相关原因（关键词启发式不误伤的代表性样本，按 design.md 定案词表补齐边界样本） | P1 | ✅ S7 用例（另 S5 固化全词表边界） |
| S8 | store：`refineCandidates` 只收 README 不完整的 submitted 需求；README 完整、design 仅模板的条目不入候选；排序口径（req 优先 → 创建早 → 编号）不变 | P0 | ✅ S8 用例（R2/R10c 亦覆盖） |
| S9 | store（回归）：`docsFingerprint` 仍覆盖 README/design/test-cases 三文档；`refine done` 在 worker 仅修改 README.md 后回执成功（指纹变化即通过核验）；三文档均未改时仍拒绝记完成 | P0 | ✅ S9 用例（未改拒绝由 R6 覆盖） |
| S10 | store（回归）：存量冻结批次 `candidates[].reasons` 快照不重算——创建于旧口径的批次其候选原因文案保持原样，收尾与核对（checkRefineBatch）行为不变 | P1 | ✅ S10 用例（手改账本模拟旧口径快照） |
| P1 | prompt：`buildRefineWorkerPrompt` / `buildRefinePrompt` 文案断言——含「界面展示」与「只补 README」口径，不再出现「/design/test-cases」补全要求；Bug 半句（现象/复现步骤/期望行为/验收说明）保留 | P0 | ✅ P1 用例 |
| C1 | CLI：`atb refine next` 对 README 完整（design 模板态）的 submitted 需求不再发放，跳过并继续找下一个候选；输出「下一步」指引行与新口径一致（scripts/atb.mjs） | P1 | ✅ R10c 用例（create 无候选报错 + 下一步行断言） |
| H1 | server：`/api/refine/candidates` 响应中 requirement 的 reasons 不含 design/test-cases 原因；涉及 UI 缺界面展示的条目 reasons 含新原因（scripts/server.mjs 完善面板数据源） | P1 | ✅ R11 扩展（refine-serve.test.mjs） |
| F1 | fixture：fake-codex 夹具输出语句（scripts/tests/fixtures/fake-codex.mjs L307）更新为新口径，codex 完善相关测试（refine-serve / codex 路径）不破 | P1 | ✅ refine-serve codex 全链路通过 |

结果（2026-09-08，zcode-batch-016-1）：`node scripts/tests/refine-store.test.mjs`、`refine-cli.test.mjs`、`refine-serve.test.mjs`、`refine-ui.test.mjs` 全部通过；全量 `scripts/tests/run-all.mjs` 87 个测试文件失败 0（dispatch-api 曾一次偶发失败，单独与整体各重跑两次均通过，未触及本次改动路径）。
