# REQ-20260908-019 批量执行去掉上限的设置

- 状态：planned（已计划，待 Agent 认领）
- 创建：2026-09-08T06:11:13.526Z

## 描述

批量执行（批次创建）目前有一处「上限」设置，分布在四个入口：

1. CLI：`atb batch create --limit N`（1–100 整数校验）；
2. 配置：`dispatch/settings.json` 的 `defaults.batchLimit`（缺省 20）；
3. Web 创建面板：「批次上限」数字输入框（1–100）；
4. 展示：CLI 创建输出、批次面板状态行、`/api/batch/create`、`/api/batch/current`、`batchPublicView` 等均回显 `limit`。

该上限只约束**创建时点的初始快照**：REQ-20260908-010 实时队列之后，运行中新置计划的条目会被 `batch next` 持续吸收（`absorbNewCandidates` 明确不受 limit 约束），上限已无实际约束意义，只留下一条多余的配置路径和理解成本（面板还需解释「是初始快照上限，不是上下文容量保证」）。

本需求将「上限」设置整体移除：

- 批次创建时冻结**全部**可入批候选（勾选 ids 范围语义保留，仅去掉数量截断）；
- CLI 不再接受 `--limit`（传入时明确报错提示已移除，不静默忽略）；
- `settings.json` 不再写入/读取 `defaults.batchLimit`；
- Web 创建面板去掉上限输入框，批次展示不再显示「上限 N」；
- 各接口响应不再回显 `limit` 字段。

## 验收标准

- [ ] `createBatch` 候选=范围全量冻结（无截断），新批次记录不含 `limit` 字段；`BATCH_LIMIT_*` 常量删除
- [ ] `atb batch create --limit 10` 非零退出并提示上限设置已移除；不带 `--limit` 正常创建
- [ ] `/api/batch/create` 忽略 `body.limit`（不再 400 越界校验），响应与 `/api/batch/current` 响应不含 `limit`
- [ ] Web 创建面板无「批次上限」输入框，创建请求体不含 `limit`，运行视图状态行不再显示上限
- [ ] 勾选 ids 范围语义不变：空集报错、已被认领项剔除、按规范序全量入批
- [ ] 存量兼容：旧批次 `batch.json` 含 `limit`、旧 `settings.json` 含 `defaults.batchLimit` 时读写与展示不受影响
- [ ] 相关文档（SKILL.md CLI 速查、batch-execution.md）同步更新，不再提及批次上限
- [ ] 全量测试通过（node scripts/tests/run-all.mjs）
