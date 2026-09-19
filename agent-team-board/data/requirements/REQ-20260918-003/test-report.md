# 测试报告 — REQ-20260918-003 clone 后从 git 历史重建看板状态（atb rebuild）

- 时间：2026-09-19T01:32:53.069Z
- 执行者：zcode-batch-050-003
- 测试框架：node:assert + 仓内 run-all
- 覆盖率：90%

## 总结

新增 atb rebuild：扫描 data/ 条目目录（含嵌套 Bug），复用 commit-store gitLogMessages/itemCommittedInGit 只读口径按「git 历史消息含单号」判定 done / 无提交痕迹判 submitted，原子写 runtime/status/<ID>.json（结构与现有一致，history by=atb-rebuild 留痕）；活看板状态非空拒绝重建、中断重跑幂等补齐不翻转不重复追加；CLI 输出逐条依据（hash+主题/无提交痕迹）与汇总计数并登记 usage；对 git 全程只读。测试 scripts/tests/req-20260918-003.test.mjs 9 用例全过，npm test 全量 281 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
