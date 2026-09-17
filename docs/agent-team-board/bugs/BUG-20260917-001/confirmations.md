# 人工确认记录 — BUG-20260917-001 版本计划发布后，左侧的列表中没有显示版本计划已发布的标签

> 由 atb 挂起确认机制维护（REQ-20260914-001）：自动提交不完整 / 分析问题挂起 → 人工核对与确认 → 恢复闭环全程留痕。请勿手改。

## 第 1 轮（当前） · 待人工确认 · 待人工确认提交

- 声明：2026-09-17T07:30:43.001Z（auto-commit） · 运行 run-20260917-269
- 原因：自动提交失败：git add失败：fatal: pathspec 'docs/agent-team-board/builds/versions/BLD-20260914-001/version.json' did not match any files（已成功提交 0 组，hash 已保留，不重复提交）

- 最近核验：2026-09-17 09:01:43 未通过
  - 仍有 368 个候选路径未入库（本单可归属 10 · 归属待确认 358）：docs/agent-team-board/bugs/BUG-20260917-001/README.md、docs/agent-team-board/bugs/BUG-20260917-001/confirmations.md、docs/agent-team-board/bugs/BUG-20260917-001/design.md、docs/agent-team-board/bugs/BUG-20260917-001/status.json、docs/agent-team-board/bugs/BUG-20260917-001/test-report.md 等 368 个——与面板计数同源
  - 归属待确认 358 个路径需人工选择「计入本次补交 / 排除」后才能确认补交范围（看板面板逐项选择）
- Git 失败摘要：git add失败：fatal: pathspec 'docs/agent-team-board/builds/versions/BLD-20260914-001/version.json' did not match any files（已成功提交 0 组，hash 已保留，不重复提交）
- Git 失败完整错误（保留原始输出用于诊断）：git add失败：fatal: pathspec 'docs/agent-team-board/builds/versions/BLD-20260914-001/version.json' did not match any files

事件留痕：
- 2026-09-17 07:30:43 declared（auto-commit）：自动提交失败：git add失败：fatal: pathspec 'docs/agent-team-board/builds/versions/BLD-20260914-001/version.json' did not match any
- 2026-09-17 07:52:54 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 07:52:58 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 07:53:36 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 07:53:44 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 08:30:14 confirm-rejected（board）：路径 docs/agent-team-board/config.json 内容已变（确认时所见与当前不一致），请重新核对差异
- 2026-09-17 08:54:49 confirm-rejected（board）：路径 docs/agent-team-board/bugs/BUG-20260917-001/confirmations.md 内容已变（确认时所见与当前不一致），请重新核对差异
- 2026-09-17 09:01:43 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
