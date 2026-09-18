# 设计 — REQ-20260908-011 修改单需支持修改标题和描述。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现状与相关既有需求（源码均为真实路径）：

- **改标题已有能力（REQ-20260907-011）**：`core.renameItem`（`scripts/lib/core.mjs`，syncDocTitles 旁）校验仅 submitted、标题非空且不超过 120 字、与原标题不同；`syncDocTitles` 同步全部文档首行；history 追加「标题修改：…」。入口：CLI `atb rename <ID> <新标题>`（`scripts/atb.mjs`）与网页 `POST /api/item/:id/title`（`scripts/server.mjs`）；前端 `renameItem()`（`scripts/web/app.js`）用 `uiPrompt` 弹单行输入框。
- **描述没有直接编辑入口**：描述不在 `status.json` 里，唯一真源是条目文档——需求登记描述写 README.md「## 描述」节（`core.mjs` reqReadme），Bug 登记描述写 README.md「## 现象」节（`core.mjs` bugReadme）。现状只能靠「修改」按钮（REQ-20260906-011）复制提示词交 Agent 会话间接修订，或手工改 markdown。
- **按钮近义易混**：待接受卡片上有「✎ 改标题」（直接改）与「修改」（复制提示词）两个按钮，语义不清——即本需求「一并优化界面按钮文案」的由来。

## 方案

（标〔待确认〕处为实施前需人拍板的决策点，其余为建议方案）

### core 层（scripts/lib/core.mjs）

- 新增 `editItem(dataDir, id, { title, description, by })`，保留 `renameItem` 兼容不动：
  - 状态校验沿用 rename 口径：仅 submitted。是否放宽到 accepted〔待确认〕，默认不放宽（accepted 已有「修改提示词」路径，且驳回回 submitted 的成本很低）。
  - 标题：沿用非空 / ≤120 字校验；标题未传或与原标题相同、但描述有变化时跳过标题分支照常保存；两者均无变化时报「无变化」错误。
  - 描述写回 README.md：按类型定位二级标题——需求「## 描述」、Bug「## 现象」（Bug 是否改用独立「描述」节〔待确认〕，默认按创建时口径写「现象」节）。实现参照 `syncDocTitles`：精确匹配标题行，替换该节至下一个 `## ` 之前的内容；找不到该节时整体报错不落盘（宁可失败不可写错位置）。Bug 是否需要同步「## 复现步骤」等其他节：不需要，仅描述口径一节。
  - 描述清空语义〔待确认〕：默认清空后写回「（待补充）」占位，与创建模板一致。
  - history：一次保存一条留痕，note 区分「标题修改：…」「描述修改」「标题 + 描述修改」。
- `status.json` 不新增字段，描述唯一真源仍为 README 文档。

### server 层（scripts/server.mjs)

- 新增 `POST /api/item/:id/content`（body `{ title?, description? }`）转调 `core.editItem`，返回更新后 status；既有 `/api/item/:id/title` 端点保留或迁移〔待确认〕，默认保留兼容旧调用方。

### CLI（scripts/atb.mjs）

- `atb rename <ID> <新标题>` 保持不变。是否新增描述参数：候选 `atb rename <ID> <新标题> --desc <文本>`（多行用 `--desc -` 走 stdin）或新增 `atb edit <ID>` 子命令〔待确认〕，默认推荐前者（改动最小）。

### 前端（scripts/web/app.js）

- **弹窗**：`uiPrompt` 是单行 input 且 Enter 即提交，不适配多行描述。新增双字段表单弹窗（标题 input + 描述 textarea），结构与「统一新建」弹窗（`#fTitle` / `#fDesc`、openModal / submitNew）同范式：Enter 在标题框提交、在文本域换行；Esc / 遮罩取消不发请求；提交按钮 disabled + 「保存中…」防重复。
- **预填当前值**：标题来自条目数据；描述通过既有 `GET /api/item/:id/doc/README.md` 拉全文后截取对应节（该接口已有使用先例：`fetchItemEditPrompt`）。
- **入口与文案**：卡片头部（`card-rename-btn`）与详情抽屉（`data-rename-id`）原「✎ 改标题」改为统一编辑入口，文案候选「✎ 改标题/描述」「✎ 编辑」〔待确认〕；「修改」按钮同步更名「修改提示词」之类消歧〔待确认〕；aria-label / title 提示一并更新。
- **保存与刷新**：成功 toast + `poll()` 刷新列表 + `refreshDrawer()`；失败 toast 报错并保留弹窗输入可重试（对齐 `renameItem` 现有错误处理范式）。

### 影响面

- 改动集中在 `scripts/lib/core.mjs`、`scripts/server.mjs`、`scripts/atb.mjs`、`scripts/web/app.js`；不动状态机、不动 `status.json` 结构。
- 兼容性：`atb rename` 旧用法、REQ-20260906-011 修改提示词、REQ-20260908-003 删除、REQ-20260907-011 既有改标题 / 驳回行为均不受影响。
- 测试：新增用例进 test-cases.md，风格对齐 `scripts/tests/rename-reject.test.mjs`（core 集成 + 真实服务 HTTP + UI 静态断言三层）。

## 风险与边界

- **整节覆写风险**：待接受条目的描述节可能已被「需求完善」批次（refine）或人工改写成结构化内容，编辑弹窗预填整节原文、保存整节替换会覆盖手工排版。默认接受整节替换并在弹窗中提示「将整体替换该章节」；是否提供 diff 预览〔待确认〕。
- **章节定位脆弱**：依赖固定二级标题「## 描述」/「## 现象」。文档缺节、或标题行被改写时必须明确报错，不做模糊匹配兜底。
- **不扩大状态边界**：仅 submitted 可改；进入开发后的修订仍走 Bug / 驳回 / 修改提示词，本需求不动状态机。
- **文案属体验决策**：按钮最终文案需人确认后实施，避免反复返工。
- **讨论单（oncall / ASK）不在默认范围**：其字段口径为「问题正文」而非「描述」，且当前无任何编辑能力；如需支持应另立需求。

## 实施记录（2026-09-08，zcode-batch-018-1）

待确认项均按上文默认方案落地，人工如需调整属文案/参数级改动：

- 状态口径：仅 submitted 可编辑（不放宽到 accepted）。
- Bug 描述节：按创建口径写 README「## 现象」节；描述清空写回「（待补充）」占位。
- 服务端：新增 `POST /api/item/:id/content`，旧 `/title` 端点保留兼容。
- CLI：`atb rename <ID> <新标题> [--desc <文本|->]`（`--desc -` 读 stdin 多行；带 `--desc` 时标题可省略仅改描述）；不带 `--desc` 的旧用法仍走 `core.renameItem`，行为不变。
- 按钮文案（U4 待确认项，按 README 线框主候选采用）：编辑入口「✎ 改标题/描述」（卡片与详情抽屉，aria-label/title 同步「编辑 … 标题与描述」）；「修改」按钮更名「修改提示词」（aria-label「复制 … 修改提示词」）。

代码落点：

- `scripts/lib/core.mjs`：新增 `editItem(dataDir, id, { title, description, by })` 与 `readDescriptionSection`；`writeDescriptionSection` 私有。先全量校验（submitted / 标题非空 ≤120 / 描述节存在）再统一落盘，任一失败整单拒绝（原子性）；history 一条留痕，note 区分「标题修改 / 描述修改 / 标题 + 描述修改」。`renameItem` 原样保留。
- `scripts/server.mjs`：`POST /api/item/:id/content`（body `{ title?, description? }`，缺省字段视为未传）转调 `core.editItem`。
- `scripts/atb.mjs`：rename 子命令支持 `--desc`（含 stdin），usage 同步。
- `scripts/web/app.js`：`uiPrompt` 升级为 `uiEditForm` 双字段弹窗（标题 input Enter 提交 + 描述 textarea 换行；Esc / 遮罩取消不发请求；保存中按钮禁用 +「保存中…」；onSubmit 异常 toast 后弹窗保留可重试）；新增 `editItem(id)`（GET README 全文 → `extractDocSection` 预填 → POST /content → 成功 toast + `poll()` + `refreshDrawer()`）；无变化前端先拦截提示不发写请求；卡片 / 详情抽屉按钮文案更新。
- 测试：新增 `scripts/tests/edit-content.test.mjs`（19 用例：core C1–C9 + HTTP C10 + CLI 子进程 C11 + UI 静态/沙箱 U1–U5）；同步更新 `rename-reject.test.mjs`（被替换的前端契约断言）与 `edit-prompt.test.mjs`（按钮文案）。`npm test` 全量 89 文件 0 失败。

