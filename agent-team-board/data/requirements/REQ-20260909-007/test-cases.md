# 测试用例 — REQ-20260909-007 在已接受和已计划界面分别添加开始完善和开始开发快捷按钮

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
>
> 口径说明（design.md 定稿）：README 现状依据中 `#implGo` / `enterBatchImpl` / 勾选范围链路
> 已被 BUG-20260909-006 整体移除（批量开发入口唯一收敛任务模块，范围恒为已计划队列），
> 因此「开始开发」行为对齐目标 = `gotoRuns('develop')`，无勾选范围语义。
> 测试文件：`scripts/tests/lane-quick-entry-20260909-007.test.mjs`。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| Q1 | 静态契约：列表头左组「全不选」之后存在常驻快捷按钮 `#laneQuickEntry`（`btn small primary`、初始 hidden、`type="button"`、含 aria-label）；不在右组 `#selGroup` 内；右组不出现「开始完善 / 开始开发 / 批量完善」按钮（REQ-20260908-027 口径不回退）；源码无 BUG-20260909-006 移除符号回流；`.caption-left` 保留 wrap | 高 | 通过 |
| Q2 | 显隐与文案随档切换：已接受档显示「▶ 开始完善」（title 指向批量完善面板）；已计划档显示「▶ 开始开发」（title 指向批量开发面板）；待接受 / 开发中 / 待测试 / 已完成档隐藏；`syncAcceptance` 同步、切档即时、来回切换正确 | 高 | 通过 |
| Q3 | 「开始完善」点击行为：切到任务模块（view=runs、batch.mode=refine）并拉取 `/api/refine/current` + `/api/refine/candidates`；不创建任务（无 `/api/batch/create`、`/api/refine/start` POST）、无确认弹窗 | 高 | 通过 |
| Q4 | 「开始开发」点击行为：切到任务模块（view=runs、batch.mode=develop）并拉取 `/api/batch/current` 且不带 `?ids=`；已计划档有无勾选均不携带范围、不发起范围推送（BUG-20260909-006 口径：范围=已计划队列） | 高 | 通过 |
| Q5 | 常驻可用性：零勾选时可见可点（disabled=false）；批量操作进行中（anyBatchPending 四路 pending）不禁用；右组显隐与快捷按钮互不影响 | 中 | 通过 |
| Q6 | 现有入口不回退：完善三态徽标 `data-goto-refine` 跳转绑定保留；任务模块 `#runsView` 与子面板 tab 保留；右组既有按钮（接受所选 / 移入计划 / 驳回待接受 / 移出计划）照常 | 中 | 通过 |
