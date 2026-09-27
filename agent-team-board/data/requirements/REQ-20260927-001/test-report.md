# 测试报告 — REQ-20260927-001 只需需求或 bug 创建时同步提交到 git。

- 时间：2026-09-27T02:11:58.936Z
- 执行者：atb-0927-6c3d
- 测试框架：node:test 风格分层测试（run-all.mjs 聚合）
- 覆盖率：90%

## 总结

创建即留痕：git-flow 新增 commitItemCreation（复用 commitPaths 内核，路径 --only 限定条目目录，消息 doc: 创建条目 <单号>，只 commit 不 push；失败/非 git/无差异/目录不存在均不阻断不空提交），atb new、POST /api/new、oncall.createItems、marketing.linkActivityReq 四通道统一接线并回显 gitCommit；rebuild 经 isItemTraceCommitSubject 排除创建/删除留痕提交防误判 done；不写 commits 账本（atb commit log 走 git 历史可检索）；新增 req-20260927-001.test.mjs 16 例先红后绿，npm test 全量 360 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
