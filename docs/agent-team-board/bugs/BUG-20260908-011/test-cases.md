# 测试用例 — BUG-20260908-011 批量完善创建后人工编辑导致待领取条目被跳过

> 单测：`scripts/tests/refine-claim-baseline.test.mjs`（node 直跑，临时项目自清理）；
> 深测验收：`docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs` 的 D02。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | 创建批次后、领取前人工编辑（追加 README）→ `nextRefineItem` 正常返回该条目（非 `stop:finished`）、不产生 skipped、完善状态置「完善中」；随后补全文档 done 记账，counts done=1 / skipped=0 / remaining=0（D02 主场景） | P0 | ✅ |
| B2 | done「文档确有变更」核验以领取时基线为准：领取后未改文档 → done 仍被拒（「基线一致不能记完成」语义不回归）；改文档后通过 | P0 | ✅ |
| B3 | 领取时重冻结基线并持久化：账本 `cand.baseline` 从创建时点指纹更新为领取时点（编辑后）指纹 | P0 | ✅ |
| B4 | 吸收路径同样不作为领取门槛：round1 吸收的候选 B 在 round2 领取前被人工编辑 → 仍正常领取 B、无 skipped（吸收时冻结的基线不再当门槛） | P0 | ✅ |
| B5 | 领取后在途期间的人工编辑与子代理编辑不区分：领取后任何变更都算「领取后变更」，done 核验通过 | P1 | ✅ |
| B6 | 既有出局条件与账目不回归：目录损坏 / 离开 accepted 照旧 skipped 出局一次（不重领），被人工编辑的条目正常领取并计入 done，counts 正确 | P0 | ✅ |
| B7 | 旧口径用例更新：refine-store R5（人工编辑不再出局，改断言正常领取+done）、refine-reaccept V5（创建后被人工编辑不跳过；状态变化出局仍一次性） | P0 | ✅ |
| B8 | 深测夹具回归：deep-probes.mjs 中 D02 转 PASS；D07~D11 保持 PASS（D04/D05/D06/D12 属其它缺陷单，不以本单验收） | P0 | ✅ |
| B9 | 手工 CLI 路径（临时目录）：init → new req → accepted → refine create → 领取前追加 README → refine next 返回该条目；领取后未改文档 done 被拒；补全后 done 记账，check 计数 完成 1 · 出局 0 · 待处理 0 | P1 | ✅ |
| B10 | 既有回归：npm test 全量通过（95 个测试文件，失败 0） | P0 | ✅ |
