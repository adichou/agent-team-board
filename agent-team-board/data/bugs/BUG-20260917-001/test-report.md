# 测试报告 — BUG-20260917-001 版本计划发布后，左侧的列表中没有显示版本计划已发布的标签

- 时间：2026-09-17T07:30:39.975Z
- 执行者：atb-0917-823b
- 测试框架：Node assert + vm 桩 DOM + 真实 server HTTP（run-all 自研 harness）
- 覆盖率：85%

## 总结

发布成功后左侧版本卡片显示绿色「已发布」：/api/build/state 按版本附 release 汇总（build-publish-store 新增 publishedByBld：任一 succeeded 运行即 published，取最新成功运行 runId/version；读取异常降级 null 不阻塞），build.js 卡片标签经 versionChip 在 published 时替换为 st-ok「已发布」（title 带运行编号，未发布保持四态与按钮规则），发布动作/刷新状态完成后追加 refresh() 使标识免手动刷新页面联动；详情概况与发布页签行为不变。引入来源归因 BUG-20260916-001（atb list 核验）。新增 7 用例先红后绿，全量 264 测试文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
