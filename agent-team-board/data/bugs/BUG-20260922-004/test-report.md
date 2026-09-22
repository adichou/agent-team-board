# 测试报告 — BUG-20260922-004 确认记录被并发写回退：已确认（resolved）的提交挂起被旧进程滞留任务覆盖回 waiting 并抹掉 confirmed 事件

- 时间：2026-09-22T16:15:15.274Z
- 执行者：zcode-batch-064-2
- 测试框架：node:assert/strict（仓库自研测试模式，真实 git/HTTP 夹具）
- 覆盖率：5%

## 总结

确认记录并发写回退修复：confirm-store verify/continue 全写回点加过期写回守卫（重读盘面三方判定——归档换轮/终态过期拒绝不写回，resolved 幂等成功返回不复活 waiting，仍 waiting 同轮以最新记录为基座合并写回保并发事件）；verify 入口 resolved 幂等跳过；server 任务账本 touch 加过期进程守卫（taskId/状态易主不落盘，旧进程滞留回调不复活 interrupted）。新增 bug-20260922-004.test.mjs 5 用例先红后绿（含双服务进程复现旧进程滞留回写），直接相关 7 套件与全量 npm test 334 文件 0 失败。归因 BUG-20260915-008（异步化拉长读-改-写窗口）。

## 明细

（可粘贴命令输出、失败用例说明等）
