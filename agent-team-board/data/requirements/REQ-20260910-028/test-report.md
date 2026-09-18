# 测试报告 — REQ-20260910-028 新建讨论时支持上传截图，和新建需求、bug 一样

- 时间：2026-09-10T16:22:13.097Z
- 执行者：zcode-batch-20260910-032-04
- 测试框架：node:assert 自研测试脚本（scripts/tests）
- 覆盖率：8%

## 总结

新建讨论同口径支持截图：createDiscussion 先全量校验再占号落盘 attachments/、question.md 追加引用行、启动提示词带截图位置；POST /api/discussion 透传附件并新增 GET /api/discussion/:id/attachment/:name；前端去掉讨论隐藏截图区块分支、带截图先过旧服务预检（atb serve 指引）再提交；讨论详情背景相对图接管+点击放大+失败占位。新增 8 用例全绿，两处旧口径断言按新口径修正，全量 176 测试文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
