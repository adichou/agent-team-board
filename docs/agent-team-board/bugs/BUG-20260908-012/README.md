# BUG-20260908-012 动态候选变化后重复启动完善任务不幂等

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-08T12:13:46.868Z

## 现象

REQ-20260908-020 深测发现（D04）。接受 A 并创建任务，再接受 B 并重复创建，产生两个未结束任务。需求用例27要求单进行中任务与重复启动幂等。 复现：node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs。原始结果：同目录 deep-probes.log。

实测（deep-probes.log 第 18-21 行）：第二次 `createRefineBatch` 未幂等返回原批次，而是新建 `RFB-20260908-002`，`unfinishedRefineBatches` 返回 `["RFB-20260908-001","RFB-20260908-002"]` 两个未结束批次，断言 `again.batchId === b.batchId` 失败。

初步定位方向（修复阶段在 design.md 归因确认）：`scripts/lib/refine-store.mjs` 的 `createRefineBatch`「同模式队尾幂等」分支要求队尾批次冻结候选 id 列表与当前新鲜候选完全一致才幂等返回；新增候选 B 后两者不一致，判断不成立，落入「新候选」分支新建了第二个批次——与 REQ-20260908-020「每轮实时读取全部已接受单、创建任务后新接受的单自动进入本轮处理范围」的口径冲突（用例 4），也违反用例 27 的单进行中任务与重复启动幂等。

## 复现步骤

方式一（推荐，一键脚本，使用独立临时项目，不污染真实数据）：

1. 在项目根目录执行：`node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`
2. 查看输出中用例 `D04 新候选加入后重复启动应返回同一进行中任务`：结果为 FAIL，actual 为 `["RFB-20260908-001","RFB-20260908-002"]`（存在两个未结束批次）。

方式二（夹具 D04 的等效步骤，对应 CLI 人工路径）：

1. 准备一个已接受（accepted）且未完善的单 A（如 `atb new req "深测项"` 后 `atb status <ID> accepted`）。
2. `atb refine create` 创建完善任务 → 得批次 RFB-…-001（此时 A 未领取，批次未结束）。
3. 再创建并接受一个新单 B（`atb new req "新候选"` + `atb status <ID> accepted`）。
4. 在批次 RFB-…-001 未结束（尚有剩余项或在途运行）时再次 `atb refine create`。
5. 观察：实际新建了 RFB-…-002，与 001 并存为两个未结束完善批次（可由 `atb refine summary` / `docs/agent-team-board/refine/batches/` 下两个 `status ≠ finished` 的 batch.json 验证）。

## 期望行为

- 同一项目同一时刻只允许一个进行中的完善任务（REQ-20260908-020 用例 27：重复创建幂等返回不新建）。
- 已有未结束完善批次时再次 `refine create`，无论候选列表是否较创建时点新增，均幂等返回同一进行中批次（`created: false`），不产生第二个未结束批次。
- 新接受的单 B 不应触发新建批次，而是由原批次后续每轮 `refine next` 实时读取吸收进本轮处理范围（REQ-20260908-020 用例 4：候选 = 全部已接受单，每轮实时读取；文档基线仍按项领取时冻结）。
- 既有口径不回退：候选完全一致时的幂等返回、无候选时的报错提示（「没有可完善候选…」/「均已进入更早的未结束完善任务」）维持不变。

## 验收说明

- 深测用例 D04 转绿：`node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs` 中 D04 结果 PASS（`again.batchId === b.batchId`）。
- 重复启动幂等：未结束批次存在且候选有新增时再次创建，返回 `{ batch: <原批次>, created: false }`；`unfinishedRefineBatches` 始终只有一个该模式批次，`docs/agent-team-board/refine/batches/` 不新增未结束 batch.json。
- 新候选吸收：幂等返回后继续 `atb refine next`，新接受的单 B 在后续领取轮被领取并处理（每轮实时读取口径），且 A、B 均保持 accepted 状态。
- 回归：候选完全一致时的幂等返回、无新候选时的报错文案（`scripts/lib/refine-store.mjs` `createRefineBatch` 抛出的 AtbError 口径）、`--ids` 指定范围的创建路径均不受影响；REQ-20260908-020 用例 27 按原验收标准复验通过。
- 与相关 Bug 的边界：本 Bug 只针对「候选变化后重复启动不幂等」；codex 标识混用（BUG-20260908-013）、终止面板（D06）等 D 系列其他失败项不在本单范围。
