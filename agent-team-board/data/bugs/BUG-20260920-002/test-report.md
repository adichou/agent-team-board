# 测试报告 — BUG-20260920-002 main 分支的 git log 显示需要优化

- 时间：2026-09-20T13:45:24.193Z
- 执行者：zcode-batch-054-1
- 测试框架：node:assert + vm（自研用例脚本）
- 覆盖率：20%

## 总结

分支浏览双支并集：build-git 新增 dualBranchScope/branchUnionLog（选中主分支或 dev 且两支并存时返回 main∪dev 并集 + heads/mergeBase/逐提交 side，其余单支口径不变，全程只读）；前端 logGraph 扩展 colorOf/mergeBase（分支稳定配色 main 蓝/dev 橙同 hash 恒同色、汇聚点标记 mbTo），渲染层分支头名称标签+外圈、Merge-base 虚线标注与水平汇聚线、详情区汇聚点标注、并集提示行；style.css 新样式类与 i18n 中英词条同步。新增 bug-20260920-002.test.mjs 20 用例（先红后绿），npm test 289 文件全绿；引入来源归因 REQ-20260913-001 × REQ-20260920-001（atb list 核验）。

## 明细

（可粘贴命令输出、失败用例说明等）
