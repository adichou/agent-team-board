# 测试报告 — REQ-20260927-004 合并视图需区分对合入 main 无影响的提交（明确告知或不展示）

- 时间：2026-09-27T14:29:42.092Z
- 执行者：zcode-batch-081-1
- 测试框架：node:test 自研断言（scripts/tests/run-all.mjs）
- 覆盖率：100%

## 总结

未选祖先按变更文件静态分类：全部落在根第一层发布文档集合（五类标准文档+语言变体+v.customDocs 展开）判为发布文档提交，analyzePublishIsolation 单列 docAncestors（hash 去重附归属条目），X/M 分开计数、notes 分列去向；server 传 langs/customDocs；合并步前端汇总行合并为一句完整文案（X 只统计源码祖先），新增发布文档提交折叠行（默认收起、徽标颜色+文字、只读、50 条截断分别生效），X=0 且 M>0 空态不出现空源码明细；i18n 中英同步、旧词条随文案合并移除；新增 req-20260927-004.test.mjs 12 例先红后绿，npm test 364 文件失败 0；分类只读不改 cherry-pick 执行语义

## 明细

（可粘贴命令输出、失败用例说明等）
