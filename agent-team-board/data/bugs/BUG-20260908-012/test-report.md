# 测试报告 — BUG-20260908-012 动态候选变化后重复启动完善任务不幂等

- 时间：2026-09-08T15:21:00.782Z
- 执行者：zcode-batch-018-1
- 测试框架：node:assert 脚本测试（run-all 全量回归 + 深测夹具）
- 覆盖率：100%

## 总结

refine createRefineBatch 同模式幂等改为按进行中任务判断：已有同模式未结束批次一律幂等返回（created:false），不再要求候选一致；新候选由原批次每轮 next 吸收。D04 转绿；R3/R4 改写+R4b 新增锁跨模式口径；--ids 路径与报错文案不变；全量 95 个测试文件 0 失败。

## 明细

- 修复前（红）：深测 D04 FAIL（重复 create 新建 RFB-…-002，`unfinishedRefineBatches` 两个未结束批次）；
  改写后的 R3/R4 单测在旧实现上亦失败，确认用例有效锁定期望行为。
- 修复后（绿）：
  - `node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`：D04 **PASS**
    （TOTAL 12 / PASS 9 / FAIL 3；D05、D06、D12 分属 BUG-20260908-013/014/015，不在本单范围）。
  - `node scripts/tests/refine-store.test.mjs`：22 个用例全部通过——
    R3（--ids 过滤 + 整批创建冻结全量候选 + 勾选批未结束时整批创建幂等返回）、
    R4（候选一致与候选新增均幂等返回同一批次；新接受的 r3 在后续领取轮被原批次吸收处理；条目全程 accepted；
    批次收尾 stop=finished）、R4b（跨模式：已冻结条目不入其他模式新批、「均已进入更早的未结束完善任务」
    报错口径保留、排队批次不得抢先领取）。
  - `node scripts/tests/refine-cli.test.mjs`、`node scripts/tests/tasks-refine.test.mjs`：全部通过。
  - `node scripts/tests/run-all.mjs`：**95 个测试文件，失败 0**。
- CLI 人工路径复核（临时项目，等效 README 复现方式二）：接受 A → `atb refine create` 得 RFB-…-001；
  接受 B 后重复 `atb refine create` 输出 `= 已有未结束完善批次（幂等返回，未新建）：RFB-…-001`，
  `docs/agent-team-board/refine/batches/` 下仅一个未结束 batch.json（候选 B 由下一轮 `refine next`
  实时吸收，单测 R4 覆盖）。
- 改动面：`scripts/lib/refine-store.mjs`（createRefineBatch 同模式幂等判断 + 注释）、`scripts/atb.mjs`
  （幂等输出文案）、`scripts/web/app.js`（幂等 toast 文案）；`--ids` 勾选路径、跨模式并发保护、
  无候选报错口径均未变化。

