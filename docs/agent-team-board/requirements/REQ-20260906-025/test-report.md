# 测试报告 — REQ-20260906-025 批次排队：执行中可继续创建新批次，结束后自动接续下一批

- 时间：2026-09-06T18:33:08.279Z
- 执行者：zcode-batch-003-1
- 测试框架：node:assert + CLI/serve 集成 + UI 静态契约
- 覆盖率：90%

## 总结

批次排队：未结束批次构成项目级 FIFO 单队列；createBatch 有未结束批次时新建入队（冻结创建时点新候选、排除前序已冻结条目、队尾候选一致幂等返回、旧空批就地收尾）；batch next/check/summary/pause/records 与 serve 缺省批次解析改为队首（全结束回退最新）；nextItem 防抢先领取；checkBatch 真正收尾的 stop 携带 nextBatch 自动接续（暂停不带）；generatePrompt 模板含接续说明；UI 抽屉排队列表+排队中标签+入队 toast+轮询签名计入 queue。新增 batch-queue.test.mjs Q1-Q10 全过；全量 50 测试文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
