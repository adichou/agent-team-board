# 设计 — REQ-20260922-004 AI 分析要支持并行子代理模式，可同时最多展开 3 个子代理认领需求分析

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

AI 分析（refine）当前执行链路严格串行：`nextRefineItem` 在 `batch.currentRunId` 指向的运行未终态时直接抛「当前执行未收尾」；全局单锁 `refine.lock` 由领取占用、回执释放；`checkRefineBatch` 协议只有单条 `current`，任一在途即 `needs_attention`；面板概况区按单个当前项展示。每个子代理执行时长远长于核对耗时，队列较长时整轮墙钟时间随条目数线性增长。

## 方案

（技术选型、接口设计、影响面）

### 并行模型（固定上限 3）

- 导出常量 `REFINE_PARALLEL_LIMIT = 3`（scripts/lib/refine-store.mjs）。「待确认」默认口径：固定值，
  不在设置「批量任务」分区提供配置项（人工确认后再议）。
- **在途集合（activeRuns）**= 批次内相位非终态（reserved / running / queued）的运行，按 `createdAt` 升序。
  事实源为 runs 账本相位（`refineRunsOfBatch` 盘点）；`batch.currentRunId` 保留为「最新领取」兼容字段
  （存量读取方 / refine-fingerprint 测试仍引用），新增 `batch.activeRunIds` 冗余账本（领取追加、回执移除），
  读取侧始终按 runs 实际相位过滤——存量账本无 `activeRunIds` 时回退 `[currentRunId]`，
  **不做迁移、不产生误判**（升级时在途 1 项 < 3 天然合法，直接按新口径续跑）。
- 同一条目单执行者：领取候选循环既有 `activeByItem` 跳过在途条目，天然并行安全，不放宽。

### 领取与互斥（nextRefineItem / refine.lock 语义迁移）

- **移除**「currentRun 未收尾 → 抛错」串行拦截：盘点后在途 ≥ 3 → 返回 `stop: 'busy'` + notice
  （列出在途条目、等待任一回执后核对补派），**不抛错**；在途 < 3 → 正常进入候选循环。
- **zcode 领取不再持有全局 refine.lock**（旧「领取占用、回执释放」语义废弃）。领取的
  「读账本→吸收→盘点→选候选→落账」整段改由短临界区锁 `.locks/refine-next.lock`
  （`acquireLock(path, 30_000, …)`，操作完成即释放）保护——跨进程（≤3 个子代理 CLI 并发）的
  领取原子性由该锁保证，条目互斥由锁内重读的 `activeByItem` 保证。锁 payload 带
  `{ kind, batchId, owner, at }` 便于诊断。
- 无候选收尾：**在途未清零时不落 `finished`**（保持 running），返回 `stop: 'finished'` +
  notice「队列已取空，在途 N 项等待回执」；在途清零才收尾落账。收尾时清 refine.lock 的范围收窄为
  `kind !== 'codex-refine'`（不得误删 codex 执行器占用的锁）。
- 回执 / 释放 / 续跑（finishRefineRun / releaseRefineRun / resumeAfterAnalysisConfirm）：
  仅结算对应运行——从 `activeRunIds` 移除自身、`currentRunId` 等值时重指向剩余最新在途或置空；
  其余在途与计数不受影响。按 `runId || owner` 的 refine.lock 释放逻辑保留
  （兼容存量 zcode 残留锁与 codex 执行锁释放）。
- abortRefineBatch：既有「全部非终态运行落 interrupted」循环天然多在途；增加 `activeRunIds` 清空。
- declareRefineHold / resumeAfterAnalysisConfirm 的「必须是 currentRun」校验放宽为「运行非终态」
  （并行下任一在途运行可声明挂起）；hold 只置 pauseRequested（队列暂停），其他在途回执不受影响。

### 核对协议（checkRefineBatch）

- 保留单条 `current`（最新在途，兼容旧读取方），**新增 `currents`**（在途列表 ≤3：
  `{ runId, itemId, owner, phase, at }`，不带 title 控制体积）。响应 ≤2 KiB 不变。
- `nextAction` 语义：abort / pause（含挂起待人工确认）→ `stop`；`remaining === 0` → `stop` +
  落 finished；**可领数（remaining − 在途数）≤ 0 或在途 ≥ 3** → `needs_attention`
  （等待任一子代理回执后核对）；否则 → `continue`（在途不足 3 且队列有余，可补派）。
  单在途串行退化形态（可领数 0）与旧口径 `needs_attention` 一致，行为零回归。

### 主调度提示词（buildRefinePrompt）

静态段改为并行口径：同时最多 3 个子代理并行、各自认领**不同**条目、每个只做一项、不得再派发子代理；
任一回执后 `refine check` 核对，在途不足 3 且队列有余即补派；实时队列取空即本轮结束；`next` 返回
busy/stop 按提示结束。删除「同一时间只运行一个」。角色 / 流程 / 补全口径 / 演示门槛 / 回执语义静态段
在前 + 项目根 / CLI 入口 / 模型跟随行 / autoPlan 约束段尾部参数区的结构不变（REQ-20260921-006 缓存口径保持）。

### CLI（atb refine）

- `next` 的 stop 分支新增 `busy` 解释：**exit 0 + 明确提示**（非 die），`--json` 输出完整 JSON；
  stop 分支统一透出 notice。
- `check` 文本输出「当前执行」改为在途列表（currents 逐条 runId/itemId/owner/phase）。
- usage 与 REFINE_USAGE 文案同步并行口径。

### 任务页面板（scripts/web/app.js renderRefinePanel + server /api/refine/current）

- `refineSummary` 新增 `activeRuns` 透传（server /api/refine/current 一并透出）；`currentRun` 保留。
- 概况区：**在途运行卡片列表**（≤3 张：条目编号（可点击跳条目）+ 标题、子代理会话、开始时间、已用时；
  卡片区头部标注「在途子代理 N/3」与槽位指示）；无在途时保留原 meta-grid 空态（状态文案锚点不变）。
  「最近回执 / 最后活动」两格保留。
- 统计行「进行中」= 实际在途数（activeRuns.length）；`activeRuns` 缺失回退 `[current]`（旧数据兼容）。
- 队列 / 记录 / 提示词页签、三态徽标（refine-states 按条目记录）、完善中禁驳拦截不回归。
- 新增界面文案在 scripts/web/i18n.js 中英文同步（BUG-20260912-001 口径）。

### codex 后台执行器（server.mjs refineRunners）

不动（「待确认」默认口径：仅子代理模式并行化，codex 维持项目内并发 1）。
zcode 不再占 refine.lock 后，二者锁互不误清（zcode 收尾释放排除 `codex-refine` kind）。

**开源选型（REQ-20260909-015）**：无合适库的原因——本单为既有账本 / 锁 / 提示词协议的口径演进
（并行槽位、多在途协议字段），全部逻辑在项目自有 refine-store 数据层内实现，无第三方依赖引入
（未使用开源库，不创建 licenses.md）。

## 风险与边界

- **存量进行中任务续跑**：升级时在途 1 项，新领取逻辑（在途 < 3）直接放行补派；旧串行提示词已粘贴的
  会话仍按「回执后核对」推进，协议向后兼容（current 保留）；旧 refine.lock 残留由该在途回执时按 owner
  释放，不阻塞后续领取（zcode 领取不再检查该锁）。
- **跨进程领取竞态**：≤3 个子代理 CLI 并发 next 由 refine-next.lock 短临界区串行化；账本写入沿用
  writeJsonAtomic。锁 30s 过期接管仅针对临界区（毫秒级操作），不会误接管长持有。
- **退化串行一致性**：在途恒 ≤1 时，check 的 needs_attention / stop 判定与旧口径一致；
  单子代理逐项执行的旧用法（不补派）行为不变。
- **不放宽项**：每条目单执行者、「完善中的单不可驳回回待接受」拦截（core.mjs setStatus 校验，按条目
  生效天然多在途安全）、同一项目同一时间一轮完善执行、impl.lock 与 AI 开发 / AI 总结 / AI 翻译锁互不占用。
- **2 KiB 协议上限**：currents ≤3 条精简字段（无 title），满配实测远低于上限（测试断言）。
