# BUG-20260908-011 批量完善创建后人工编辑导致待领取条目被跳过

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-08T12:13:46.766Z

## 现象

REQ-20260908-020 深测发现（D02）。创建任务后、领取前追加 README，next 返回 finished 并将条目标记 skipped。应在领取时建立文档基线，继续处理 accepted 未完善单。 复现：node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs。原始结果：同目录 deep-probes.log。

## 根因定位（完善阶段基于源码，修复时可复核）

- `scripts/lib/refine-store.mjs` 的 `createRefineBatch`（约 398–401 行）在**创建批次时**就用 `docsFingerprint(dir)`（README/design/test-cases 三文档内容 sha1，约 195–206 行）冻结每个候选的基线；`absorbNewRefineCandidates`（约 573 行）吸收新候选时同样提前冻结。
- `nextRefineItem`（约 622–624 行）领取前比对「当前指纹 === 冻结基线」，不一致即 `skipRun(dataDir, batch, cand, '冻结后文档已被人工编辑，基线失效')`，条目直接落 `skipped` 终态。
- 后果：批次创建到领取之间的人工 README 编辑会让指纹变化，条目被跳过；循环走完后无剩余候选，批次转 `finished`，`refine next` 返回 `{ stop: 'finished', counts: { ..., skipped: 1, remaining: 0 } }`，该已接受未完善单在本轮永远得不到处理。
- done 回执的「文档确有变更」核验（`finishRefineRun`，约 708 行）复用同一 `cand.baseline`，说明该基线的本意是防「无修改记完成」，却被提前用作领取门槛。

## 复现步骤

方式一（自动化深测，推荐）：

1. 执行 `node /Users/adichou/Documents/src/agent-team-board/docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`（夹具只写临时目录，结束后自清理）。
2. 观察用例 `D02 创建后、领取前人工完善 README，仍应按领取时基线取单`：FAIL，actual 为 `{"stop":"finished","counts":{"total":1,"done":0,"failed":0,"skipped":1,"interrupted":0,"remaining":0}}`。
3. 原始失败记录：同目录 `deep-probes.log`（D02 条目）。

方式二（CLI 手工复现，在任意临时目录用 `--dir` 指向）：

1. `node scripts/atb.mjs init` 初始化临时看板数据目录。
2. `node scripts/atb.mjs new req "复现用需求"`，再 `node scripts/atb.mjs status <REQ-ID> accepted` 人工接受（新单 README 缺节，属已接受未完善候选）。
3. `node scripts/atb.mjs refine create` 创建完善任务——此刻冻结该条目的文档指纹基线。
4. 领取前手工在条目目录 `docs/agent-team-board/requirements/<REQ-ID>/README.md` 末尾追加一行任意内容（模拟人工编辑）。
5. `node scripts/atb.mjs refine next --by test`：实际返回 `stop: finished`，计数 `skipped: 1`；条目未被领取，完善状态停留在「未完善」，批次已结束。

## 期望行为

- 文档指纹基线应在**领取时**（`nextRefineItem` 派发该项、写入运行前）建立，而不是创建批次时冻结后直接当领取门槛。
- 批次创建后、领取前的人工编辑不应导致条目被跳过：`refine next` 应正常返回该条目（runId / itemDir / reasons 等），条目完善状态置「完善中」。
- done 回执的「文档确有变更」核验以**领取时基线**为准：子代理领取后编辑过文档才能记完成；若子代理领取后未做任何修改，仍应拒绝（沿用现有「基线一致不能记完成」语义）。
- 既有其它跳过条件不因本修复改变：条目目录损坏、或条目已离开 accepted 状态时照旧出局落账。
- 领取后、回执前的人工再次编辑与子代理编辑如何区分基线口径，修复阶段在 design.md 明确（当前无法从源码确认，待确认）。

## 验收说明

- 重跑 `deep-probes.mjs`：用例 D02 由 FAIL 转 PASS（`next.itemId` 等于被人工编辑过的条目 ID，不再返回 `stop: 'finished'`、不再产生 skipped 记录）。
- 手工路径：按「复现步骤·方式二」执行到第 5 步，`refine next` 返回该条目；随后真实补全文档并 `refine done <RUN-ID> --summary "…"` 能成功记账；若领取后未改文档，`refine done` 仍被「文档内容与冻结基线一致」拒绝（回归不变）。
- 批次账目正确：该条目计入 done（或 failed），counts 中不再出现本场景造成的 skipped；`refine records` 可见该条目的正常运行记录。
- 不破坏既有保护：并发重复派发保护（已冻结条目不入新批）、条目离开 accepted 后跳过、目录损坏跳过等行为保持不变（相关探针 D07–D11 仍 PASS；D01/D03–D06/D12 属其它缺陷单范围，不以本单验收为准）。
