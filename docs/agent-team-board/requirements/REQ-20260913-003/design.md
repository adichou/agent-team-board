# 设计 — REQ-20260913-003 批量任务去掉批次概念，每次启动到结束就实时执行当前的任务

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现役实现以「批次」为核心：启动 = 创建批次并冻结候选快照（`batch.createBatch` /
`refine.createRefineBatch`），支持批次排队（FIFO、自动接续）、排队新批次、删除排队批次；
主调度提示词绑定批次号（`--batch <batchId>` 核对入口、「批次调度员」措辞）；面板/全局视图/
条目详情透出批次号与「已入批次」。条目 README 已定验收口径：本轮执行期间每次领取实时读取
已计划队列，UI 与提示词不透出批次概念。

## 方案

**内部账本保留「批次记录」作为本轮执行的分组键，语义改名为「本轮执行」；候选不再冻结，
改为实时队列。**（README 范围外条款：CLI 命令命名与内部账本分组键由 design 阶段决定，验收只
约束 UI 与提示词——故不改 `batch-*` / `refine-*` CLI 命令名与账本目录结构，存量账本只读兼容、
不迁移。）

### 核心层（scripts/lib/batch.mjs、refine-store.mjs）

- `createBatch` / `createRefineBatch`：
  - 不再冻结候选快照——开发轮 `candidates: []`（显式 `ids`（终态单条目重建）仍作为队首种子），
    完善轮 `candidates: []`；基线指纹沿用「领取时冻结」口径（BUG-20260908-011）。
  - 不再排队：创建前盘点未结束账本，空转账本就地收尾；仍有未结束账本（待启动/执行中/暂停/
    待核对）→ 抛「已有进行中的任务：同一时间只有一轮执行，无需重复启动……」，不产生排队对象。
  - 返回值不再带 `queued` / `queuePosition`。
- 实时队列：新增 `effectiveCandidates(dataDir, batch)` = 账本已登记候选 ∪ 当前实时候选
  （排除其他未结束账本已登记条目，兼容存量排队数据）。`nextItem` / `checkBatch` /
  `batchSummary` / `checkRefineBatch` / `refineSummary` 照旧实时吸收落盘；`batchBrief` /
  `refineBatchBrief`（全局视图，只读）用 `effectiveCandidates` 计数不写账本。运行中新移入计划
  /新接受的条目立即出现在待处理队列并可被领取，无需任何「并入」操作。
- `checkBatch`：移除 nextBatch 排队接续；通知文案去「批次」（如「本轮队列已处理完毕」）。
- `generatePrompt` / `buildRefinePrompt`：全文重写——不含「批次」「batchId」「--batch」与
  接续说明；核对入口改为 `atb batch check --dir <root>` / `atb refine check --dir <root>`
  （不依赖批次标识，CLI 侧 `--batch` 本就缺省解析队首）；加入实时取单指令（每完成一项立即
  核对并从已计划队列最旧优先领取下一项，队列取空即本轮结束）。
- 暂停/终止/回执/互斥/重试语义不变。

### 展示归一层（scripts/lib/task-settings.mjs）

`normalizePromptForDisplay` 增加存量账本冻结提示词的批次行归一（展示层，账本不回写）：
「批次：…」「完善批次：…」行删除；「批次摘要入口 … --batch …」→「调度核对入口 …（无 --batch）」；
批次排队接续三行删除；「批次调度员」→「批量开发调度员」；「本批」→「本轮」；
`--by refine-<批次尾号>-<序号>` → `--by refine-<序号>`；AUTO_PLAN 约束段「本批已开启」→「本轮已开启」。
对新版生成输出幂等。

### 服务端（scripts/server.mjs）

- `/api/batch/create`、`/api/refine/create`：响应不再含 `batchId` / `queued` / `queuePosition`；
  重复启动走 400 + 明确提示。
- `/api/batch/current`：批次载荷不再含 `batchId`；`queue`（排队批次列表）字段移除。
- `/api/batch/prompt`、`/api/refine/current`（`refineBatchPublicView`）、records：响应不再含
  `batchId`（refine public view 同步去 batchId）。
- `/api/batch/global` 简报（`batchBrief` / `refineBatchBrief`）：不再透出 `batchId`；
  `queued` 标记移除。
- `/api/board` 与条目详情：不再附加 `batchEntry`（「已入批次」数据源随之下线）。
- pause/abort/delete 的缺省解析（队首）保留；前端不再传 batchId。

### 前端（scripts/web/app.js、index.html、i18n.js）

- 概况：批次号 chip、「排队中」状态移除；状态词表去掉 queued 分支。
- 队列分区：仅实时待处理队列；排队批次节、「排队新批次」「删除本批次 / 删除该排队批次」按钮
  及 `deleteBatchById` 移除。
- 提示词/记录/暂停/终止/重新执行/启动新一轮保持；确认弹窗与 toast 文案去批次号。
- 全局视图：任务行不再显示批次号；汇总条去掉「排队中」计数；搜索占位改「搜项目 / 条目编号…」。
- 条目详情：移除「已入批次」notice（planned 条目恒为移入计划指引）。
- i18n.js 同步清理批次相关词条与 toast 模板。

## 风险与边界

- 存量多批次排队数据升级后：面板/全局视图仍按队首账本解析展示（queueHead 解析保留），排队
  批次不再透出；其账本不动，可经 CLI 收尾。README 标注该展示口径「待确认」，本设计选择
  「只读保留、不再透出批次号」。
- `ids` 显式范围（终态单条目重建）作为队首种子保留；实时吸收会把其余已计划条目并入本轮——
  与「启动后连续执行到队列取空」口径一致。
- 开源选型：无合适开源库（界面与账本均为项目既有自研体系的小步改造，引入外部依赖成本高于自研），
  不引入第三方库，无 licenses.md。
