# BUG-20260907-002 浏览器手动刷新需求界面无数据，若切换到其他栏目，再切换回来就有数据

- 状态：in-progress（已上报，待人工确认）
- 归属需求：REQ-20260907-004
- 引入来源：REQ-20260907-004（经 `atb list` 核验；四行布局重构引入 `#reqView` 容器与五模块 `setView`，由 run-20260907-034 实施）
- 创建：2026-09-07T08:15:12.584Z

## 现象

浏览器停留在需求模块（默认视图）按 F5 手动刷新后，页面无任何需求/Bug 数据；切换到讨论、任务等
其他栏目再切回「需求」，数据才显示。带 `?view=oncall` 等深链刷新的其他模块不受影响。

## 复现步骤

1. 打开看板并停留在「需求」栏目（默认视图，URL 无 `view` 参数）。
2. 按 F5 手动刷新。
3. 观察需求工作区无数据；点击其他栏目再点回「需求」，列表恢复显示。

## 根因

`index.html` 中 `#reqView` 初始带 `hidden`，只有 `setView()` 会移除它；而 `boot()` 仅在
`viewParam !== 'status'`（深链其他模块）时才调用 `setView`，默认需求视图走
`syncProjectUrl()` 分支跳过了容器初始化。`renderBoard()` 只切换 `#reqView` 的子容器
`#board`/`#emptyState`，因此整页保持不可见；切走再切回触发 `setView('status')` 才显示。

## 期望行为

任何入口进入页面（含默认需求视图手动刷新、首轮服务离线）都应初始化视图容器：有数据直接显示
需求列表与副标题，无数据显示初始化空态引导，不依赖切换栏目恢复。

## 修复

`boot()` 改为对解析后的视图统一调用 `setView(viewParam)`（`setView` 内部已含
`syncProjectUrl`，深链行为不变）。自动化用例见
`scripts/tests/refresh-default-view.test.mjs`（R1–R5）。
