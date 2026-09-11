# 测试用例 — REQ-20260906-008 需求和文件切换栏移到智能体团队看板右侧，使用切换样式

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 契约测试：`scripts/tests/view-tabs-right.test.mjs`（node 直接运行，零依赖）；M 系列为浏览器人工视觉验收。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 结构：`.view-tabs` 位于 `.top-actions` 内部、`#projectSel` 之前（顶栏中部不再有切换栏） | P0 | 待跑 |
| T2 | 布局：`.topbar` 仍 `space-between`；`.view-tabs` 基础规则 `flex: none`（不被压缩，topbar-overflow 契约延续） | P0 | 待跑 |
| T3 | 切换样式：`.view-tabs` 淡靛蓝底槽（`--viewrail-accent-soft`）、`.view-tab` 胶囊 99px、激活态 `--viewrail-accent` 白字、tab 带 `transition` 平滑过渡 | P0 | 待跑 |
| T4 | 窄屏回归（≤1020）：`.view-tabs` 仍 `position: fixed` + `flex-direction: column`（左缘竖排），app.js 保留 `--viewrail-h` 让位机制 | P0 | 待跑 |
| T5 | 交互：app.js 仍按 `querySelectorAll('.view-tab')` 绑定点击并同步 active；`<nav class="view-tabs"` 与两个 `data-view` 按钮类名不变 | P0 | 待跑 |
| M1 | 浏览器人工验收：桌面端切换栏在顶栏右侧与项目选择器同组，点击「需求 / 文件」平滑切换视图；窄屏仍左缘竖排 | P1 | 人工 |
