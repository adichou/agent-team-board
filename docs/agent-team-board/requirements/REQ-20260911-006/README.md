# REQ-20260911-006 回退REQ-20260911-004

- 状态：accepted（已接受；实际状态以 status.json 为准）
- 创建：2026-09-11T09:07:46.296Z

## 描述

整体撤销 REQ-20260911-004（「在设置中支持对 commit 到 git 的目录进行设置，默认只 commit 源代码相关目录」）已实施的全部改动，把批量 commit 流程与设置页恢复到该功能引入前的行为：调度提示词与 done 核验不再有目录范围约束，领取摘要恢复静态口径，设置模块恢复仅「批量任务」分区，`/api/tasks/settings` 不再读写 `commit` 分区，并删除该单新增的测试文件。

### 背景与现状（均已在代码核实）

1. **004 已实施完毕、待人工确认**：条目状态 in-progress，2026-09-11T08:47 由 zcode-batch-038-1 上报测试报告（新增 10 用例先红后绿、npm test 194 文件零回归，见其 status.json / test-report.md）。本单创建于 09:07（004 上报后约 20 分钟），登记为对其整体回退。
2. **无 git 基线可 revert**：本仓库 main 分支尚无任何提交（`git log` 报 "does not have any commits yet"），工作区存在大量未提交改动——回退只能**手工摘除代码**，不能依赖 `git revert` / `git checkout`。
3. **004 实施改动点全集（即回退清单，源码内均带 `REQ-20260911-004` 注释标记）**：
   - `scripts/lib/task-settings.mjs`（5 处标记）：`defaultSettings()` 默认 `commit` 分区；`loadTaskSettings` 宽松读 `saved.commit`（含 `configured` 标记）；`saveTaskSettings` 的 `patch.commit` 严格校验（顶层目录 token 规范化 / `rootFiles` 布尔 / 范围全空整体拒绝）且 `next` 恒写 `commit` 分区；导出 `COMMIT_SCOPE_*` 常量与 `defaultCommitScope` / `normalizeCommitScopeToken` / `normalizeCommitScope` / `commitScopeOf` / `commitScopeAllowsFile` / `commitScopeText` 六个函数。
   - `scripts/lib/commit-store.mjs`（9 处标记）：`buildCommitPrompt` 新增 `scope` 参数并注入「提交目录范围」提示词行与「不得提交提交目录范围外的文件」约束行；`commitScopeOfBatch` 辅助函数；`createCommitBatch` 读取任务设置并把 `scope` 冻结进 `batch.scope`（提示词同源）；`commitSpecSummary` 由静态常量改为按冻结范围生成的函数（尾部追加「提交目录范围：…」句）；`validateItemCommits` 新增第 4 参 `scope`，范围外文件整体拒绝；`finishCommitRun` 调用核验时传 `commitScopeOfBatch(batch)`；从 task-settings import 六个 scope 函数。
   - `scripts/server.mjs`（1 处标记）：`POST /api/tasks/settings` 透传 `body.commit`。
   - `scripts/web/app.js`（3 处标记 + 常量块，6897 行起）：`COMMIT_SCOPE_CATALOG` 等四个目录清单常量；`commitSettingsHtml()` 渲染设置页「批量 Commit」分区；`taskSettingsAreaHtml()` 就绪态在「批量任务」分区后追加该分区；`bindSettingsView` 内 `csSave` / `csReset` / `csStatus` / `csEmptyWarn` 绑定（草稿变更提示 / 恢复默认 / 空范围警示与保存禁用 / 保存三态）。
   - `scripts/web/style.css`（1 处标记，约 1955–1968 行）：`.commit-settings` 分区样式（`dir-group` / `dir-list` / `dir-item` / `tag`）。
   - `scripts/tests/commit-scope-20260911-004.test.mjs`：004 新增的 544 行测试文件（`run-all.mjs` 按 `*.test.mjs` 自动发现——删除文件即自动退出测试集）。
4. **运行时数据干净、无迁移负担（已核实）**：`docs/agent-team-board/tasks/settings.json` 现内容不含 `commit` 分区（该设置从未保存过）；`docs/agent-team-board/commits/` 批次账本目录当前不存在——不存在带 `scope` 字段的存量 `batch.json` 需要处理。
5. **影响面隔离良好（已核实）**：scope 相关 API 在测试中只被 `commit-scope-20260911-004.test.mjs` 引用；`commit-batch-20260910-013.test.mjs`、`commit-serve-20260910-014.test.mjs`、`commit-ui-20260910-014.test.mjs`、`global-commit-20260911-006.test.mjs`（BUG-20260911-006）均无目录范围断言（其中出现的 "scoped" 指显式 `ids` 条目集，与提交目录范围无关）。

### 目标细化（完善阶段口径）

1. **回退范围**：上述第 3 点列出的 004 实施改动全部移除——含存储（task-settings）、提示词 / 摘要 / 核验（commit-store）、服务端透传（server）、设置页分区（app.js + style.css）与 004 测试文件；提示词中所有提及「提交目录范围」的语句（含「done 回执核验会拒绝范围外文件」句）一并清理，与新核验口径保持一致。
2. **回退后行为（恢复 004 前口径）**：
   - 批量 commit 回到「无目录级约束」：任何目录的工作区改动只要能归因到候选单即可提交；「不属于任何候选单的改动保持原样，不得混入」的既有约束不变。
   - `atb commit next` 领取输出的提交规范摘要（spec）恢复为静态口径，不含「提交目录范围」句。
   - done 回执核验恢复不含范围判定，保留消息格式 / 单号 / 描述长度 / 测试业务分离 / 条目文档归类五项既有核验。
   - 新创建批次的 `batch.json` 不再写入 `scope` 字段。
   - 设置页恢复仅「批量任务」分区（完善流转开关 + 保存按钮 + 就近状态，`taskSettingsHtml` 现行形态）；其加载中骨架 / 加载失败 + 重试交互（同一数据源）不变。
3. **API 口径**：`GET /api/tasks/settings` 返回不再含 `commit` 分区；`POST /api/tasks/settings` 对 `body.commit` 按 `agents` / `models` 既有先例处理——键保留但忽略、不落盘不报错（兼容已保存过该设置的存量客户端）。
4. **存量数据兼容**：若 `tasks/settings.json` 在回退落地前残留 `commit` 分区（过渡期保存过），回退后读取侧按未知字段忽略、保存侧不再写回——无需数据迁移，不报错。
5. **不误伤清单（保持不动）**：
   - REQ-20260911-003 的隐藏口径：`atb commit` 全部子命令、`/api/commit/*` 路由、账本与面板源码保留。
   - BUG-20260910-014（提交状态徽标）、BUG-20260911-005（「▶ 开始 Commit」快捷入口）、BUG-20260911-006（全局任务聚合 commit 档）功能不变。
   - REQ-20260910-013 / 014 的批量 commit 核心流程（批次创建 / 排队 / 领取 / 回执 / 幂等）、REQ-20260910-027（developer 移除）不变。
   - `tasks/settings.json` 的 `agents` / `models` / `refine` 分区读写不变。

### 待确认

1. **回退粒度**：本 README 按「整体撤销 004 全部实施（存储 / 提示词 / 摘要 / 核验 / 服务端 / UI / 测试）」理解；若人工实际意图是部分回退（如保留 done 核验兜底、仅撤设置入口），需在此澄清后调整口径。**待确认**。
2. **REQ-20260911-004 条目自身的状态流转**（现 in-progress 待人工确认）：随本单回退后 004 应标为何种终态（如驳回 / 撤销口径）由人工在看板操作，本单不代做（条目 status.json 不由开发代理修改）。待确认（不阻塞开发）。
3. **是否补防再引入断言**：回退后是否在既有批量 commit 测试中追加最小断言（如新建批次 `batch.json` 无 `scope` 字段、提示词不含「提交目录范围」字样），由 design 定。

## 验收标准

- [ ] 代码回退完整：004 引入的改动从 `scripts/lib/task-settings.mjs`、`scripts/lib/commit-store.mjs`、`scripts/server.mjs`、`scripts/web/app.js`、`scripts/web/style.css` 全部移除；`scripts/` 下检索 `REQ-20260911-004`、`commitScope` / `CommitScope` / `COMMIT_SCOPE`、`commit-settings`、`csSave` / `csReset` / `csEmptyWarn`、`data-cdir`、`__root__` 无残留引用（条目文档 docs/ 除外）。
- [ ] 提示词与批次恢复：`buildCommitPrompt` 输出不含任何「提交目录范围」相关语句与「范围外文件」核验提示；`createCommitBatch` 产出的 `batch.json` 无 `scope` 字段。
- [ ] 领取摘要恢复：`atb commit next` 领取输出 `spec` 为静态口径，不含「提交目录范围」句；与提示词口径一致。
- [ ] 核验恢复：`validateItemCommits` 不再因文件目录拒绝（恢复无目录约束口径）；消息格式 / 单号 / 描述长度 / 测试业务分离 / 条目文档归类五项既有核验全部保留。
- [ ] 设置页恢复：设置页仅呈现「批量任务」分区——无「批量 Commit」分区、无目录复选框两组 / 恢复默认按钮 / 空范围警示 / 未配置空态条；「批量任务」分区的完善流转开关回显、保存（保存中禁用 → 成功状态行 + toast / 失败就近显示草稿保留）、加载中骨架与加载失败 + 重试交互不回归。
- [ ] API 恢复：`GET /api/tasks/settings` 返回不含 `commit` 分区；`POST /api/tasks/settings` 携带 `commit` 键时按 `agents` / `models` 先例忽略（不落盘、不报错）；`agents` / `models` / `refine` 分区读写不回归。
- [ ] 数据兼容：当前 `docs/agent-team-board/tasks/settings.json`（无 `commit` 分区）回退后读写正常；构造含残留 `commit` 分区的存储文件，读取侧忽略、保存后不再写回该分区、无报错。
- [ ] 测试处理：删除 `scripts/tests/commit-scope-20260911-004.test.mjs`；`npm test`（`node scripts/tests/run-all.mjs`）全绿，重点 `commit-batch-20260910-013` / `commit-serve-20260910-014` / `commit-ui-20260910-014` / `global-commit-20260911-006`（BUG-20260911-006）不回归；若 design 裁定补防再引入断言（待确认 3），随本单登记测试文件。
- [ ] 不误伤：REQ-20260911-003 隐藏口径保持（`atb commit` 全部子命令可用、`/api/commit/*` 路由保留）；提交徽标、快捷入口、全局聚合（BUG-20260910-014 / BUG-20260911-005 / BUG-20260911-006）行为不变。

## 界面展示

本单界面改动为**移除** 004 引入的设置页「批量 Commit」分区，设置模块恢复仅「批量任务」分区（`taskSettingsHtml` 现行形态）。演示以「回退前（现状）↔ 回退后（目标）」对照呈现。

- **布局**：
  - 回退前（现状）：设置页依次为「批量任务」分区（标题 + 一句通用说明 +「完善完成后自动转入计划」开关 +「保存批量任务设置」按钮与就近状态行）和「批量 Commit」分区（标题 + 说明 +「源代码相关目录（默认勾选）」/「其他目录」两组目录复选框清单，逐项带类型标注 + 空范围警示条 +「恢复默认」「保存批量 Commit 设置」按钮与就近状态行，未保存过时另有「未配置 · 默认生效」提示条）。
  - 回退后（目标）：设置页仅剩「批量任务」分区，内容与交互同现状——页面长度收敛，无任何提交目录范围相关控件与文案。
- **交互行为**：
  - 移除的交互（回退后不存在）：目录勾选 / 取消（含「有未保存的更改」提示）、「恢复默认」一键回默认清单、范围全空警示与保存禁用、「保存批量 Commit 设置」三态（保存中禁用 → 成功状态行 + toast「仅对后续新创建的批量 Commit 任务生效」/ 失败就近显示草稿保留）。
  - 保留的交互（不回归）：「完善完成后自动转入计划」开关勾选 / 取消与回显；「保存批量任务设置」三态（保存中按钮禁用 → 成功状态行 + toast / 失败就近显示、草稿保留可重试）；加载失败时「重试」按钮。
- **状态反馈**：
  - 正常态：已加载设置回显（开关与保存值一致；回退后无「未配置 · 默认生效」空态条——该状态随分区移除）。
  - 加载态：「正在加载任务设置…」骨架（编辑与保存不可用）——两分区共用同一数据源，回退后仍由「批量任务」分区承载。
  - 失败态：设置加载失败错误条 + 重试按钮；重试成功回到正常态。
  - 保存态：保存中按钮禁用、成功 / 失败就近状态反馈（回退后仅「批量任务」保存一入口）。

可交互演示：[./ui-demo.html](./ui-demo.html)（单文件、内联 CSS/JS、无外网依赖、无构建步骤，浏览器直接打开；内置「回退前 / 回退后」对照切换、正常 / 加载中 / 加载失败状态切换、批量任务保存三态与模拟失败开关、目录勾选与恢复默认（仅回退前侧）交互、深浅色主题切换；全部数据为模拟，不访问真实服务、不执行任何 Git 操作）。

### 演示核对路径

1. 默认「回退前（现状）」：设置页可见「批量任务」与「批量 Commit」两分区；批量 Commit 分区含两组目录复选框（源代码目录默认勾选、含根文件开关；`docs/` 勾选、`output/` 与插件元数据目录不勾选）、「恢复默认」与「保存批量 Commit 设置」按钮。
2. 勾选 / 取消任一目录 → 状态行变「有未保存的更改」；全部取消 → 空范围警示出现、保存禁用；「恢复默认」回到默认勾选。点「保存批量 Commit 设置」→ 保存中 → 成功状态行 + toast（开「模拟保存失败」后为失败就近显示、草稿保留）。
3. 切到「回退后（目标）」：「批量 Commit」分区整体消失，设置页仅剩「批量任务」分区；「完善完成后自动转入计划」开关与「保存批量任务设置」交互仍可用（勾选切换、保存三态、模拟失败开关同理）。
4. 切换「加载中」：出现「正在加载任务设置…」骨架、编辑与保存不可用；切换「加载失败」：错误条 + 重试按钮，点重试回到正常；回退前 / 回退后两种形态下该两态均只由「批量任务」分区区域承载。
5. 深浅色切换：演示页主题随切换整体适配，验证回退后设置页在两主题下均正常（可选项，仅演示用途）。
