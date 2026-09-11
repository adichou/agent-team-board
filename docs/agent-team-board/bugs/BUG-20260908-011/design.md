# 设计 — BUG-20260908-011 批量完善创建后人工编辑导致待领取条目被跳过

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260907-003（需求完善：待接受需求与 Bug 批量补全文档，`atb list` 核验存在，in-progress）。其 design.md「领取校验」明确定义了「指纹≠基线 → 记 skipped（人工编辑出局）」，即 `refine-store.mjs` 自首个版本就把**创建时冻结**的文档指纹当作领取出局门槛。当时候选是「待接受（submitted）」，人工编辑待接受单可理解为「人工已自行补全、无需再派」，出局尚合理；REQ-20260908-020 把候选切换为「已接受（accepted）且未完善」后，创建到领取之间的人工编辑（补充背景）正是期望输入，该门槛反噬主流程——深测 D02 发现（关联测试需求 REQ-20260908-020，不据此断言历史引入来源）。

## 根因分析

`scripts/lib/refine-store.mjs` 三处联动（行号为修复前）：

1. `createRefineBatch`（约 398–401 行）在**创建批次时**即用 `docsFingerprint(dir)` 冻结每个候选的基线；`absorbNewRefineCandidates`（约 573 行）吸收新候选时同样提前冻结。
2. `nextRefineItem`（约 622–624 行）领取前比对「当前指纹 === 冻结基线」，不一致即 `skipRun(..., '冻结后文档已被人工编辑，基线失效')`，条目直接落 `skipped` 终态。
3. 后果：批次创建到领取之间的人工编辑使指纹变化 → 条目被跳过；循环走完后无剩余候选，批次转 `finished`，`refine next` 返回 `stop: finished`，该已接受未完善单在本轮永远得不到处理。

而 done 回执的「文档确有变更」核验（`finishRefineRun`，约 708 行）复用同一 `cand.baseline`——基线的**本意**是防「无修改记完成」，却被提前挪用为领取门槛。

## 方案

全部改动收敛在 `scripts/lib/refine-store.mjs` 的 `nextRefineItem` 领取循环（+ 注释口径同步）：

- **删除领取指纹门槛**：移除「`docsFingerprint(dir) !== cand.baseline` → skipRun 出局」分支；创建/吸收时冻结的基线降级为**初始值**。
- **领取时重冻结**：条目通过目录与 accepted 校验后、`newRefineRun` 写运行前，`cand.baseline = docsFingerprint(dir)` 按当前文档重冻结；领取成功后原有的 `saveRefineBatch` 一并持久化（run / currentRunId / 新基线同批落盘）。
- **done 核验口径不变**：`finishRefineRun` 仍比对 `cand.baseline`（即领取时点基线）——领取后未改文档仍被「基线一致不能记完成」拒绝；`requeueReacceptedRefineItems`（BUG-20260908-010）的重冻结逻辑不动，且其重排队基线也会在真正领取时再次重冻结，两机制天然兼容。
- **既有出局条件不动**：目录损坏、离开 accepted 状态仍照旧 `skipRun` 出局；并发重复派发保护（已冻结条目不入新批的 `frozenBefore` 集合）不涉及指纹，不受影响。

**领取后、回执前的人工编辑与子代理编辑如何区分基线口径**（README 待确认项，定案）：**不区分，也无法区分**。文档指纹只能证明「内容变了」，不能证明「谁改的」（REQ-20260907-003 design.md 风险节即明确此能力边界）。核验口径统一为「相对**领取时点**基线确有变更」：领取后无论子代理补全还是人工追加，都算「领取后变更」，done 可记账；领取后无人改动则拒绝。该口径与完善任务的定位一致（完善 = 领取后把文档补起来，编辑者身份不影响记账语义）。

## 风险与边界

- **server.mjs codex 执行器 precheck 同款门槛未动**：`scripts/server.mjs` 的 `createRefineRunner` 仍有「指纹≠基线出局」与旧 `submitted` 口径，但 `refineRunnerFor` 在当前代码中无任何调用方（REQ-20260908-020 后完善仅走子代理模式），属未接线遗留，本单不触碰避免越界；后续接线时按领取时基线口径同步即可。
- **与 REQ-20260908-025（指纹算法版本化）正交**：该需求解决「算法演进使存量基线误失效」，本单解决「基线冻结时点」；两者叠加大方向一致（都弱化误出局），不冲突。
- **记账语义**：领取前人工已把文档补完整的情况，子代理领取后仍须再产生一次真实变更才能 done（否则 fail 出局由人工核对）；这是「领取后确有变更」口径的自然结果，主调度侧可通过 records 追溯。
- **原子性**：重冻结发生在内存 `cand` 上，由领取成功路径的 `saveRefineBatch` 持久化；若写运行中途异常，账本留在领取前状态（旧基线 + 无运行），下次领取按当次文档再次重冻结，无半写风险。

## 实施记录（zcode-batch-018-12，2026-09-08）

- `scripts/lib/refine-store.mjs`：`nextRefineItem` 领取循环删除指纹门槛、领取时重冻结 `cand.baseline`（写运行前，随领取成功的 `saveRefineBatch` 持久化）；同步头注 / `createRefineBatch` / `absorbNewRefineCandidates` / `reacceptedForRerun` 相关注释为新口径。
- 测试（TDD 先红后绿）：新增 `scripts/tests/refine-claim-baseline.test.mjs`（B1~B6，B1/B3/B4/B6 修复前红）；更新旧口径用例 refine-store R5（人工编辑不再出局）与 refine-reaccept V5（创建后被人工编辑不跳过、状态变化出局仍一次性），修复前均红。
- 验证：深测 D02 由 FAIL 转 PASS（D07~D11 保持 PASS；D04/D05/D06/D12 属 BUG-20260908-012/013/014/015 等其它缺陷单）；手工 CLI 路径（临时目录）走通「领取前编辑 → next 取单 → 无修改 done 被拒 → 补全后 done 记账（完成 1 · 出局 0）」；`npm test` 全量 95 个测试文件失败 0。
