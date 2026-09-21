# 测试报告 — BUG-20260921-007 分支浏览中的分支提交记录在第三页后就无法显示数据了，请修复。而且第二页的 dev 分支应该是黄色的，却变成了蓝色，请修复。

- 时间：2026-09-21T04:19:25.244Z
- 执行者：zcode-batch-059-06
- 测试框架：node:assert/strict + vm 自研 runner
- 覆盖率：10%

## 总结

修复提交树翻页两缺陷（同源）：gitgraph import 只渲染「ref 首父链可达 ∪ 合并闭包」提交且按页内出现序配色——treeData 改为双支 side 每侧锚定+严格同侧显示序链（整页零丢弃）、单支保真+页外断层续锚、createGitgraph 传 compareBranchesOrder 与按 side 排头色板（main 恒蓝/dev 恒黄）、mountTree 增异步渲染保底降级行式列表；新增 10 例测试+3 处既有口径断言同步，npm test 302 文件全过；真实数据终验 union 8 页 399 条/main 342/dev 347、20/100 每页与搜索子集零丢弃零错染；引入来源归因 REQ-20260921-002（design.md）

## 明细

（可粘贴命令输出、失败用例说明等）
