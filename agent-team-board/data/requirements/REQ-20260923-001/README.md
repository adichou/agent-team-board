# REQ-20260923-001 发布看板中的文档编写页面，新增加的文档也要像README.md 一样豁免，允许 Agent 和人自由修改。

- 状态：submitted（待人工接受）
- 创建：2026-09-23T04:36:37.753Z

## 描述

需求原文：支持豁免的文档包括默认的四个文档，以及用户添加的文档。

现状（REQ-20260918-002）只有插件根第一层的 `README.md` 享受「纯文档豁免」：无认领锁时 Agent 可直接编辑（Write/Edit/apply_patch 与 Bash 改写均放行），并可经 Bash 提交仅含该文件、主题符合「类型: 描述 单号」提交规范的改动。本需求把同口径豁免扩展到发布看板「发布流程 → 文档编写」页面所管理的其余发布文档：

1. **默认四类文档**：README / CHANGELOG / FEATURES / AGENTS（`scripts/lib/publish-flow.mjs` 的 `PUBLISH_DOC_KEYS`，均位于插件根第一层）。
2. **用户添加的自定义文档**：文档编写页「＋ 添加文档」入口加入的自定义文档（REQ-20260922-003，版本记录 `v.customDocs`，如 `MIGRATION.md`，同样位于插件根第一层）。

豁免含义与 README.md 现状一致——这些文件是纯文档，Agent 与人均无需认领锁即可自由编辑与提交（人侧本不受守卫限制，本需求主要放开 Agent 通道）。本需求不改文档编写页界面，只改守卫拦截口径（`scripts/state-guard.mjs` 的 file / bash 两种模式）；语言变体、LICENSE、DESIGN 等边界口径见「待确认」。

## 背景（现状）

- **编辑保护**：`scripts/state-guard.mjs` file 模式经 `realpathAncestralHitsPluginRoot` 判定——插件根内除根第一层 `README.md`、`docs/`、`agent-team-board/` 外均视为受保护源码，无有效认领锁时 Write/Edit 拦截；因此根下 `CHANGELOG.md` / `FEATURES.md` / `AGENTS.md` 及自定义文档目前无锁不可编辑。
- **Bash 改写保护**：bash 模式第 ④ 类拦截（sed/tee/重定向等改写源码目标），同样仅根 `README.md` 豁免。
- **提交放行**：bash 模式第 ⑤ 类「流程外 git commit」目前仅两条授权通道——① 条目目录用户数据（REQ-20260917-002）；② 根 `README.md` 纯文档提交（REQ-20260918-002：pathspec 全为插件根第一层 README.md + 主题行经 `lib/commit-store.mjs` `validateCommitSubject` 校验「类型: 描述 单号」合规）。
- **发布文档清单事实源**：`scripts/lib/publish-flow.mjs` `publishDocFiles(langs, customDocs)` = 4 类 × 语言集 + 单文件类 LICENSE + 自定义文档按语言集展开；自定义文档清单持久化于版本记录 `v.customDocs`（`scripts/lib/build-store.mjs` `addCustomDoc` / `removeCustomDoc`，存 `<板根>/runtime/builds/versions/<BLD-*>/version.json`，本地留存不随 git），上限 20 份，命名规则见 `normalizeCustomDocName`。
- **既有回归基线**：`scripts/tests/req-20260918-002.test.mjs` 实测守卫两模式（编辑放行 / 别名与相对路径归一 / 提交通道 / 夹带拦截）；`AGENTS.md`「测试与拦截速查」表与仓库协作规则写有现行 README 豁免口径。

## 需求规则

1. **编辑豁免**：无有效认领锁时，Agent 用 Write/Edit（含 apply_patch 的 Update/Add/Delete File 目标）编辑插件根第一层的四类标准文档与清单内自定义文档，放行；其余源码保护不变。
2. **Bash 改写豁免**：无锁时经 Bash（sed/tee/重定向等）改写上述豁免文档，放行；写目标语义关联口径与现状一致（文档路径仅作为读取来源出现时不构成拦截事由）。
3. **提交豁免**：Agent 经 Bash git commit 提交仅含上述豁免文档的改动放行——pathspec 全为豁免文档、主题行符合「类型: 描述 单号」提交规范（复用 `validateCommitSubject`），与现行 README.md 通道 ② 同口径；pathspec 混入源码 / runtime 数据、无 pathspec、主题不合规、`--amend` 等不可静态核验形态仍拦。
4. **豁免范围随清单联动**：自定义文档的豁免以 `v.customDocs` 清单为事实源，添加 / 移除自定义文档后豁免范围随之变化；不在清单内的文件不因命名相似获得豁免。
5. **精确到单文件**：豁免精确到插件根第一层的文档单文件，目录内同名文件（如 `scripts/CHANGELOG.md`）与其他根下文件不获豁免；软链别名、相对路径、目标不存在时的祖先回溯归一判定与既有 README 口径一致。
6. **不回归**：README.md 既有豁免、条目目录文档讨论轮通道 ①、源码认领锁保护、runtime/status 直写拦截、人工状态接口拦截均不受影响。

## 待确认

1. **语言变体**：四类文档与自定义文档随语言集展开的 `<KEY>_<lang>.md`（如 `README_en.md`、`MIGRATION_en.md`）是否纳入豁免（需求原文「四个文档」「用户添加的文档」未明确语言变体；仓库根存量 `README.en.md` 点号命名是否豁免同此判定）。
2. **LICENSE / DESIGN**：单文件类 `LICENSE.md` 与本仓库版本设计文档 `DESIGN.md`（不在 `PUBLISH_DOC_KEYS` 内）是否纳入豁免范围。
3. **多版本清单取值**：多个版本记录各有 `customDocs` 时，守卫豁免按全部版本并集还是当前活跃版本清单取值（版本记录在 runtime 本地留存，不随 git 走）。
4. **提交主题口径**：提交豁免是否沿用「类型: 描述 单号」强制含条目编号（本 README 按「像 README.md 一样豁免」理解为沿用现行口径，以人工确认或 design.md 落定为准）。

## 界面展示

- 本需求**不涉及界面改动**：改动仅落在 PreToolUse 守卫（`scripts/state-guard.mjs` 的 file / bash 模式拦截口径），文档编写页本身的布局、按钮、状态反馈均不变；用户可感知的变化只有 Agent 编辑 / 提交发布文档不再被拦截。
- 行为对照（非界面，供验证参考）：改动前——无认领锁时 Agent 编辑根 `CHANGELOG.md` / `FEATURES.md` / `AGENTS.md` / 清单内自定义文档被拦（提示「插件源码受保护，请先登记认领」），经 Bash 提交仅含这些文档的改动被拦（「流程外 git commit 已拦截」）；改动后——同样操作放行，pathspec 混入源码 / runtime 数据的提交仍被拦截。

## 验收标准

- [ ] 无有效认领锁时，Agent 用 Write/Edit（含 apply_patch）编辑插件根第一层的 `README.md` / `CHANGELOG.md` / `FEATURES.md` / `AGENTS.md` 与清单内自定义文档（如 `MIGRATION.md`）均放行；编辑受保护源码（如 `scripts/web/app.js`）仍被拦截并给出认领指引。
- [ ] 无有效认领锁时，经 Bash 用 sed/tee/重定向等改写上述豁免文档放行；改写受保护源码仍拦截。
- [ ] Agent 经 Bash git commit 提交仅含豁免文档的改动（pathspec 全为豁免文档、主题行「类型: 描述 单号」合规）放行；pathspec 混入源码或 runtime 数据、无 pathspec 裸提交、主题无单号、`--amend` 等仍拦截。
- [ ] 豁免精确到插件根第一层单文件：目录内同名文件与根下其他文件（如 `index.html`、`package.json`）不因同名或同扩展获得豁免；软链别名 / 相对路径 / 新建文件祖先回溯归一后判定与既有 README 口径一致。
- [ ] 自定义文档豁免随 `v.customDocs` 清单联动：添加后新文件无锁可编辑，移除后不再豁免（按「待确认 3」落定口径执行，落定前不弱化既有拦截）。
- [ ] 语言变体、LICENSE、DESIGN 的豁免口径按「待确认」落定结果执行，落定前不弱化既有拦截。
- [ ] 既有行为不回归：README.md 既有豁免（REQ-20260918-002 全部既有测试继续通过）、条目目录文档讨论轮提交通道（REQ-20260917-002）、源码认领锁保护、runtime/status 直写拦截、curl 人工接口拦截均不受影响。
- [ ] 新增测试 `scripts/tests/req-20260923-001.test.mjs`（TDD 先红后绿）覆盖上述编辑 / Bash 改写 / 提交场景，`npm test` 全量通过。
- [ ] `AGENTS.md` 等协作文档中的「豁免范围」口径说明随实现同步修订（在开发认领锁内完成，提交主题带本单号）。
