# 测试报告 — BUG-20260921-006 分支浏览中 dev 分支只需要显示 dev 分支的提交就行，请修改

- 时间：2026-09-21T03:31:20.690Z
- 执行者：zcode-batch-059-05
- 测试框架：node:test 风格自研断言（scripts/tests 单文件）
- 覆盖率：8%

## 总结

分支浏览 dev 改回单支口径：dualBranchScope 仅主分支（main/master 解析结果）走 main∪dev 并集，dev 及其余分支一律单支（git log dev），branchLog/branchSearchLog 列表·分页·搜索双模式数据集一致收窄，响应不再附 heads/mergeBase/side；前端按载荷驱动，dev 视图并集提示/main 头标签/merge-base 标注自然消失（仅同步注释，无文案增删）。引入来源归因 BUG-20260920-002（design.md 已记）。新增 scripts/tests/bug-20260921-006.test.mjs（B1-B7+R1 共 8 用例），同步更新 bug-20260920-002.test.mjs B2/B4（原 dev 对称性断言）与 req-20260921-002.test.mjs B5 措辞；npm test 301 文件全通过。

## 明细

（可粘贴命令输出、失败用例说明等）
