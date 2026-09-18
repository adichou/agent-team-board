# 测试报告 — REQ-20260911-010 回退批量 Commit 的相关功能，但需保留已完成需求的 commit 号显示这个功能

- 时间：2026-09-11T17:40:00.507Z
- 执行者：zcode-batch-040-4
- 测试框架：node:assert/strict + 真实 git 临时仓库/服务进程子进程集成 + 前端 vm/静态契约（run-all.mjs 聚合）
- 覆盖率：90%

## 总结

回退人工批量Commit：commit-store裁剪为共享内核；atb commit旧命令组明确报错零副作用；服务端5路由404，item-status换源REQ-009索引（git-flow批量索引，一commit可关联多单号）；看板移除批量Commit页签/已完成档快捷入口/全局CMT简报，徽标四态保留；guard去CMT豁免。新增回退测试12例，全量203文件通过。

## 明细

（可粘贴命令输出、失败用例说明等）
