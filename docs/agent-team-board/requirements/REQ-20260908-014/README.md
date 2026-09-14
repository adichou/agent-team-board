# REQ-20260908-014 需求完善批次每一轮上报需在主调度会话中显示单号和标题

- 状态：planned（已计划）
- 创建：2026-09-08T03:24:43.636Z

## 描述

需求完善批次（refine，REQ-20260907-003）由主调度会话逐轮派发子 Agent，子 Agent 按提示词执行
`atb refine next` → 补全条目文档 → `atb refine done/fail`，并把回执 JSON 原样返回主调度会话。

当前回执只有 `batchId/runId/itemId/result/summary(reason)`：主调度每轮只能看到单号（itemId），
看不到该条目的标题，要知道本轮完善的是什么需求必须再跑 `atb show/list` 查询，多轮连续汇报时
无法直观对应"哪轮做了哪件事"。主调度核对入口 `atb refine check` 的 `current` 与
`atb refine records` 的记录同样只有单号没有标题。

目标：需求完善批次的每一轮上报输出——`refine done` / `refine fail` 回执，以及主调度核对所见的
`check.current`、`records` 记录——都同时携带单号（itemId）与标题（title）。

不涉及界面改造，纯 CLI/JSON 协议字段补充；实施批次（`atb run receipt`）的回执不在本需求范围。

## 验收标准

- [ ] `atb refine done <RUN-ID> --summary …` 回执 JSON 含 `itemId` 与 `title`，title 为条目标题。
- [ ] `atb refine fail <RUN-ID> --reason …` 回执同上。
- [ ] `atb refine check` 的 `current` 对象、`atb refine records` 的每条记录均含 `title`。
- [ ] 回执与 check 载荷仍 ≤2048 字节；条目已删除或历史运行无标题快照时 `title` 为 null，命令不报错。
- [ ] 现有 refine 行为（领取互斥、指纹变更校验、暂停/恢复、release）不回归。
