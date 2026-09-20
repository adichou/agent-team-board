# 人工确认记录 — BUG-20260916-003 条目人工确认完成后未取消其受阻回执，批次计数永久残留受阻

> 由 atb 挂起确认机制维护（REQ-20260914-001）：自动提交不完整 / 分析问题挂起 → 人工核对与确认 → 恢复闭环全程留痕。请勿手改。

## 第 1 轮（当前） · 待人工确认 · 待人工确认提交

- 声明：2026-09-18T16:35:46.551Z（auto-commit） · 运行 run-20260919-282
- 原因：自动提交不完整：存在归属不明或暂扣待人工路径

- 已提交分组：
  - auto：doc: 条目人工确认完成后未取消其受阻回执，批次计数永久残留受阻 BUG-20260916-003（415a9d8281，0 个路径）
- 待人工核对路径（1）：scripts/lib/batch.mjs
- 暂扣待补交路径（4）：scripts/tests/bug-20260916-003.test.mjs、scripts/lib/core.mjs、scripts/web/app.js、scripts/web/i18n.js
- 最近核验：2026-09-18 16:38:10 未通过
  - 仍有 6 个候选路径未入库（本单可归属 5 · 归属待确认 1）：agent-team-board/data/bugs/BUG-20260916-003/confirmations.md、scripts/lib/core.mjs、scripts/tests/bug-20260916-003.test.mjs、scripts/web/app.js、scripts/web/i18n.js 等 6 个——与面板计数同源
  - 归属待确认 1 个路径需人工选择「计入本次补交 / 排除」后才能确认补交范围（看板面板逐项选择）

事件留痕：
- 2026-09-18 16:35:46 declared（auto-commit）：自动提交不完整：存在归属不明或暂扣待人工路径
- 2026-09-18 16:38:10 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
