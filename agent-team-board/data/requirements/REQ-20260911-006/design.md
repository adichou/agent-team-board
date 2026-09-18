# 设计 — REQ-20260911-006 回退REQ-20260911-004

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

main 分支尚无任何提交、工作区大量未提交改动，`git revert` / `git checkout` 不可用；
回退 = 按 `REQ-20260911-004` 注释标记逐处手工摘除（标记清单已在 README §背景 3 核实为全集，
且 scope API 在测试中只被 004 新增测试文件引用——删除该文件即无引用方）。

## 方案

### 1. 摘除点（手工反向应用 004 diff）

| 文件 | 摘除内容 |
| ---- | -------- |
| `scripts/lib/task-settings.mjs` | `defaultSettings()` 的 `commit` 分区；`loadTaskSettings` 对 `saved.commit` 的宽松读取；`saveTaskSettings` 的 `patch.commit` 校验段与 `next.commit` 恒写；文件尾部 `COMMIT_SCOPE_*` 常量与 `defaultCommitScope` / `normalizeCommitScopeToken` / `normalizeCommitScope` / `commitScopeOf` / `commitScopeAllowsFile` / `commitScopeText` 六函数整段（含 004 分节注释）；头部存储格式注释中的 commit 行 |
| `scripts/lib/commit-store.mjs` | task-settings import 中的六个 scope 符号（保留 `loadTaskSettings` 仅当仍有他处使用——核查后无则一并移除）；`buildCommitPrompt` 的 `scope` 参数、`sc` 计算、「提交目录范围：…」行与「范围外目录…（done 回执核验会拒绝范围外文件）」行、约束行「不得提交提交目录范围外的文件」、done 核验说明中的「与提交目录范围」措辞；`commitScopeOfBatch` 辅助函数；`createCommitBatch` 的 `scope` 读取与 `batch.scope` 字段、`buildCommitPrompt` 调用回归无 scope 形态；`commitSpecSummary` 由 `(scope) => …` 恢复为无参常量（删「提交目录范围：…」句）；`nextCommitItem` 的 `spec: commitSpecSummary(commitScopeOfBatch(batch))` 恢复 `spec: commitSpecSummary`；`validateItemCommits` 第 4 参 `scope` 与范围外文件拒绝段；`finishCommitRun` 调用回归三参形态 |
| `scripts/server.mjs` | `POST /api/tasks/settings` 的 `commit: body.commit ?? undefined` 透传行与 004 注释（body.commit 落回 agents/models 先例——键存在但被忽略） |
| `scripts/web/app.js` | `COMMIT_SCOPE_CATALOG` 等四常量、`commitSettingsHtml()`、`taskSettingsAreaHtml` 就绪态的 `+ commitSettingsHtml(ts)`、`bindSettingsView` 的 `csDraft/csRefresh/csDirty/csReset/csSave` 绑定段与 004 注释 |
| `scripts/web/style.css` | `.commit-settings` 分区样式块（1966 行与 `.task-settings .ts-table-wrap` 同行相接，仅摘前半、保留后半） |
| `scripts/tests/commit-scope-20260911-004.test.mjs` | 整文件删除（run-all 按 `*.test.mjs` 自动发现，删除即退出测试集） |

### 2. 回退后口径（恢复 004 前行为）

- 提示词：无任何「提交目录范围 / 范围外」语句；done 核验说明恢复五项口径
  （消息格式、单号、描述长度、测试/业务分离、条目文档归类）。
- 批次：`batch.json` 不写 `scope` 字段；提示词生成不读任务设置。
- 领取摘要 `spec`：恢复静态常量（类型五选一 / 描述 ≤20 字 / 业务测试分开 / 条目文档 doc 类 /
  只 commit 不 push），不含目录范围句。
- 核验 `validateItemCommits(projectRoot, hashes, itemDir)` 三参形态，无目录判定。
- 设置：默认值 / 读取 / 保存均无 `commit` 分区；存量 settings.json 残留 `commit` 分区按
  未知字段忽略（读取不透出、保存不写回）；API `POST` 携带 `commit` 键按 agents/models 先例忽略。
- 设置页：仅「批量任务」分区；加载 / 失败态与保存三态交互不变。

### 3. 防再引入断言（README 待确认 3 的 design 裁定：**补**）

新增 `scripts/tests/commit-rollback-20260911-006.test.mjs`（随本单登记，run-all 自动发现；
文件内不出现 004 标记 / scope 命名的字面 token——扫描目标以片段拼接构造，避免测试自身成为 grep 残留）：

- U1 数据层：defaults/load 无 `commit`；`patch.commit` 忽略不落盘不报错；存量残留 `commit`
  分区读取忽略、保存后不写回；refine/agents/models 读写不回归。
- U2 提示词与批次：`buildCommitPrompt` 输出不含「提交目录范围」「范围外」；`createCommitBatch`
  账本 `batch.json` 无 `scope` 字段。
- U3 领取摘要：`atb commit next` 输出 `spec` 为静态口径（无范围句、含类型/doc/不 push 要点）。
- U4 核验：范围外目录（如 `output/`）文件所在 commit 不再被拒；五项既有核验仍生效
  （坏主题 / 测试业务混提 / 条目文档非 doc 类均仍拒绝）。
- S1 服务端：GET 返回无 `commit`；POST 带 `commit` 键 200 且不落盘；`refine` 生效不回归。
- E1 设置页契约：就绪态仅一个分区（「批量任务」），无「批量 Commit」标题 / 目录复选框 /
  恢复默认按钮 / 空范围警示；保存载荷仅含 `refine`；tsSave 三态绑定仍在。
- R1 源码残留扫描：app.js / style.css / server.mjs / lib 两文件不含 004 标记与
  scope 命名（token 以拼接构造，避免测试文件自身成为 grep 残留）。

### 4. 不误伤（回归由 run-all 全量承载）

REQ-20260911-003 隐藏口径（`atb commit` 子命令 / `/api/commit/*` 路由）、BUG-20260910-014
徽标、BUG-20260911-005 快捷入口、BUG-20260911-006 全局聚合、REQ-20260910-013/014 核心流程、
REQ-20260910-027（developer 移除）均不动——既有测试 `commit-batch-20260910-013` /
`commit-serve-20260910-014` / `commit-ui-20260910-014` / `global-commit-20260911-006` /
`lane-quick-entry-commit-20260911-005` 不改不删。

## 开源选型（REQ-20260909-015）

纯手工回退既有自研代码，未引入任何开源库；不创建 licenses.md。

## 风险与边界

- style.css 1966 行两选择器同行相接：只摘 `.commit-settings .dir-item .tag.src { … }`，
  保留 `.task-settings .ts-table-wrap { … }`。
- 存量批次账本若带 `scope` 字段（当前不存在该目录，属假设防御）：回退后读取侧不消费该字段
  （`commitScopeOfBatch` 删除后无引用），无兼容负担。
- 本单不代做 REQ-20260911-004 条目自身状态流转（README 待确认 2，人工看板操作）。
