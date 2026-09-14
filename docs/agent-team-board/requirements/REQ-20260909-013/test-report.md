# 测试报告 — REQ-20260909-013 隐藏文件模块

- 时间：2026-09-11T03:19:32.823Z
- 执行者：zcode-batch-035-5
- 测试框架：node:assert + node:vm
- 覆盖率：12%

## 总结

暂态隐藏讨论/文件模块：app.js 新增 HIDDEN_VIEWS 单开关门控 setView 深链快照兜底回落、详情讨论纪要页签/来源讨论行/req-disc 挂载、poll 的 oncall/req-disc 请求、搜索在文件查看入口；index.html 移除两导航按钮与新建 ask 选项；服务端与数据零改动，恢复步骤见 design.md。TDD：新测试 9/10 红转 10/10 绿；同步更新 17 个既有测试口径；npm test 191 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
