# 人工确认记录 — REQ-20260916-005 如果 main 分支不存在则使用 master 分支，以兼容历史仓库

> 由 atb 挂起确认机制维护（REQ-20260914-001）：自动提交不完整 / 分析问题挂起 → 人工核对与确认 → 恢复闭环全程留痕。请勿手改。

## 第 1 轮（当前） · 待人工确认 · 待人工确认提交

- 声明：2026-09-18T06:36:04.764Z（auto-commit） · 运行 run-20260918-281
- 原因：自动提交不完整：存在归属不明或暂扣待人工路径

- 已提交分组：
  - auto：doc: 如果 main 分支不存在则使用 master 分支，以兼容历史仓库 REQ-20260916-005（52b54bdc3b，0 个路径）
- 待人工核对路径（3）：scripts/server.mjs、scripts/web/app.js、scripts/web/i18n.js
- 暂扣待补交路径（10）：scripts/tests/bug-sync-main-release-note-20260914-017.test.mjs、scripts/tests/git-workflow-desc-20260912-001.test.mjs、scripts/tests/req-main-branch-fallback-20260916-005.test.mjs、scripts/lib/build-git.mjs、scripts/lib/build-store.mjs、scripts/lib/git-flow.mjs、scripts/lib/product-release-git.mjs、scripts/lib/product-release-pipeline.mjs、scripts/lib/product-release-store.mjs、scripts/web/build.js

事件留痕：
- 2026-09-18 06:36:04 declared（auto-commit）：自动提交不完整：存在归属不明或暂扣待人工路径
