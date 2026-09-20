# 设计 — REQ-20260906-013 在开发中和已完成之间增加待确认分类

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板列由 `scripts/web/app.js` 顶部 `STATES = ['submitted','accepted','in-progress','done']`
驱动：`renderBoard` / `buildColumn` / `ensureBoardTabs` / `updateBoardTabs` 均按它建列、
计数与高亮。Agent 上报后条目带 `agentCompletedAt`，只在卡片上挂绿色「待确认」小旗，
不改变列归属，导致「等人工确认」与「开发中」混列。

## 方案

纯前端派生分类（lane），后端状态机与 `/api/board` 契约不动：

- `app.js` 新增 `LANES = ['submitted','accepted','developing','confirming','done']` 与
  `LANE_LABEL` / `LANE_HINT`；`laneOf(it)`：`in-progress` 且 `agentCompletedAt` → `confirming`，
  否则 `developing`；其余状态原样。
- 建列 / tab / 计数 / 高亮全部改按 `LANES` + `laneOf`；列身份属性由 `data-status` 改为
  `data-lane`（值不再是状态机取值，避免语义谎报）。
- 拖放映射 `LANE_DROP_STATUS`：submitted/accepted → accepted 流转、developing → `in-progress`
  （驳回完成）、done → `done`（确认完成）；`confirming → null`，拖入时 toast 提示
  「由 Agent 上报后自动进入，不支持手动拖入」，不发请求。
- 卡片 tooltip 改用 `LANE_HINT[laneOf(it)]`；卡片/抽屉的状态色 class 仍用状态机取值
  （`s-in-progress`），抽屉「状态」字段仍显示状态机文案（状态机真值由 flag + 上报通知表达）。
- `style.css`：`.board` 网格 `repeat(4, minmax(220px,1fr))` → `repeat(5, minmax(180px,1fr))`
  （5×180 + 间距 92px ≈ 992px < 1020px 断点，桌面无横向溢出）；新增 `--confirming`
  （亮 `#7c3aed` / 暗 `#a78bfa`，与四态色均可区分）与 `.s-developing`（沿用 `--inprogress`）、
  `.s-confirming`；`.flag` 前景由 `--done` 改 `--confirming`，与列色一致。
  ≤1020px 横滑布局按列自适应，无需改。

## 影响面

- 改动文件：`scripts/web/app.js`、`scripts/web/style.css`；契约更新
  `scripts/tests/layout.test.mjs`（T6 四列 → 五列）、`scripts/tests/pending-alignment.test.mjs`
  （R5 布局断言随五列更新，「待对齐」不回归断言保留）；新增 `scripts/tests/confirm-lane.test.mjs`。
- 后端 `scripts/server.mjs`、CLI、状态机、hooks 均不动。

## 风险与边界

- 「待确认」非状态机状态：所有 API/导出/批量调度仍按四态；仅看板展示分组变化。
- 五列使桌面列宽从 ≥220px 收窄到 ≥180px；1020px 以下本来就是横滑单列，不受影响。
- `pending-alignment` 曾经加过第五列后被回退（其回归测试断言四列）；本需求是新的产品决策，
  更新该断言为五列但保留「不得出现待对齐列/按钮」的守卫。
