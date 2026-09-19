# BUG-20260918-003 确认留痕 confirmations.md 属应用数据，应迁至 runtime 不进 git

- 状态：accepted（已接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-18T07:47:34.641Z

## 现象

现状：挂起确认机制（引入来源 REQ-20260914-001）在条目目录维护 confirmations.md 人读留痕，随 data/ 进 git（登记时已被追踪 5 个条目；2026-09-19 以 `git ls-files` 核实为 6 个：BUG-20260914-016、BUG-20260914-020、BUG-20260916-003、BUG-20260917-001、REQ-20260916-005、REQ-20260916-007，随闭环持续增加）。问题：①单一决策者场景下事件级过程留痕进版本库价值有限，最终结果即可；②该文件每次面板核验/确认/补交都会追加变更，形成「候选路径永远差一个未入库」的自指循环，确认闭环被迫多一步留痕后刷新基线再补交的收口。期望：confirmations.md 迁至 runtime/（与事实源 runtime/confirms/confirms.json 同域），git 不再追踪；已入库历史文件出库迁移；条目目录不再产生高频变更文件。决策依据：用户拍板——所有确认均为同一用户决策，只需最终结果。

源码核实（现状实现，修复涉及处）：

- 留痕写入：`scripts/lib/confirm-states.mjs` 的 `renderConfirmDoc()`（约 L310–332）把 `<条目目录>/confirmations.md` 整体重渲染；`scripts/lib/confirm-store.mjs` 中声明（`declareCommitConfirm` / `declareAnalysisConfirm`）、核验（`verifyCommitConfirm`）、保持挂起（`keepConfirm`）、作答（`answerAnalysisConfirm`）、确认（`confirmCommitContinue` / `confirmAnalysisContinue`）、收尾（`closeAnalysisConfirm`）与任务中断留痕（`noteConfirmTaskInterrupted`）每个事件后都会重写该文件。
- 自指循环证据：`declareCommitConfirm`（`confirm-store.mjs` 约 L96–97）注释明确「声明自身会写 .gitignore 与 confirmations.md，先取基线会让首次确认必被误判『内容已变』；候选集也以留痕后的现场为准（confirmations.md 纳入基线）」；`verifyCommitConfirm`（约 L320–326）核验写完留痕后必须再刷新一次指纹基线，否则「verify 事件写 confirmations.md，先刷新会被自身留痕污染成『内容已变』」。
- 入库收口：`scripts/lib/mgt-commit.mjs` 的 `itemMgtFiles()`（约 L64–67）把 confirmations.md / decisions.md 列为「确认完成」后自动提交的管理记录；`scripts/server.mjs`（约 L3529–3530）确认完成成功后触发；条目详情有「管理记录提交」反馈块与「重试提交」按钮（`scripts/web/app.js` 约 L2746–2817）。
- 同口径文件：hold 机制的 `decisions.md` 同样写在条目目录（`scripts/lib/hold-states.mjs` 约 L107–166），当前 git 尚未追踪到该文件（`git ls-files` 未列出）。
- 事实源本就在 runtime：`runtime/confirms/confirms.json` 与 `runtime/confirms/tasks.json`（`confirm-states.mjs` 的 `confirmsFile()` / `confirmTasksFile()`），`runtime/confirms/` 由 `ensureLedger()` 写入 `runtime/.gitignore` 忽略，不进 git。
- UI 呈现：任务页「待人工确认」卡片区与侧拉确认面板（`scripts/web/app.js` `renderConfirmArea` / 确认侧拉面板）；条目详情抽屉因 `core.mjs` `orderedDocs()`（约 L1220–1227）按目录扫描全部 .md，confirmations.md 目前会作为条目文档页签出现并进入全局搜索（`server.mjs` `searchDocs`）；CLI `atb confirm list` 输出提示人工确认视图之一为「条目目录 confirmations.md」（`scripts/atb.mjs` 约 L1091）。

## 复现步骤

前提：项目为 git 仓库且已初始化 agent-team-board 布局（data/ 进 git、runtime/ 被忽略）。

1. 制造一次自动提交不完整（如实现含归属不明路径、或提交失败），开发批次收尾触发挂起：系统调用 `declareCommitConfirm` 声明「待人工确认提交」，并在条目目录 `agent-team-board/data/bugs/<ID>/`（或 requirements/）生成 `confirmations.md`——该文件位于 data/，自动落入 git 追踪范围。
2. 打开 Status Board 任务页「待人工确认」区，对挂起卡片点「重新核验」：核验追加 `verified` 事件并整体重写 confirmations.md（内容变化 = 工作区出现新的未提交变更）。
3. 在确认面板逐项选择归属后点「确认并继续」：系统补交业务文件并重写 confirmations.md（`confirmed` 事件 + 补交记录），文件再次变脏——即「候选路径永远差一个未入库」的自指循环：每次人工操作自身都会让留痕文件产生新的未入库变更。
4. 人工对该条目「确认完成」：确认完成入口自动提交本次刷新的 confirmations.md（`mgt-commit.itemMgtFiles`），产生一笔 `doc: 人工确认完成 <ID>` 提交；若该提交失败（如 Git 身份 / 锁冲突），条目详情出现「⚠ 操作已成功，管理记录提交失败」反馈块与「重试提交」按钮——确认闭环被迫多一步留痕入库收口。
5. 核验仓库现状：`git ls-files | grep confirmations.md` 列出 6 个条目文件；`git log --oneline -- "*confirmations.md"` 可见多轮 doc 提交（同一条目反复出现）。

## 期望行为

1. 留痕迁至 runtime/：confirm 机制不再向条目目录写 confirmations.md，改为写入 runtime/ 域（与事实源 `runtime/confirms/confirms.json` 同域；runtime 内具体路径方案属开发设计，待确认）。decisions.md（hold 决策留痕，同口径实现）一并出库至 runtime（design.md 完成判定口径：迁移只需把 confirmations.md / decisions.md 出库至 runtime）。
2. git 不再追踪：条目目录不再产生这类高频变更文件；确认完成后的管理记录自动提交不再包含 confirmations.md / decisions.md（相关 mgt 提交、失败反馈与「重试提交」入口随之下线或不再由这两个文件触发——具体下线方式待确认）。
3. 已入库历史文件出库迁移：现存 6 个条目的 confirmations.md 移出 git 追踪；迁移方式与历史提交是否保留待确认（不得重写历史的口径下默认保留历史，方式待确认），且不得引入新的进 git 的终态标记文件（design.md 用户拍板）。
4. 行为零回归：事实源仍是 `runtime/confirms/confirms.json`，挂起声明 / 核验 / 保持 / 作答 / 确认 / 恢复的状态机与面板操作流不变；「确认完成」的人工验收语义不变；完成判定口径不变（git 历史中存在带该条目单号的提交即视为已完成）。

## 验收说明

- [ ] 声明 / 核验 / 保持 / 作答 / 确认 / 收尾各操作后，条目目录（`agent-team-board/data/**`）不再出现或更新 confirmations.md / decisions.md；对应留痕内容完整可在 runtime/ 域找到（轮次、事件、问题表等信息不丢失）。
- [ ] 走完一轮完整挂起确认流程（声明→核验→确认并继续）后 `git status` 中不出现 confirmations.md 相关变更；`git ls-files` 不再列出任何 confirmations.md / decisions.md。
- [ ] 历史已入库的 6 个条目 confirmations.md 完成出库迁移，出库迁移产生的提交带本 Bug 单号；迁移不引入新的进 git 文件。
- [ ] 确认完成后不再产生 confirmations.md / decisions.md 的管理记录自动提交与「重试提交」提示；既有管理记录提交机制对其他目标（如存在）行为不变。
- [ ] Status Board「待人工确认」卡片与侧拉面板操作流正常；条目详情抽屉文档页签不再出现 confirmations.md / decisions.md；全局搜索不再命中这两个文件。
- [ ] CLI `atb confirm list / detail` 呈现正常，输出提示不再指向条目目录 confirmations.md（指向迁移后的 runtime 留痕位置或移除该提示，随开发方案待确认）。
- [ ] `npm test` 全量通过（`confirm-block-20260914-001`、`mgt-auto-commit-20260914-007` 等相关测试按新口径调整后通过）。

## 界面展示

本 Bug 现象与修复均涉及看板界面：交互演示见 [./ui-demo.html](./ui-demo.html)（单文件、浏览器直接打开可交互）。

- 界面布局：
  - 任务页顶部「⚠ 待人工确认（N）——阻塞队列，确认后才继续」卡片区 + 队列暂停横幅；卡片含挂起条目、原因、候选路径计数与「重新核验 / 查看详情（确认面板）」操作。
  - 条目详情抽屉的文档页签组（README / design / test-cases / …）——现状下 confirmations.md 会作为条目文档页签出现；修复后不再出现。
  - 条目详情的「管理记录提交」反馈块（提交中 / 已提交 / 已同步 / 失败 + 重试提交）。
- 交互行为：演示对照「当前（缺陷）」与「修复后」两种模式——重新核验（异步任务：核验→测试两阶段进度）→ 确认面板归属选择 → 确认并继续（补交）→ 确认完成；当前模式下每步操作都会重写条目目录 confirmations.md 并使其成为 git 未提交变更，确认完成后还需一笔管理记录 doc 提交（可模拟失败后的重试）；修复模式下留痕写入 runtime/，git 全程无感知，无管理记录补交。
- 状态反馈：正常流（核验通过 / 确认成功恢复队列）、加载态（核验任务运行中进度条、管理记录提交中）、失败态（核验未通过原因列表、管理记录提交失败 + 重试入口）、空态（无挂起确认时待确认区隐藏、队列无暂停横幅）。深浅色随系统偏好适配。
