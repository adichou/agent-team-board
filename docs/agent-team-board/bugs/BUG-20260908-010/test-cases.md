# 测试用例 — BUG-20260908-010 批量完善实时队列提前结束并漏掉重新接受条目

> 单测：`scripts/tests/refine-reaccept.test.mjs`（node 直跑，临时项目自清理）；
> 深测验收：`docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs` 的 D01/D03。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| V1 | 最后一项运行期间新接受的单：A fail/done 回执后 `checkRefineBatch` 吸收 B，`nextAction=continue`、计数把 B 计入 total/remaining，随后 next 领取到 B | P0 | ✅ |
| V2 | 同轮已 done 的 A 驳回再接受：next 先领到队列中其他候选（A 重排队尾），其余项收尾后 next 再次领到 A；按当前文档重冻结基线，A 补文档后 done 通过核验；执行记录中 A 有两条独立运行 | P0 | ✅ |
| V3 | fail 不重领：无再接受事件的条目 fail 后 next 领下一项（单候选批次则收尾 finished），不形成同轮无限重领 | P0 | ✅ |
| V4 | release 换单语义不回归：A release（interrupted）后 next 领到其他候选而非 A | P0 | ✅ |
| V5 | 人工编辑出局保护不回归：queued 条目冻结后被人工编辑 → 仍按 skipped 出局一次，next 不再重领（remaining=0 → finished） | P1 | ✅ |
| V6 | stop 语义不失效：全部处理完且无实时候选时 check 返回 `nextAction=stop`，批次 finished | P0 | ✅ |
| V7 | 移出计划回已接受（done 后 accepted→planned→accepted）：完善状态重置未完善，同样重新入队被再次领取 | P1 | ✅ |
| V8 | 深测夹具回归：deep-probes.mjs 中 D01、D03 转 PASS，D07/D08/D09/D10/D11 保持 PASS | P0 | ✅ |
| V9 | 既有回归：refine-store / refine-cli / refine-serve / refine-ui / tasks-refine 单测全部通过 | P0 | ✅（npm test 全量 94 个测试文件失败 0；新测试连续 15 次运行稳定） |
