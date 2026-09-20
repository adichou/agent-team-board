# 设计 — REQ-20260906-020 待接受卡片「✓ 接受」按钮移至单号右侧

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

待接受列卡片（`cardEl`，scripts/web/app.js）的「✓ 接受」按钮原先挂在卡片底部独立的 `.card-accept` 行（右对齐、margin-top 6px），与首行单号分离、视觉跳跃；详情抽屉已由 REQ-20260906-005 确立「关闭按钮在单号右侧」的行内形态，本次对齐该形态。

## 方案

（技术选型、接口设计、影响面）

- scripts/web/app.js `cardEl()` 模板：
  - 「✓ 接受」按钮从底部 `.card-accept` 容器移入首行 `.card-top`，位置紧随 `.cid` 单号之后、「待确认」flag 之前；首行顺序变为 [选择框][REQ/BUG chip][单号][✓ 接受按钮]。
  - 按钮新增 `card-accept-btn` class 作为样式定位锚点；`data-accept-id`、aria-label、`✓ 接受` 文案不变。
  - 删除模板末尾整行 `.card-accept`；事件绑定（stopPropagation + `acceptItems([it.id])`）与 `accept.disabled = state.acceptance.pending` 初始化逻辑原样保留。
- scripts/web/style.css：
  - 删除 `.card-accept { display:flex; justify-content:flex-end; margin-top:6px; }`。
  - 原 `.card-accept .btn` 选择器改为 `.card-accept-btn`（保留 12px 级紧凑 padding/字号与禁用态样式），并补 `flex:none` 防压缩。
- 影响面：仅待接受（submitted）卡片布局；`syncAcceptance` 仍按 `[data-accept-id]` 全量同步禁用态（选择器未动）；勾选复选框、全选/批量接受工具栏、accepted 列批量实施复选框均不受影响。

## 风险与边界

- 单号 + 按钮同行可能挤压：按钮 `flex:none` 不压缩，card-top gap 6px，待接受单号（REQ-/BUG-YYYYMMDD-NNN）定长，窄列（≥180px）实测可容纳；「待确认」flag 仍 `margin-left:auto` 停靠行尾。
- 卡片高度因去掉底部行变矮，列内 flex 布局自然收紧，无需额外调整。
