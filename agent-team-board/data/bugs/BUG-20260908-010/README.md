# BUG-20260908-010 批量完善实时队列提前结束并漏掉重新接受条目

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260908-020（批量完善重构引入：实时候选吸收只挂在领取入口，check/收尾仍按创建时快照判 stop；finalByItem 历史终态不识别「驳回再接受」重置，重领也未重冻结文档基线）
- 创建：2026-09-08T12:13:46.653Z

## 现象

REQ-20260908-020 深测发现（D01/D03）。最后一项运行期间新接受 B，A 回执后 check 返回 stop，B 遗漏；同轮已完善 A 驳回再接受仍被 finalByItem 排除。应在核对时吸收实时候选并识别重新接受。 复现：node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs。原始结果：同目录 deep-probes.log。

具体两个表现（均违背 REQ-20260908-020「每轮实时读取全部已接受单」的口径）：

1. **最后一项运行期间新接受的单被遗漏（D01）**：批量完善任务只剩最后一项 A 在途时，人工把新单 B 置为已接受；A 回执后主调度 `atb refine check` 返回 `nextAction: "stop"`（notice「本批完善范围已处理完毕…」）、批次转 finished，主调度按提示词「stop 时结束」收工——B 从未被本任务处理，需重新启动新任务才能补上。
2. **同轮驳回再接受的单不被再次领取（D03）**：条目 A 在本轮 `refine done` 后（完善徽标「已完善」）被人工驳回回待接受、再次接受——完善状态已按 REQ-20260908-020 重置为「未完善」，`refineCandidates` 也会重新纳入；但 `atb refine next` 仍跳过 A，队列耗尽后返回 `stop: "finished"`，A 在本轮内不会被再次完善。

代码定位（scripts/lib/refine-store.mjs）：

- 实时候选吸收 `absorbNewRefineCandidates`（约 562 行起）只在 `nextRefineItem`（约 594 行）被调用；`checkRefineBatch`（约 837 行）与 `finishRefineRun` 的收尾判定（约 734 行）只按创建时冻结的 `batch.candidates` 快照计算 `counts.remaining`（约 513 行）。运行中新接受的 B 不在快照内 → `remaining === 0` → check 提前判 stop。
- 领取循环（约 607-608 行）用 `finalByItem`（本批已有终态回执的条目集合）跳过候选，不校验条目当前完善状态是否已被重置回「未完善」（重置逻辑在 scripts/lib/core.mjs 约 576-578 行，进入 accepted 时置「未完善」，该侧重置本身正常）；且 `absorbNewRefineCandidates` 的 `known` 集合含本批已有候选，重新接受的 A 不会被当作新候选重新吸收。
- 即便 A 重新进入领取循环，其候选 `baseline` 仍是创建/吸收时冻结的旧指纹，而上一轮 done 已修改过文档，会在约 622 行被误判「冻结后文档已被人工编辑，基线失效」而出局——修复时对重新接受的条目需按其当前文档重新冻结基线。

## 复现步骤

前置：Node 环境；命令在仓库根目录执行；夹具仅写系统临时目录并在结束后自清理，不修改真实条目状态。

方式 A —— 深测夹具（推荐，一键）：

1. 执行：`node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`
2. 查看输出 JSON：
   - 用例 D01「最后一项执行期间新接受单，主调度 check 应继续」→ FAIL，actual 为 check 返回 `{"status":"finished",…,"counts":{"total":1,…,"remaining":0},"nextAction":"stop"}`——运行中新接受的「在途时新接受」条目完全不在计数内。
   - 用例 D03「同轮已完成单驳回再接受，应再次进入本轮」→ FAIL，actual 为再次领取直接返回 `{"stop":"finished","counts":{"total":2,"done":1,"failed":1,…,"remaining":0}}`，未回到被重新接受的 A。
3. 原始输出存档：`docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.log`（TOTAL 12; PASS 5; FAIL 7——其中 D01/D03 即本 Bug，D02/D04/D05/D06/D12 分别对应 BUG-20260908-011/012/013/014/015，不属本条）。

方式 B —— CLI 手工复现（在临时/测试项目内执行，atb 指 `node scripts/atb.mjs`，均带 `--dir <项目路径>`）：

场景一（对应 D01）：

1. 建条目 A 并流转已接受（`atb new req 复现A` → `atb status <A-ID> accepted`），`atb refine create` 创建完善任务，`atb refine next --by repro` 领取 A 得 RUN-A。
2. A 执行期间，人工把另一条目 B 流转为已接受（`atb status <B-ID> accepted`，或看板「接受」）。
3. A 回执：真实修改 A 的条目 README 后执行 `atb refine done RUN-A --summary "补全"`（走 fail 路径亦可复现）。
4. `atb refine check` → 实际返回 `nextAction: "stop"`、批次 finished；B 未被本任务处理，只能再建新任务补做。

场景二（对应 D03）：

1. 条目 A 在本轮 `refine done` 回执后（完善徽标「已完善」），人工执行 `atb status <A-ID> submitted` 再 `atb status <A-ID> accepted`（徽标重置为「未完善」，`docs/agent-team-board/refine/states.json` 可见）。
2. `atb refine next` → 实际返回 `stop: "finished"`（A 被本批 `finalByItem` 历史终态排除），本轮不再领取 A。

## 期望行为

1. **核对时实时吸收候选**：`atb refine check` 与回执收尾在判定 stop 前，按 REQ-20260908-020 口径实时重估候选（全部「已接受且完善状态 ≠ 已完善」的单）；只要仍存在可处理候选——含任务运行期间新接受的单——`nextAction` 应为 `continue`，不得因创建时快照耗尽而提前 stop，批次不得在尚有实时候选时被置为 finished。被冻结在其他未结束任务中的条目仍须排除（「一个条目至多属于一个任务」的防重复完善口径不变）。
2. **识别重新接受**：同轮内已回执终态（done/failed/skipped/interrupted）的条目，若被驳回再接受（完善状态重置为「未完善」），应重新进入本轮队列被再次领取与完善；`finalByItem` 历史终态不得排除「当前完善状态为未完善」的条目；重新领取的文档基线按重新接受后的文档重新冻结（上一轮 done 的修改不视为人工篡改），done 核验「文档确有变更」的口径不变，执行记录应可追溯同一条目的多次运行。
3. **不破坏既有保护**：完善中的单不可驳回回待接受（core.mjs 现有保护不变）；在途未收尾时 `refine next` 仍拒绝创建第二个执行（refine 互斥不变）；终止后迟到回执拒绝、暂停/恢复语义（深测 D07/D08/D09/D12 覆盖的行为）不回归。

## 验收说明

- [ ] `node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs` 中 D01、D03 两项 PASS，且既有 PASS 用例（D07/D08/D09/D10/D11）不转为 FAIL。
- [ ] D01 场景：最后一项运行期间新接受 B，A 回执后 `atb refine check` 返回 `nextAction: "continue"`，随后 `atb refine next` 能领取到 B；批次计数将 B 计入 total/remaining。
- [ ] D03 场景：同轮已 done 的 A 被驳回再接受后，`atb refine next` 再次领取到 A（返回的 itemId 为 A 的编号），A 的文档可再次补全并通过 `refine done` 的基线变更核验；执行记录中 A 留有两条独立运行记录可追溯。
- [ ] stop 语义不失效：无实时候选且无剩余项时 `atb refine check` 仍返回 `nextAction: "stop"`；不会因状态未变化对同一单无限重复领取（同轮内再次领取仅发生于「终态回执之后重新接受」）。
- [ ] 回归：`atb refine create/next/done/fail/release/check/pause/abort/records` CLI 与看板批量完善面板行为不变；条目全程保持 accepted，完善三态徽标（未完善/完善中/已完善）置位规则符合 REQ-20260908-020。

（根因归因与修复方案在 design.md 于开发阶段补充，本 README 不预设实现方式。）
