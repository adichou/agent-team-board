# 测试用例 — REQ-20260911-006 回退REQ-20260911-004

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现：`scripts/tests/commit-rollback-20260911-006.test.mjs`（run-all 自动发现）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| U1 | 数据层回退：`defaultSettings`/`loadTaskSettings` 返回无 `commit` 分区；`saveTaskSettings` 携带 `patch.commit` 按 agents/models 先例忽略（不落盘、不报错，refine 等分区正常生效）；存量 settings.json 残留 `commit` 分区时读取忽略、保存后不写回 | P0 | 通过（先红后绿） |
| U2 | 提示词与批次回退：`buildCommitPrompt` 输出不含「提交目录范围」「范围外」语句；`createCommitBatch` 账本 `batch.json` 无 `scope` 字段且创建不读任务设置 | P0 | 通过（先红后绿） |
| U3 | 领取摘要回退：`atb commit next` 输出 `spec` 为静态口径——不含目录范围句，仍含类型五选一 / 描述 ≤20 字 / 业务测试分开 / 条目文档 doc 类 / 只 commit 不 push 要点 | P0 | 通过（先红后绿） |
| U4 | 核验回退：含 004 默认范围外目录（如 `output/`）文件的 commit 不再被拒；五项既有核验仍生效（坏主题行拒绝 / 测试与业务混提拒绝 / 条目目录文档非 doc 类拒绝） | P0 | 通过（先红后绿） |
| S1 | API 回退：GET `/api/tasks/settings` 返回无 `commit` 分区；POST 携带 `commit` 键返回 200 且不落盘不报错；`refine` 开关读写不回归 | P1 | 通过（先红后绿） |
| E1 | 设置页回退：就绪态仅「批量任务」一个分区——无「批量 Commit」标题、无目录复选框两组 / 恢复默认按钮 / 空范围警示 / 未配置空态条；流转开关与 tsSave 保存三态绑定保留；保存载荷仅含 `refine` | P1 | 通过（先红后绿） |
| R1 | 源码残留扫描：`scripts/lib/task-settings.mjs`、`scripts/lib/commit-store.mjs`、`scripts/server.mjs`、`scripts/web/app.js`、`scripts/web/style.css` 不含 004 标记与 scope 命名（commit-settings / cs 系控件 id / data-cdir / __root__ / COMMIT_SCOPE / commitScope / REQ-20260911-004） | P0 | 通过（先红后绿） |
| W1 | 全量回归：删除 `commit-scope-20260911-004.test.mjs` 后 `npm test`（run-all）全绿，重点 commit-batch-20260910-013 / commit-serve-20260910-014 / commit-ui-20260910-014 / global-commit-20260911-006 / lane-quick-entry-commit-20260911-005 不回归 | P0 | 通过（199 文件 0 失败） |
