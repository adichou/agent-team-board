# 测试报告 — BUG-20260914-005 分支浏览里面的同步远端按钮文案改为“和远端同步”

- 时间：2026-09-14T04:10:46.630Z
- 执行者：zcode-batch-048-10
- 测试框架：node:assert/strict + vm 桩 DOM
- 覆盖率：6%

## 总结

分支浏览同步按钮文案「⟳ 同步远端」→「⟳ 和远端同步」（build.js renderBranchesPane，title 提示不变）；远端空态指称同步更新；i18n 词条更为「⟳ 和远端同步: ⟳ Sync with remote」（键含 ⟳ 前缀全文命中，旧键清理，修复英文界面降级）；行为零改动（fetch --all --prune / 同步中…禁用 / 成功失败 toast 维持现状，U3/U4 锁定）；新增 6 用例先红后绿；定向 i18n+build 回归与全量 run-all 通过（body-limit 偶发抖动已登记 BUG-20260914-007）；引入来源归因 REQ-20260913-001（commit 4b7d8a2，atb list 核验）

## 明细

（可粘贴命令输出、失败用例说明等）
