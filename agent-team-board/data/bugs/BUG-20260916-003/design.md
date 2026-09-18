# 设计 — BUG-20260916-003 条目人工确认完成后未取消其受阻回执，批次计数永久残留受阻

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260906-002（Zcode 批量实施：轻量主调度、每单新子 Agent 与文件化回执）
  （经 `atb list` 核验存在，状态 done）。该单建立了批次 run 账本与 blocked 终态口径：
  `finishRun` 把 blocked 落为永久终态，`batchState` 纯按账本计数，未定义「条目此后经
  其他途径完成」时受阻回执的消解路径，计数与条目业务状态从此脱钩。

## 根因分析

三段脱节（代码定位见 README，均经现仓库核验）：

1. **计数层只认账本**：`scripts/lib/batch.mjs` `batchState` 的 `finalByItem` 对每条目取
   最新终态 run 计入 `counts.blocked` 等，与条目当前业务状态无关；
2. **blocked 无消解通路**：blocked 是永久终态——手工通道上报只产生 `manual-<ID>` 记录
   （batchId=null，不挂批次）、其他轮次上报挂别的批次账本、`atb status done` 只闭环 hold
   记录，三者都不改写原批次内该条目的最新终态；
3. **无人工取消入口**：CLI `atb run` 仅有 receipt / release / autocommit；「重新执行」
   要求条目回到 planned 且未认领，done 条目不可达。

结果：条目已 done，其历史 blocked run 仍永久计入 checkBatch / batchSummary / batchBrief
与看板任务面板「受阻待处理」「异常」，批次 status 长期停在 running。

## 方案

**选型**：不引入开源库（账本为本仓库自有 JSON 文件格式，取消标记是单一字段的增量演进，
无现成库可复用；引入成本高于自研）。

**定稿：自动双机制（写时留痕 + 读时口径兜底），不新增人工取消命令。**
README 期望行为的两个候选（自动闭环 / 人工命令）取自动路径，理由：触发点唯一且明确
（人工确认完成 in-progress → done），人工命令会新增管理面与误用面（取消未完成条目的
受阻回执会让真实受阻假性消失），收益低。

### 1. 写时留痕：`setStatus` done 时自动关闭该条目的 blocked 批次 run

- `scripts/lib/batch.mjs` 新增 `cancelBlockedRunsWithItemDone(dataDir, itemId, { by })`：
  扫描 `runtime/dispatch/runs/`，凡 `itemId` 匹配、`batchId` 非空（批次账本；排除
  `manual-<ID>` 与 codex-exec 记录）、`phase === 'blocked'` 且尚未标记的 run，写
  `run.cancelled = { at, kind: 'item-done', by, note: '随条目完成关闭' }` 落盘
  （`phase` 保持 `'blocked'` 不改写——回执历史原样保留，只叠加取消留痕）。
- `scripts/lib/core.mjs` `setStatus` 在 `in-progress → done` 分支调用（认领锁释放同位）。
  core ↔ batch 构成 ESM 循环导入，与既有 core ↔ git-flow 同款「调用期依赖」注释声明，
  双方顶层均不取值，安全。调用包 try/catch：留痕失败不阻断人工确认完成（读时口径仍兜底）。

### 2. 读时口径兜底：计数不再计入「已取消或条目已 done」的 blocked run

`batchState` 计数循环跳过满足任一条件的 blocked 终态 run：

- `run.cancelled` 已标记（写时留痕，含 done 后被驳回重开也保持已取消——曾随完成关闭
  是既成事实，不随状态回退复活）；
- 条目当前业务状态为 `done`（存量兜底：修复前已 done 的历史 run 没有机会补标记，
  本仓库 batch-20260913-048 / run-20260916-266 即此类，读时口径使其自动归零）。

`finalByItem` 的终态占位**保持不变**（只改计数不改占位）：已 done 条目不在候选池
（候选仅收 planned 未认领，done 无回流 planned 的流转边），`remaining` / `nextItem` /
`remainingDisposition` 均不受影响；同条目「先 blocked 后同批次内 reported」仍按最新
终态 reported 计数（既有口径不回归）。

### 3. 记录展示：`listRuns` 透出取消标注

`listRuns` 记录新增 `cancelled` 字段：`{ kind }`，`kind ∈ { 'item-done'（有留痕）,
'item-done-legacy'（条目已 done 的存量未标记 run，就地识别）}`，其余为 null。
服务端 `/api/batch/current` 等载荷直接透传。看板任务面板记录行（`runAttemptsHtml`）
在执行状态列追加「已取消（随条目完成关闭）」/「已取消（条目已完成）」标注，chip 保持
「受阻」形态（不抹除历史）；已取消记录不再显示「重新执行」按钮（对 done 条目必然
报「均不可入队」，是死路）。

计数链路 `checkBatch` / `batchSummary` / `batchBrief` / 服务端 `blockedRuns` /
面板「受阻待处理 N」与异常口径全部由 `batchState` 单点收敛，自动同步。

## 风险与边界

- **不误伤正常受阻**：条目非 done 且无取消标记的 blocked run 照常计数；依赖受阻
  `blockedPending` 口径是独立机制（盘点 planned 候选），不受影响；同条目再次受阻产生的
  新 blocked run 按最新终态正常计数。
- **failed / interrupted / skipped 不在本单范围**：failed 关联 needs_attention /
  人工恢复流程、interrupted/skipped 有各自语义，不随 done 自动取消（README 明示边界）。
- **幂等与并发**：取消标记写入幂等（已有标记跳过）；`saveRun` 走原子写；与
  `finishRun` 的终态幂等回执互不冲突（phase 不变）。
- **存量数据**：读时口径自动生效（batch-20260913-048 受阻计数归零、批次可随
  checkBatch 自然收尾），无需数据迁移；该存量 run 的记录展示走 legacy 标注。
- **中英文同步**：新增两条界面文案入 `scripts/web/i18n.js` EN 词典（BUG-20260912-001），
  i18n 覆盖测试守卡。
