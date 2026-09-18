# 测试报告 — BUG-20260910-014 批量 Commit 功能需要有 UI

- 时间：2026-09-10T09:17:07.206Z
- 执行者：zcode-batch-031-22
- 测试框架：node:assert 自研 runner
- 覆盖率：100%

## 总结

任务模块新增批量 Commit 子面板（页签/启动区/运行面板二级页签/记录含逐个 hash 复制/提示词），server 新增 /api/commit/current·create·pause·abort·records·item-status，commit-store 新增 committedItemIndex；已完成条目列表徽标与详情显示未提交/已提交+完整提交号可复制、加载失败有重试不伪装未提交；归因 REQ-20260910-013（其 design 明确首期仅 CLI）。新增 commit-ui/commit-serve 两测试文件全绿，全量 155 文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
