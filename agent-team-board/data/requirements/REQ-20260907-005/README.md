# REQ-20260907-005 待确认改为待测试。已完成界面去掉待确认按钮。

- 状态：submitted（待人工接受）
- 创建：2026-09-07T08:22:11.860Z

## 描述

看板展示层的派生分类 `confirming`（in-progress 且 agentCompletedAt）当前文案为「待确认」。
该阶段的实际语义是 Agent 已上报、等待人工**测试验证**后点「确认完成」，故改名为「待测试」。

同时，状态机流转 `in-progress → done` 时不清空 `agentCompletedAt`（仅 `done → in-progress`
人工驳回时清空，见 scripts/lib/core.mjs setStatus），导致已完成条目仍满足
`agentCompletedAt` 条件，在列表行、详情页头部、下属 Bug 行残留「待确认」角标
（以及「⚑ Agent 已上报完成…请人工确认」提示），与「已完成」状态矛盾。
本次在已完成（done）视图去掉这些待确认标记。

范围（展示层，不改状态机与数据）：

- scripts/web/app.js：LANE_LABEL / LANE_HINT / REQ_FILTERS 文案、三处 flag 角标、
  详情页上报提示文案；done 条目不再渲染待测试角标与「请人工确认」提示。
- scripts/web/style.css：仅注释文案同步。
- 相关契约测试（confirm-lane / workbench-layout / detail-close-btn）同步更新断言。
- 项目 README.md 两处流程文案同步。

不在本次范围：内部键名 `confirming`、CSS 变量 `--confirming` / `.s-confirming`、
状态机四态与 `atb` CLI 输出（CLI 描述的是等待人工确认动作，非看板分类名）。

## 验收标准

- [ ] 需求筛选第五档、列表行状态标签、详情页角标统一显示「待测试」。
- [ ] confirming 档提示（tooltip / 详情页 notice）改为「等待人工测试」语义。
- [ ] 已完成（done）条目：列表行与详情页不再出现「待测试」角标，详情页不再出现
      「⚑ Agent 已上报完成…请人工确认」提示；下属 Bug 已完成同样不出现角标。
- [ ] 非 done 条目行为不回归：上报未确认条目仍显示「待测试」角标与提示。
- [ ] 相关测试（confirm-lane 等）更新后通过，npm test 全量通过。
