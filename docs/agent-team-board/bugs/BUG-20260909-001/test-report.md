# 测试报告 — BUG-20260909-001 开发任务终止后看板不显示「已终止」口径：/api/batch/current 未透出 aborted 字段

- 时间：2026-09-09T00:17:30.417Z
- 执行者：zcode-batch-019-1
- 测试框架：node:assert（scripts/tests/run-all.mjs 聚合）
- 覆盖率：90%

## 总结

atb.mjs batchPublicView 与 server.mjs /api/batch/current 的 batch 视图按 Boolean() 归一化补公开 abortRequested/aborted：终止批次 true、存量缺字段/运行中/暂停/自然结束 false 不误判；queue 维持原口径（abortBatch 原子落 finished，终止批次恒不入队，理由见 design.md）；前端零改动（renderZcodeBatchPanel 已依赖 b.aborted）。新增 tests/batch-abort-view.test.mjs（真实 HTTP 服务 + CLI 子进程双路径）先跑红后跑绿，batch-cli Z14b 过时注释修正并加强为字段透出断言；全量 101 个测试文件 0 失败。引入来源归因 REQ-20260908-020（atb list 核验存在）。

## 明细

### TDD 过程（先红后绿）

新增 `scripts/tests/batch-abort-view.test.mjs`（真实拉起 server.mjs 子进程 + 真实 atb.mjs CLI 子进程，非手工传参渲染函数）：

1. 跑红（修复前，两用例均因公共视图缺字段失败）：
   ```
   ✗ HTTP：终止批次 /api/batch/current 透出 abortRequested/aborted=true；存量与自然结束为 false；终止批次不入队
       abortRequested 应为布尔型
   ✗ CLI：batch summary --json 公开视图透出布尔化终止字段（终止 true / 自然结束与运行中 false）
       summary batch.abortRequested 应为布尔型
   2 个用例未通过
   ```
2. 实现修复（`scripts/atb.mjs` batchPublicView、`scripts/server.mjs` /api/batch/current batch 视图各补两个 Boolean 字段）后跑绿：
   ```
   ✓ HTTP：终止批次 /api/batch/current 透出 abortRequested/aborted=true；存量与自然结束为 false；终止批次不入队
   ✓ CLI：batch summary --json 公开视图透出布尔化终止字段（终止 true / 自然结束与运行中 false）
   全部通过
   ```

### 用例覆盖点

- HTTP current：终止批次（abort 后回退展示同一批次）`abortRequested/aborted === true` 且类型布尔、`status === 'finished'`；终止批次不回到未结束 queue；存量缺字段（创建未终止时）两字段布尔型且 false；自然收尾批次（库层驱动全部回执）两字段 false 不误判。
- CLI：`batch summary --json` 待启动 false / 终止后 true；`batch pause --json`（共用 batchPublicView）正常批次 false；自然结束 false。
- 既有断言加强：`batch-cli.test.mjs` Z14b「aborted 不在公共视图」过时注释修正为透出断言（`abortRequested/aborted === true`）。

### 全量回归

`node scripts/tests/run-all.mjs`：共 101 个测试文件，失败 0（含既有 batch-serve/batch-queue/batch-ui U16 等终止口径用例，无回归）。

### 引入来源

REQ-20260908-020（经 `atb list` 核验存在；项目非 git 仓库无提交历史，归因依据代码内 REQ 标注注释与看板核验），详见 design.md「引入来源（源单）」。
