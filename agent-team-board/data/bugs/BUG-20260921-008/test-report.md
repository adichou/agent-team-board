# 测试报告 — BUG-20260921-008 main 分支的提交历史只显示 main 分支的，不要和 dev 分支的合并显示

- 时间：2026-09-21T06:26:49.107Z
- 执行者：zcode-batch-059-10
- 测试框架：node:assert/strict + vm 自研 runner（真实临时 git 仓库）
- 覆盖率：8%

## 总结

main 分支提交历史改回单支口径：build-git.mjs 移除 BUG-20260920-002 引入的 main∪dev 并集（dualBranchScope/branchUnionLog 整段删除），branchLog/branchSearchLog 对所有分支（含 main/master 回退）一律单支可达集合（等价 git log <branch>），响应不再附 heads/mergeBase/side，搜索不再按双支 heads 名命中 side；已并入 main 的 dev 提交经合并提交自然可见；前端按载荷驱动保留双支渲染兼容路径（仅同步注释，无文案增删）。新增 scripts/tests/bug-20260921-008.test.mjs（B1-B7+R1 共 8 用例），同步 bug-20260920-002.test.mjs B1/B2/B4-B8、bug-20260921-006.test.mjs B2/B6/B7、req-20260921-002.test.mjs B5 断言与 server.mjs/build.js 注释；npm test 306 文件全通过。引入来源归因 BUG-20260920-002（design.md 已记）

## 明细

（可粘贴命令输出、失败用例说明等）
