# 人工确认记录 — REQ-20260916-005 如果 main 分支不存在则使用 master 分支，以兼容历史仓库

> 由 atb 挂起确认机制维护（REQ-20260914-001）：自动提交不完整 / 分析问题挂起 → 人工核对与确认 → 恢复闭环全程留痕。请勿手改。

## 第 1 轮（当前） · 待人工确认 · 待人工确认提交

- 声明：2026-09-18T06:36:04.764Z（auto-commit） · 运行 run-20260918-281
- 原因：自动提交不完整：存在归属不明或暂扣待人工路径

- 已提交分组：
  - auto：doc: 如果 main 分支不存在则使用 master 分支，以兼容历史仓库 REQ-20260916-005（52b54bdc3b，0 个路径）
- 待人工核对路径（3）：scripts/server.mjs、scripts/web/app.js、scripts/web/i18n.js
- 暂扣待补交路径（10）：scripts/tests/bug-sync-main-release-note-20260914-017.test.mjs、scripts/tests/git-workflow-desc-20260912-001.test.mjs、scripts/tests/req-main-branch-fallback-20260916-005.test.mjs、scripts/lib/build-git.mjs、scripts/lib/build-store.mjs、scripts/lib/git-flow.mjs、scripts/lib/product-release-git.mjs、scripts/lib/product-release-pipeline.mjs、scripts/lib/product-release-store.mjs、scripts/web/build.js
- 最近核验：2026-09-18 15:32:57 未通过
  - 仍有 2 个候选路径未入库（本单可归属 2 · 归属待确认 0）：agent-team-board/data/requirements/REQ-20260916-005/confirmations.md、scripts/tests/bug-async-verify-20260915-008.test.mjs——与面板计数同源

事件留痕：
- 2026-09-18 06:36:04 declared（auto-commit）：自动提交不完整：存在归属不明或暂扣待人工路径
- 2026-09-18 07:32:24 confirm-rejected（board）：测试未通过（npm test 退出码 null）：提交后内容验证失败
- 2026-09-18 07:38:24 terminal-supplement（board）：人工已在终端补交：scripts/lib/build-git.mjs、scripts/lib/build-store.mjs、scripts/lib/git-flow.mjs、scripts/lib/product-release-git.
- 2026-09-18 07:38:25 confirm-rejected（board）：路径 agent-team-board/data/requirements/REQ-20260916-005/confirmations.md 内容已变（确认时所见与当前不一致），请重新核对差异
- 2026-09-18 07:38:49 verified（board）：核验未通过（1 项；指纹基线刷新为当前内容）
- 2026-09-18 07:38:57 verified（board）：核验未通过（1 项；指纹基线刷新为当前内容）
- 2026-09-18 07:58:17 confirm-rejected（board）：测试未通过（npm test 退出码 null）：提交后内容验证失败
- 2026-09-18 09:33:26 verified（board）：核验未通过（2 项；指纹基线刷新为当前内容）
- 2026-09-18 13:55:24 task-interrupted（system）：服务重启，运行中的核验/确认任务已中断：结果未落账，请重新核验或确认
- 2026-09-18 13:56:21 terminal-supplement（board）：人工已在终端补交：scripts/tests/batch-ui.test.mjs、scripts/server.mjs
- 2026-09-18 13:56:21 confirm-rejected（board）：路径 agent-team-board/data/requirements/REQ-20260916-005/confirmations.md 内容已变（确认时所见与当前不一致），请重新核对差异
- 2026-09-18 13:56:31 terminal-supplement（board）：人工已在终端补交：scripts/tests/batch-ui.test.mjs、scripts/server.mjs
- 2026-09-18 13:56:31 confirm-rejected（board）：路径 agent-team-board/data/requirements/REQ-20260916-005/confirmations.md 内容已变（确认时所见与当前不一致），请重新核对差异
- 2026-09-18 13:56:39 terminal-supplement（board）：人工已在终端补交：scripts/tests/batch-ui.test.mjs、scripts/server.mjs
- 2026-09-18 13:56:39 confirm-rejected（board）：路径 agent-team-board/data/requirements/REQ-20260916-005/confirmations.md 内容已变（确认时所见与当前不一致），请重新核对差异
- 2026-09-18 13:56:55 verified（board）：核验未通过（1 项；指纹基线刷新为当前内容）
- 2026-09-18 15:06:39 confirm-rejected（board）：测试未通过（npm test 退出码 1）：提交后内容验证失败
- 2026-09-18 15:09:05 verified（board）：核验未通过（1 项；指纹基线刷新为当前内容）
- 2026-09-18 15:15:37 confirm-rejected（board）：测试未通过（npm test 退出码 1）：提交后内容验证失败
- 2026-09-18 15:32:57 verified（board）：核验未通过（1 项；指纹基线刷新为当前内容）
