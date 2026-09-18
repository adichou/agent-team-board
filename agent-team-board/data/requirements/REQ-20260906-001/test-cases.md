# 测试用例 — REQ-20260906-001 需求和文件的切换栏要换个样式和颜色，以便和下方的需求分类切换栏区分

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 用例实现：`scripts/tests/view-tabs-style.test.mjs`（零依赖 node:assert，静态断言 style.css / index.html，
> 参照 layout.test.mjs / portrait-board.test.mjs 既有风格）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| V1 | `--viewrail-accent` 与 `--viewrail-accent-soft` 在浅色（:root）与深色（prefers-color-scheme: dark）主题各定义一份，且 `--viewrail-accent` 取值不等于同主题 `--primary` | 高 | ✓ |
| V2 | 桌面端 `.view-tab.active` 背景为 `var(--viewrail-accent)`（不再是白胶囊 `var(--panel)`），激活文字为白；`.view-tabs` 底槽用 `var(--viewrail-accent-soft)` | 高 | ✓ |
| V3 | 视图 tab 胶囊造型：桌面 `.view-tab` 与 ≤1020px `.view-tabs .view-tab` 圆角均为 99px；分类 tab `.board-tab` 保持 9px 圆角矩形，两组造型不同 | 高 | ✓ |
| V4 | ≤1020px 下 `.view-tabs .view-tab.active` 背景为 `var(--viewrail-accent)`、不得为 `var(--primary)`；未激活视图 tab 为透明底 + 靛蓝字，`.board-tab` 未激活保持面板底灰字——两组样式互不串用 | 高 | ✓ |
| V5 | 分类栏不回归：`.board-tab.active` 仍为 `var(--primary)` 填充白字，`.board-tabs` 桌面 display:none 不变 | 高 | ✓ |
| V6 | 结构契约：index.html 仍是 `nav.view-tabs` 内两个 `button.view-tab[data-view=status|files]`；app.js 仍以 `.view-tab`/`.view-tabs`/`--viewrail-h` 协同（类名未改，ResizeObserver 高度同步保留） | 中 | ✓ |
| M1 | （人工视觉验收，不自动化）窄屏下两组切换栏一眼可区分；深浅色主题下激活态白字可读、观感协调 | 中 | 待人工验收 |
