# BUG-20260907-012 run receipt 用法提示与实现不符：--report-ref 被标为可选，实际 reported 回执必填

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T09:00:50.951Z

## 现象

## 现象
- SKILL.md CLI 速查：$ATB run receipt <RUN-ID> --result reported|blocked|failed […]（可选参数样式）
- atb.mjs USAGE：[--report-ref 文件] 同样可选样式
- 实际执行 atb run receipt <ID> --result reported（不带 --report-ref）→ 报错「reported 回执必须携带 reportRef（条目 test-report 的相对引用）」

dispatch/worker-spec.md 与 batch-execution.md 的示例命令均带 --report-ref，按文档执行的 worker 不受影响；仅速查/USAGE 提示误导。

## 建议
两处用法文本把 reported 场景的 --report-ref 标为必填（如「--result reported 必带 --report-ref」），或错误信息里直接给出修正后的完整命令示例。

## 复现步骤

1. `node scripts/atb.mjs --help` 查看 USAGE，或读 SKILL.md「CLI 速查」：`run receipt` 行均把 `--report-ref` 写成可选样式（`[--report-ref 文件]` / `[…]`）；
2. 按提示执行 `atb run receipt <RUN-ID> --result reported`（不带 --report-ref）→ 报错「reported 回执必须携带 reportRef（条目 test-report 的相对引用）」，与提示矛盾。

## 期望行为

- 主 USAGE（`--help`）与 BATCH_USAGE（`run` 缺参提示）：reported 分支明确展示 `--result reported --report-ref`，blocked/failed 分支明确展示 `--reason` 必填，不再用可选样式误导；
- reported 缺 `--report-ref` 的报错信息直接给出修正后的完整命令示例；
- SKILL.md CLI 速查同步按必填呈现。

## 修复说明（2026-09-08，zcode-batch-009-1）

- `scripts/atb.mjs` 主 USAGE 与 BATCH_USAGE：`run receipt` 拆为两行——`--result reported --report-ref 文件`（必带）与 `--result blocked|failed --reason 短句`（必带），去掉 `[--report-ref 文件]` / `[选项]` 可选样式；
- `scripts/lib/batch.mjs` `finishRun`：reported 缺 reportRef 的错误信息追加修正示例 `atb run receipt <RUN-ID> --result reported --report-ref test-report.md`（保留 `reportRef` 字样兼容既有断言）；
- `skills/agent-team-board/SKILL.md` CLI 速查同步改为必填呈现；
- 新增回归测试 `scripts/tests/receipt-usage-hint.test.mjs`（H1–H4：主 USAGE / BATCH_USAGE / 报错示例 / SKILL.md 速查），全量 `npm test` 70 个测试文件通过。

## 关联（引入来源）

- 引入来源：REQ-20260906-002（引入 `run receipt` 子命令与回执协议：实现侧 reported 必带 reportRef、blocked/failed 必带 reason，但 USAGE/SKILL 速查文案未同步必填语义）
