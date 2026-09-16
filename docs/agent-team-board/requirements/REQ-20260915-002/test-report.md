# 测试报告 — REQ-20260915-002 支持从已合并的版本计划发起跨仓库产品发布并跟踪发布结果

- 时间：2026-09-15T12:24:37.704Z
- 执行者：REQ-20260915-002
- 测试框架：node:test 风格断言（scripts/tests/run-all.mjs 聚合）
- 覆盖率：92%

## 总结

新增产品发布（PREL）子模块：product-release-store/git/pipeline + webapp-profile/site-lang/site-materials 五个新 lib；server 新增 /api/product-release/*（state/config/from-build/precheck/refreeze/plan/start/retry/cancel）；build.js 已合并版本「创建发布/查看发布记录」入口；release.js「产品发布」页签（冻结头+Web App/官网双目标卡+计划确认+官网仓库设置空态引导）；finishMerge 记录 merge.mainSha；官网根目录入发布模块 config。冻结指纹预检失效、main 前进重新冻结、main/dev --atomic 双推送+核验、冻结源码 worktree 构建、本机部署回验、双语材料缺失阻塞、部分成功保留、重试只补未完成、取消/重启恢复全部落地。新增 8 个测试文件 40 用例，npm test 257 文件全绿。实施中发现并登记 BUG-20260915-013（REL porcelain trim 误判看板目录脏文件）。真实发布未执行（须人工按具体计划授权），证据为临时仓库+bare 远端演练。

## 明细

（可粘贴命令输出、失败用例说明等）
