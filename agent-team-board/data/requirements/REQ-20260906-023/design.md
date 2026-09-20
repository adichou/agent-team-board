# 设计 — REQ-20260906-023 批量实施的批次最多保留 100 个，超出的删除最旧的

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`dispatch/batches/<batchId>/` 批次账本目录随 `createBatch` 无限累积（CLI `atb batch create` 与 server.mjs 批量实施 API 两个入口共用 `lib/batch.mjs#createBatch`）。需要保留上限：最多 100 个，超出删除最旧的。

## 方案

改动集中在 `scripts/lib/batch.mjs`（核心层），CLI 只加一行清理摘要输出，Web API 无需变更（多返回字段向后兼容）。

1. **常量**：`export const BATCH_RETENTION_MAX = 100`（导出供测试引用；与 BATCH_LIMIT_MAX 数值相同但语义不同——一个是每批条目上限，一个是批次保留数上限）。
2. **新增 `pruneBatches(dataDir, keep = BATCH_RETENTION_MAX)`**：
   - `listBatches` 读取全部批次后按 `(createdAt, batchId)` 双键升序（createdAt 同毫秒时以 batchId 定序，batchId = `batch-<日期>-<全局序号>`，字符串序即创建序）。
   - 总数 ≤ keep 时直接返回；否则对「最新 keep 个」之外（更旧端）逐一尝试删除。
   - **在途保护**：批次 `currentRunId` 指向的 run 存在且 phase 非终态（reported/blocked/failed）且非 interrupted 时，视为在途，跳过不删（正常收尾会把 currentRunId 置 null，此检查是对异常账本的兜底）。
   - 删除 = `fs.rmSync(<批次目录>, { recursive: true, force: true })`；单个删除抛错时跳过该批次继续，不中断。
   - 返回 `{ kept, removed: [batchId…] }`。
3. **触发点**：`createBatch` 内 `saveBatch(新批次)` 成功、`return { batch, created: true }` 之前调用 `pruneBatches(dataDir)`，返回值附在 `{ batch, created, pruned }`。幂等分支（created=false）不触发。
   - 刚创建的批次在最新端，天然不会被删除。
   - `atb.mjs batch create` 在 created=true 且 pruned 非空时打印「已清理最旧批次 N 个」。
4. **不动的部分**：`dispatch/runs/` 运行账本保留（不在本需求范围）；批次删除后其 runs 记录成为孤儿数据，但不影响任何现有入口（`batchRuns` 按 batchId 过滤，无批次引用即无入口读取）。

## 风险与边界

- **误删在途批次**：靠「在途保护」跳过；极端情况下（currentRunId 已收尾但 status 仍 running）批次仍会被删——这类账本本就收尾异常，删目录不影响条目业务状态（条目 status.json 独立存储）。
- **与其他调度器并发**：Codex 调度器（scheduler.mjs）通过 latestBatch 找批次开工；prune 只删「最新 100 之外」的更旧批次，正在被 Codex 使用的批次必为最新端或在途（受保护），实际冲突面极小。
- **测试构造**：102 个批次 × 真实 create/收尾路径的集成用例约产生 300+ 次小文件写，单测耗时可接受（<2s）。
- pruned 摘要进入 createBatch 返回值，`server.mjs` 与 CLI 的既有解构不受影响。

## 实施记录

- 2026-09-07（zcode-batch-003-01）：按上述方案实施；测试补入 `scripts/tests/batch-core.test.mjs`（R23-01~R23-05，覆盖 R01~R06 用例点——R06 的 pruned 清单与 latestBatch 断言并入 R23-04/05）。TDD 先跑红（5 例红）再实现跑绿。
- 结果：R23 全部通过；插件全量 46 个测试文件 0 失败（含 batch-cli / batch-serve / dispatch-* / scheduler 回归）。
- CLI 行为：`atb batch create` 文本输出在 created 且有清理时追加一行「已清理最旧批次 N 个（最多保留 100 个）：…」；`--json` payload 的 counts 增加 `pruned` 计数字段（向后兼容）。
