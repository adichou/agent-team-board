# 测试报告 — REQ-20260923-004 删除需求需要同步提交

- 时间：2026-09-23T14:45:46.681Z
- 执行者：zcode-batch-067-2
- 测试框架：node:test 风格分层测试（run-all.mjs 聚合）
- 覆盖率：90%

## 总结

删除即留痕：git-flow 新增 commitItemDeletion（复用 commitPaths 内核，git add -A + commit --only 只提交被删目录差异，消息 doc: 删除待接受条目 <单号>，只 commit 不 push；realpath 归一兼容 macOS /var 符号链接），CLI atb delete 与服务端 DELETE /api/item/:id 同口径接入，UI toast 按 gitCommit 三分支反馈（短号/警告+补提交指引/跳过说明）并同步 i18n 词典；失败不回滚、非 git 跳过、未入库不空提交；新增 req-20260923-004.test.mjs 10 例先红后绿，item-delete 回归 + i18n 覆盖通过，npm test 全量 340 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
