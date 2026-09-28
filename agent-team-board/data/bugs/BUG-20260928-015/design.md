# 设计 — BUG-20260928-015 发布运行失败后确认锁不回滚：计划被误锁为已发布、无法调整范围与重新提交

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260928-005（把正式发布锁定基准从「推送完成」改为「发布按钮 + 二次确认」时点；其实现 `recordReleaseConfirm`（build-store.mjs）在运行启动时固化 `release.confirmedAt`，注释明确「幂等：首次确认时点固化（发布重试 / 取消后再发布不重置，与『成功不可逆』同向）」——把「成功不可逆」与「失败不回滚」合并成了同一条幂等规则，未区分运行失败终态。已核验 `atb list` 存在且 done。）

## 根因分析

- `isReleased(v)`（build-store.mjs:245）只看 `v.release.confirmedAt` 是否存在；`recordReleaseConfirm` 在一键发布链路（build-publish.start）启动时落账，运行随后失败不做任何回退。
- 失败运行留痕在 `runtime/builds/publish-runs/<runId>/run.json`（status: failed），版本计划 `release.confirmedAt / confirmedRunId` 与运行终态之间没有联动。
- 结果：`confirmedAt` 存在 → 条目/文档锁全部生效（assertItemsEditable / 各范围锁定拦截），文案按「已正式发布」口径生成，而实际发布从未成功。存量实例：BLD-20260927-001，confirmedRunId=BPUB-711ea71f（failed，stage=site-deploy），无 succeeded 运行。

## 方案

双层修复（写侧落账 + 读取侧兜底，存量自动修复）：

1. **写侧回退（主路径）**：发布运行进入失败 / 取消终态的收尾处，调用新的 `rollbackReleaseConfirm(dataDir, bldId, runId)`：当 `release.confirmedRunId === runId` 且该 runId 无 succeeded 记录时，清除 `confirmedAt / confirmedRunId`，保留其余 release 字段（确认前的 pushedAt / pushedSha / site 推送事实原样）。
2. **读取侧兜底（存量与漏网修复）**：`isReleased(v)` 增强为「`confirmedAt` 存在，且（无 `confirmedRunId` 可查，或对应运行终态非 failed/cancelled）」——`confirmedRunId` 对应运行读取 `runtime/builds/publish-runs/<id>/run.json`，失败/取消终态则视为未确认。该兜底使存量 BLD-20260927-001 无需手工改数据即恢复可编辑；run.json 缺失（被清理）时按 `confirmedAt` 现状判定为已发布（保守口径，避免误解锁真实已发布版本）。
3. **重试语义**：回退后再次点击发布 → `recordReleaseConfirm` 重新固化新的确认时点与 runId（「首次固化」语义修正为「最近一次有效确认」；历史确认留痕在 publish-runs 与 run 账本中可追溯）。
4. **文案**：锁拦截文案不改（回退后 isReleased 为假，不再触发）；看板「已发布」徽标本就以「任一运行 succeeded」汇总（build-publish-store），失败不受影响。

**开源选型（REQ-20260909-015）**：纯既有 Node 内置能力（fs 读取 run.json + 状态机调整），无引入开源库必要（无合适库：改动域为插件自身运行账本状态机，无对应三方库）。

## 风险与边界

- run.json 缺失时保守判「已发布」，不会误解锁真实发布过的版本；代价是运行账本被人工删除的失败计划仍锁——属可接受边界（账本删除本身是流程外操作）。
- 并发边界：发布运行收尾与看板读取并发时，写侧回退与读取侧兜底结论一致（同一判定函数），无双写冲突。
- `releasedAt = release.pushedAt`（REQ-20260922-006）不受影响：回退只动确认锁字段，推送事实不动。
- 发布成功后不可逆语义不变：succeeded 运行存在时任何路径都不清除确认锁。
