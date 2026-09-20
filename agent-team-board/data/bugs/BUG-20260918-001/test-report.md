# 测试报告 — BUG-20260918-001 serve 轮询实时 git 扫描持 index.lock，与终端 git 写操作互相锁冲突

- 时间：2026-09-18T19:37:02.105Z
- 执行者：zcode-batch-049-006
- 测试框架：node:assert/strict
- 覆盖率：95%

## 总结

轮询链路只读 git 扫描统一注入 --no-optional-locks：git-flow.mjs gitRaw 覆盖 /api/confirms 清单/详情/diff 全部入口（workingTreeSnapshot/pathStates/fileDiffText），scheduler 工作区探针同注入，写命令不注入；实测定位完整持锁清单（status 全量扫描主犯 + diff 详情 + 调度探针）。新增 bug-20260918-001.test.mjs 6 用例（并发 index.lock 忙循环监视实测 / argv 注入面 / 写链路不变 / 口径一致 / 持锁容错），TDD 先红后绿；npm test 277 文件失败 0。归因 BUG-20260915-003（实时扫描接入轮询；底层 gitRaw 源自 REQ-20260911-009）。

## 明细

（可粘贴命令输出、失败用例说明等）
