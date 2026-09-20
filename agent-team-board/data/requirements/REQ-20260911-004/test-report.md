# 测试报告 — REQ-20260911-004 在设置中支持对 commit 到 git 的目录进行设置，默认只 commit 源代码相关目录

- 时间：2026-09-11T08:47:28.123Z
- 执行者：zcode-batch-038-1
- 测试框架：node:assert + npm test (run-all.mjs)
- 覆盖率：82%

## 总结

设置新增批量Commit提交目录范围白名单:tasks/settings.json commit分区(宽松读/严格存,默认=源代码目录+docs/+根级文件);批次创建冻结scope并注入提示词,next摘要同源,done核验严格拒绝范围外文件;服务端透传;设置页批量Commit分区(两组复选框+恢复默认+空态警示+三态保存);新增10用例先红后绿,npm test 194文件零回归,详见test-report.md

## 明细

（可粘贴命令输出、失败用例说明等）
