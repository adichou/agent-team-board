# 设计 — REQ-20260906-025 批次排队：执行中可继续创建新批次，结束后自动接续下一批

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`createBatch` 对未结束批次幂等（返回旧批 created=false），执行期间无法为后续条目准备下一批；
不带 `--batch` 的 next/check/summary 及 serve/UI 缺省都解析到「最新创建批次」，排队批次会被抢先领取。

## 方案

### 1. 队列模型（batch.mjs）

- 未结束批次（`status !== 'finished'`）按 `createdAt` 升序（次键 batchId 字符串序，与 prune 同口径）
  构成**项目级单队列**；与实施互斥（impl.lock）同粒度，不按 mode 分队列（zcode 批次是唯一入队来源）。
- 兼容既有账本：batch.json 原样即队列成员，无需迁移；「排队中」沿用 prepared 语义，不新增状态。
- 新导出：`unfinishedBatches(dataDir)`（升序）、`queueHeadBatch(dataDir)`（队首，无则 null）。

### 2. createBatch 改造

1. 先计算本次将冻结的候选（含 limit 截断），供幂等比对与入队共用。
2. 遍历全部未结束批次：无在途运行且 `remaining === 0` 的就地收尾为 finished
   （原「仅 latest 收尾」逻辑推广到全队列，防止旧空批卡住幂等判断）。
3. 幂等：剩余未结束批次中**队尾（最新）**冻结候选与本次一致 → 返回该批 `created=false`
   （携带 `queuePosition`；非队首时 `queued=true`）。候选有变化（如新接受条目）则不命中，允许再排队。
4. 否则新建批次正常落盘；返回 `queued`（队列中存在前序未结束批次）与 `queuePosition`（1=队首/立即执行）。

无未结束批次时 `queued=false`、`queuePosition=1`，与现状一致（Z02a 幂等回归由既有用例覆盖）。

### 3. 队首解析（防抢）

- `atb batch next/check/summary/pause/records` 缺省批次、`/api/batch/prompt|current|pause|records`
  缺省批次：`latestBatch` → `queueHeadBatch`，无未结束批次时回退 latestBatch
  （保留「已结束批次面板 / 创建下一批入口」的现有展示语义）。
- `nextItem` 增加队首保护：存在更早的未结束批次时抛错
  「批次 X 排队中：前序批次 Y 尚未结束，不得抢先领取」；impl 互斥仍为第二道防线。

### 4. 自动接续（check + 提示词）

- `checkBatch` 仅在批次**真正收尾**（remaining=0 或全不可派发、批次置 finished）的 stop 分支携带
  `nextBatch: { batchId, total }`（下一排队批次），notice 提示自动接续；
  `pauseRequested` / `needs_attention` 分支不带（人工意图优先）。载荷增量 <100B，仍受 2KiB 约束。
- `generatePrompt` 模板增加一行：本批收尾（stop 且带 nextBatch）时，同一会话直接以该批次标识
  替换本提示词中的批次继续，无需新建会话。冻结进 batch.json 的提示词天然支持接续。

### 5. 看板 UI

- `/api/batch/current` 新增 `queue`：升序未结束批次（含队首），每项
  `{ batchId, mode, status, createdAt, queuePosition, total }`，不含 prompt（控制载荷）。
- 抽屉运行视图渲染排队列表：队首按现有状态标签，其后批次 prepared 显示「排队中（第 N 位）」+
  批次号 + 条目数 + 创建时间；`refreshBatch` 签名计入 queue，随 2 秒轮询刷新。
- 创建响应 `queued=true` 时 toast「已加入队列，排第 N 位，当前批次结束后自动开始」；
  队尾幂等命中（created=false 且 queued=true）时如实提示返回已有排队批次；
  无排队时文案不变。抽屉在批次 A 执行中点创建 → 面板仍显示 A，排队列表出现 B，无需人工刷新。

### 6. 范围界定（不做）

- 「移出队列」管理操作不做；暂停/恢复对排队批次原样可用（pauseRequested 标记保留，
  待其成为队首后生效），不破坏现有暂停/恢复语义。
- 排队批次可查看提示词与清单（batch.json / batch summary --batch 原样可用），不单独做只读视图。

## 风险与边界

- **幂等语义变化**：仅当存在排队批次（未结束批次 >1）时，重复创建才可能新建批次（候选变化时）；
  队尾候选一致仍幂等返回，误连点不会重复入队。
- **收尾推广**：把「无在途且无待处理」的旧未结束批次就地收尾，与原 latest 行为一致，只是范围扩大；
  在途运行（含 interrupted 前的 reserved）不受影响。
- **pruneBatches**：排队批次是新创建的（最新），不在最旧删除范围；在途保护逻辑不变。
- **跨 mode**：当前仅 zcode 批次入队；若未来 codex 复用 createBatch，单队列语义与项目级互斥一致，无需改。
