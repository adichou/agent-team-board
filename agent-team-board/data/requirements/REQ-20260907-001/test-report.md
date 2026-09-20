# 测试报告 — REQ-20260907-001 Oncall 咨询看板：咨询单创建、批量/单条派单回复，富文本与截图展示，支持 zcode 与 codex

- 时间：2026-09-06T18:52:18.217Z
- 执行者：zcode-batch-003-01
- 测试框架：node:assert 脚本测试（npm test / run-all 聚合）
- 覆盖率：82%

## 总结

Oncall 咨询看板全链路：新增 lib/oncall-store.mjs（ASK 独立序列、pending/answering/answered/failed 状态流转、追问轮次、附件图片白名单≤8MB、派单账本）；CLI atb oncall new/list/show/ask/answer/dispatch（zcode 主调度提示词含会话命名指令 oncall-日期-客服）；server 增 /api/oncall/* 与 codex 后台执行器（复用 startCodexExec，final-message 自动回传、失败分类记因、串行执行、不占 impl.lock）；前端 web/oncall.js Oncall 视图（列表状态筛选、新建含截图上传与粘贴、批量派单客服人员记忆、详情 Markdown 渲染+内联截图+点击放大、单条问询追问、失败重派、codex 未就绪隐藏入口）。新增 6 个测试文件 16 用例全绿，全量 56 个测试文件回归 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
