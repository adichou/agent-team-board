# BUG-20260907-016 我不是要去掉全部需求的过滤条件，而是去掉“全部”这个过滤条件

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260907-006
- 创建：2026-09-07T14:48:41.658Z

## 现象

REQ-20260907-006「去掉全部需求的过滤条件」被实施为**整条移除**需求模块第四行
状态筛选条（zcode-batch-007-1：index.html 删 `#filterBar`，app.js 删
`REQ_FILTERS`/`renderFilterBar`/`state.reqFilter`/`applyReqFilter`，style.css 删
`.filter-bar`/`.filter-chip`/`.filter-count`）。用户澄清：原意是**只去掉筛选条里
「全部」这一档**，其余五档状态筛选（待接受/已接受/开发中/待测试/已完成）应保留。
（实施解读依据补记：标题应断句为「去掉『全部』这个过滤条件」而非「去掉全部的
过滤条件」。）

## 复现步骤

1. 打开需求模块（默认视图）。
2. 第三行模块搜索与列表之间：REQ-20260907-004 引入的第四行状态筛选条已不存在，
   无法再按状态筛选需求/Bug。

## 期望行为

- 恢复第四行状态筛选条：index.html 恢复 `#filterBar` 容器（初始 hidden，随
  renderBoard 显隐），app.js 恢复 `REQ_FILTERS`/`renderFilterBar()`/
  `state.reqFilter`/`applyReqFilter()` 与 chips 点击事件委托，style.css 恢复
  `.filter-bar`/`.filter-chip`/`.filter-count` 样式。
- 档位为五档：待接受 / 已接受 / 开发中 / 待测试 / 已完成（按 laneOf 派生分类，
  与 LANES 一致），**不含「全部」档**；各档 chip 带该档计数。
- 无「全部」档后默认选中第一档「待接受」（`state.reqFilter` 初始 `'submitted'`），
  始终恰有一档选中；点击 chip 切换档位，列表按该档过滤（与第三行搜索叠加）。
- 零结果空态文案恢复区分：有条目但筛选+搜索无命中时提示「当前筛选与搜索下没有
  条目」；完全无条目时仍提示创建。
- 讨论模块筛选、任务模块筛选不受影响；列表行状态标签（laneOf 派生）不受影响。

