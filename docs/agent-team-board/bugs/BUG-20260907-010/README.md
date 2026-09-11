# BUG-20260907-010 已上报条目卡片显示两个「待确认」标记；已完成条目仍残留「待确认」chip 与「请人工确认」横幅

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T09:00:50.880Z

## 现象

## 现象（沙盒截图 t02/t03/t05 可证）
- 已上报（in-progress + agentCompletedAt）条目：状态 chip 因 lane 映射显示「待确认」，紧随其后的 agentCompletedAt flag 又渲染一个「待确认」→ 同卡片重复两个；
- 人工确认完成（done）条目：状态 chip「已完成」旁边仍挂「待确认」chip，详情页仍显示「⚑ Agent 已上报完成…请人工确认」横幅与「待确认」头部 chip——语义冲突（驳回时 agentCompletedAt 已正确清空，仅确认完成路径不清）。

## 根因
app.js 卡片模板（约 871-872 行）：<span class=state>LANE_LABEL[lane]</span> 与 it.agentCompletedAt ? '<span class=flag>待确认</span>' : '' 叠加，flag 未按 lane=confirming（重复）与 done（已确认）收敛；详情页横幅同理。

## 建议
flag 仅在 lane 仍为开发中/待确认时渲染；done 态隐藏或改为「已确认」历史信息。与 REQ-20260907-005（待确认改名待测试、已完成界面去待确认按钮）方向相关但为不同问题。

## 影响
状态语义混乱：已完成却「待确认」、待确认显示两遍。

## 复现步骤

1. 打开 Status Board，造数或观察一条已上报条目（`in-progress` + `agentCompletedAt`）→ 列表卡片上「待测试」出现两次（lane 状态 chip + flag 角标）；
2. 人工确认完成一条已上报条目（→ `done`，`agentCompletedAt` 保留）→ 观察卡片与详情页是否残留「待确认/待测试」角标与「请人工确认」横幅。

## 期望行为

- 列表卡片：同一语义只出现一次——已上报未确认条目仅 lane 状态 chip 显示「待测试」，不再叠加 flag 角标；`done` 卡片无任何「待测试」标记；
- 详情页（无 lane 状态 chip 处）：上报未确认保留「待测试」角标与「⚑ Agent 已上报完成…请人工测试」横幅；`done` 两者皆无。

## 修复说明（2026-09-08，zcode-batch-009-01）

- 现象 2（done 残留角标/横幅）已先由 REQ-20260907-005 收敛（`testFlagHtml` 与详情横幅均显式排除 `done`），本次测试回归锁定；
- 现象 1（同卡片重复）本次修复：`reqRowEl` 卡片模板移除 `${testFlagHtml(it)}`（状态 chip 已按 lane 显示「待测试」，角标会重复）；角标仅保留在无 lane 状态 chip 的位置（详情抽屉头部、下属 Bug 列表）；
- 同步调整 REQ-20260907-005 验收用例 confirm-lane.test.mjs T8（原「上报未确认行保留角标」与去重诉求冲突），新增回归测试 scripts/tests/card-flag-dedup.test.mjs（T1–T5）。

## 关联（引入来源）

- 引入来源：REQ-20260906-013（新增「待确认」lane 分组的同时保留卡片「待确认」小旗，状态 chip 与小旗叠加重复；done 残留部分已由 REQ-20260907-005 收敛）
