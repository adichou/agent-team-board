# 设计 — REQ-20260906-022 批次结束后在看板提供创建下一批入口

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- `renderZcodeBatchPanel()` 只有两种形态：无批次 → 创建面板；有批次 → 运行视图。批次一旦存在，创建面板永不再出现——批次结束后看板 UI 没有任何「再创建」入口，只能走 CLI。
- `/api/batch/create` 幂等语义：最新批次未结束时重复请求返回旧批（`created: false`），防止重复建批；最新批次已结束（finished 且无在途/待处理）则新建（`created: true`）。服务端行为已被 `batch-core.test.mjs`（「finished 批次后可创建新批次」）覆盖，本需求不改服务端。
- `checkBatch` 在待处理为 0 时返回 notice「本批范围已处理完毕（新接受的条目留给下一批）」，`/api/batch/current` 已透出 `batch.status`、`counts.remaining`、`notice`——前端条件所需数据齐备。

## 方案

纯前端改动（`scripts/web/app.js`），服务端与 CLI 零改动：

1. **入口渲染**：`renderZcodeBatchPanel()` 运行视图引入 `batchDone = b.status === 'finished' && (counts.remaining ?? 0) === 0`；为真时在状态行之后渲染完成通知（复用 `data.notice`，缺省「本批范围已处理完毕」）与「创建下一批」按钮（`id="batchNext"`，primary）。其余状态（含 finished 但仍有待处理项，如仅剩依赖受阻）不渲染。
2. **复用创建流程**：`bindBatchDrawer()` 绑定 `#batchNext` → 复用 `createBatchAndCopy()`：同一 `POST /api/batch/create`，携带当前勾选集合 `state.impl.selected` 作为 ids。运行视图无 `#batchLimit` 输入，limit 回退到与创建面板输入框同款默认值（勾选 N 项 → N，未勾选 → 20）。
3. **幂等提示不误导**：`createBatchAndCopy()` 按 `res.created` 区分提示——`true` 维持「已创建批次 …并复制提示词」；`false`（并发窗口下另一端已新建未结束批次）改为「未新建批次：当前批次 … 尚未结束，已复制其提示词」。
4. **创建后自动切换**：成功后 `refreshBatch()` 重渲染，面板自然切到新批次（prepared/待启动）。

## 风险与边界

- finished 且 remaining>0（仅剩受阻项）：不显示按钮（需求限定「无待处理项」），先处理依赖再开下一批。
- 并发窗口：渲染时已结束、点击前另一端已建未结束新批 → `created:false`，按上文案如实提示。
- 空候选：按钮可点但接口报「没有可实施候选…」，toast 就地反馈，不创建空批次。
- 影响面仅 Zcode 批次页签运行视图；创建面板、Codex 页签、记录分页不变。

## 实施记录

- 测试：新增 `scripts/tests/next-batch-entry.test.mjs`（UI 静态契约，N1–N5）；服务端「结束后可新建」沿用 `batch-core.test.mjs` 既有覆盖。
- 实现：`renderZcodeBatchPanel()` 增加 `batchDone` 分支；`bindBatchDrawer()` 绑定 `#batchNext`；`createBatchAndCopy()` 增加 limit 缺省回退与 `created` 区分提示。
