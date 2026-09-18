# 人工确认记录 — BUG-20260917-001 版本计划发布后，左侧的列表中没有显示版本计划已发布的标签

> 由 atb 挂起确认机制维护（REQ-20260914-001）：自动提交不完整 / 分析问题挂起 → 人工核对与确认 → 恢复闭环全程留痕。请勿手改。

## 第 1 轮（当前） · 已确认恢复 · 待人工确认提交

- 声明：2026-09-17T07:30:43.001Z（auto-commit） · 运行 run-20260917-269
- 原因：自动提交失败：git add失败：fatal: pathspec 'docs/agent-team-board/builds/versions/BLD-20260914-001/version.json' did not match any files（已成功提交 0 组，hash 已保留，不重复提交）

- 人工确认补交：06ae1088aa doc: 版本计划发布后，左侧的列表中没有显示版本计划已发布的标签 BUG-20260917-001；cf0f3cb086 fix: 人工确认补交 BUG-20260917-001
- 最近核验：2026-09-17 09:09:00 通过
- Git 失败摘要：git add失败：fatal: pathspec 'docs/agent-team-board/builds/versions/BLD-20260914-001/version.json' did not match any files（已成功提交 0 组，hash 已保留，不重复提交）
- Git 失败完整错误（保留原始输出用于诊断）：git add失败：fatal: pathspec 'docs/agent-team-board/builds/versions/BLD-20260914-001/version.json' did not match any files
- 确认恢复：2026-09-17T09:09:00.318Z

事件留痕：
- 2026-09-17 07:30:43 declared（auto-commit）：自动提交失败：git add失败：fatal: pathspec 'docs/agent-team-board/builds/versions/BLD-20260914-001/version.json' did not match any
- 2026-09-17 07:52:54 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 07:52:58 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 07:53:36 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 07:53:44 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 08:30:14 confirm-rejected（board）：路径 docs/agent-team-board/config.json 内容已变（确认时所见与当前不一致），请重新核对差异
- 2026-09-17 08:54:49 confirm-rejected（board）：路径 docs/agent-team-board/bugs/BUG-20260917-001/confirmations.md 内容已变（确认时所见与当前不一致），请重新核对差异
- 2026-09-17 09:01:43 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-17 09:09:00 confirmed（board）：确认并继续：2 组补交，核验通过，恢复队列
