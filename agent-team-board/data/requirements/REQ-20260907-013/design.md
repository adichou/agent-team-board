# 设计 — REQ-20260907-013 支持当前已有批次执行中时，可以创建新批次。没在执行中的新批次可以被删除。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- REQ-20260906-025 已在核心层实现批次排队：`createBatch` 在有未结束批次时新建入队（FIFO）、`queueHeadBatch` 动态解析队首、`checkBatch` 收尾自动接续。CLI / serve 已支持执行中创建。
- 缺口一（UI）：看板「Zcode 批次」面板在当前批次未结束时没有任何创建入口。
- 缺口二（全栈）：没有任何手动删除批次的能力，误建的排队批次无法清理。
- 既有 `pruneBatches`（REQ-20260906-023）只按保留上限自动清理最旧批次，且对在途批次有跳过保护，可作为删除口径参照。

## 方案

### core：`batch.deleteBatch(dataDir, batchId)`

- 校验顺序：
  1. `getBatch`（不存在 → AtbError「找不到批次」）。
  2. 扫描该批次全部运行：存在 `phase ∉ FINAL_RUN_PHASES(reported|blocked|failed)` 且 `≠ interrupted` 的运行 → 拒绝，错误信息带在途 runId（覆盖 `batch.currentRunId` 与异常残留两种来源）。
  3. `batch.status === 'needs_attention'` → 拒绝：须先人工核对并「暂停→恢复」解除项目占用（attention 锁挂在批次上，删除会丢失恢复入口）。
- 执行：`fs.rmSync(batches/<batchId>/, { recursive: true, force: true })`，返回 `{ ok: true, batchId }`。
- 不动 `runs/`（与 pruneBatches 同口径，运行记录是独立账本）；不动 `impl.lock`（无在途时锁本不该存在；attention 场景已被 needs_attention 拒绝挡住）。
- 队列为动态计算（`unfinishedBatches` / `queueHeadBatch` / `checkBatch.nextBatch`）：删除后自动缩短、位次前移，删除队首未执行批次后下一批自动成为队首并解除 `nextItem` 防抢阻塞，无需任何迁移。
- 幂等性：重复删除第二个请求报「找不到批次」（与 `getBatch` 一致），不做静默幂等。

### CLI：`atb batch delete <BATCH-ID>`

- 位置参数必填（`--batch` 等价）；不走 `needBatch` 缺省解析——删除是破坏性操作，必须显式指定。
- 成功输出 `✓ 已删除批次 <ID>`（说明队列自动前移、条目不受影响）；失败 AtbError 非 0 退出（die）。`--json` 输出 `{ ok, batchId }`。

### serve：`POST /api/batch/delete`

- body `{ batchId }`（必填）；成功 `{ ok: true, batchId }`；AtbError 经统一错误处理返回 400 `{ error }`。

### web（app.js）

- `renderZcodeBatchPanel`：
  - 当前批次操作区（`drawer-actions batch-actions`）新增：
    - 「排队新批次」按钮 `#queueNewBatch`：显示条件 `!batchDone && data.nextAction !== 'needs_attention'`（未结束且非待核对）；title 说明排到队尾、当前批次结束后自动接续。
    - 「删除本批次」按钮 `#batchDelete`：显示条件 `!data.current && b.status !== 'needs_attention'`（无在途执行且非待核对；含 finished 清理场景）。
  - 排队列表项（`batch-queue-item`）末尾加 `data-del-batch` 删除按钮（仅排队项，队首走主面板按钮）。
- `bindBatchDrawer`：
  - `#queueNewBatch` → 复用 `createBatchAndCopy()`（toast/签名失效/refreshBatch 均已有：排队文案「已加入队列，排第 N 位」）。
  - 删除按钮（主面板 + 排队项，统一 `deleteBatchById(batchId, meta)`）：`uiConfirm`（danger）确认「删除批次 X？该批次不在执行中；仅移除批次账本，条目与运行记录不受影响，队列自动前移」→ `POST /api/batch/delete` → toast 成功 / 失败 → `state.batchSig = ''` + `refreshBatch()`。
- 删除后视图切换由数据驱动：删队首 → `/api/batch/current` 返回新队首或 `batch: null`（创建表单），重渲染自然完成。

## 风险与边界

- 误删在途批次：核心层全量扫描运行做在途保护（不只看 currentRunId），UI/API/CLI 三入口共用同一校验。
- needs_attention 不可删：保留「暂停→恢复」解除 attention 的入口，避免死锁项目占用。
- 并发窗口：删除与 worker `nextItem` 并发时，`nextItem` 的 impl 互斥锁保证同时只有一个实施任务；删除侧若恰逢新预留（在途运行落盘）则被在途校验拒绝；反之删除后 `nextItem` 按 `getBatch` 报「找不到批次」，行为可解释，不做跨进程事务。
- `dispatch/.gitignore` 已忽略 `dispatch/batches/`，删除不产生版本控制噪音。

## 实施记录

- core `deleteBatch`：scripts/lib/batch.mjs（getBatch → 在途运行拒绝 → needs_attention 拒绝 → rmSync）。
- CLI `batch delete`：scripts/atb.mjs（位置参数 / `--batch`，必填校验）。
- API `/api/batch/delete`：scripts/server.mjs。
- UI：scripts/web/app.js（排队新批次 + 两个删除入口 + uiConfirm 确认流）。
- 测试：scripts/tests/batch-delete.test.mjs（D1–D8 删除、C1 执行中创建回归）。
