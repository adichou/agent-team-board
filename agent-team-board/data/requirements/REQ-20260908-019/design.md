# 设计 — REQ-20260908-019 批量执行去掉上限的设置

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

批次上限（CLI `--limit` / `settings.json defaults.batchLimit` / Web 输入框 / 各处 `limit` 回显）只截断创建时点的候选快照。REQ-20260908-010 实时队列后，`batch next` 每轮吸收新置计划条目且明确不受 limit 约束（`absorbNewCandidates` 注释），上限对总量毫无约束力，仅剩配置噪音与 UI 解释成本。

## 方案

**库层 `scripts/lib/batch.mjs`**

- 删除导出常量 `BATCH_LIMIT_MIN/MAX/DEFAULT`（无其他语义占用方；`dispatch-store.mjs` 的引用一并清理）。
- `createBatch` 参数签名去掉 `limit`：
  - 候选 = 范围（`ids` 勾选集合 ∩ 规范候选序，或全部候选）**全量冻结**，删除 1–100 校验与 `slice(0, n)` 截断；
  - 幂等比较 `freshNow` 同步去掉截断；
  - 批次记录不再写 `limit` 字段；传入多余 `limit` 键一律忽略（JS 对象多余键天然无害，不做校验）。
- `ensureDispatch` 初始化 `settings.json` 只写 `counters`，不再写 `defaults.batchLimit`。

**配置层 `scripts/lib/dispatch-store.mjs`**

- `saveSettings` 删除 `next.defaults = cur.defaults || { batchLimit }` 回填；既有 `defaults` 字段经 `{ ...cur, ...patch }` 原样保留（不丢弃既有数据），仅不再新增。

**CLI `scripts/atb.mjs`**

- `batch create` 的 valueFlags 去掉 `limit`；显式检测 `opts.limit !== undefined` 时 `die('批次上限设置已移除…')`——比静默忽略友好（用户肌肉记忆 `--limit` 时给出明确指引）。
- `BATCH_USAGE`、create 输出行（`上限 N · …`）、JSON payload、`batchPublicView` 均去掉 limit。

**HTTP `scripts/server.mjs`**

- `POST /api/batch/create` 不再透传 `body.limit`（多余字段忽略、不报错——旧缓存页面不致 500），响应去 `limit`；
- `GET /api/batch/current` 响应去 `limit: s.batch.limit`。

**前端 `scripts/web/app.js`**

- 创建面板删除「批次上限」`field-inline`（`#batchLimit` 输入框）；
- `createBatchAndCopy` 删除 limit 计算，请求体只带 `ids`（有勾选时）与 `developer`；
- 运行视图状态行 `上限 ${b.limit} · …` 去掉上限段。

**文档**

- `skills/agent-team-board/SKILL.md` CLI 速查行去掉 `[--limit N]`；
- `docs/agent-team-board/batch-execution.md` §2 创建说明去掉上限句。

## 存量兼容

- 旧批次 `batch.json` 的 `limit` 字段：仅历史数据，读取路径（`batchState`/`checkBatch`/`nextItem`）均不使用，展示层不再回显，无需迁移。
- 旧 `settings.json` 的 `defaults.batchLimit`：不再被读取；`saveSettings` 保留既有字段不删除。
- 运行账本协议（check/回执 ≤2 KiB）从未携带 limit，无协议变更。

## 风险与边界

- 勾选 ids 范围（REQ-20260906-018）语义保留，仅去掉数量截断——S2 用例同步改写。
- 「创建下一批」（REQ-20260906-022）原先复用上限缺省值逻辑（勾选 N→N / 未勾选→20），移除后自然退化为「范围全量」，无需特判。
- 移除的是「设置」而非候选冻结机制本身：重复创建幂等、防重复入队、依赖受阻计数等行为不变（回归用例覆盖）。

## 实施记录

- 2026-09-08 实施完成：上述各层按方案落地；`Z02d` 改写为「上限设置已移除」行为断言，`N5`/`E7`/`U6`/`S2`/serve/delete/queue 用例同步去 limit 化；全量测试通过（见 test-report.md）。
