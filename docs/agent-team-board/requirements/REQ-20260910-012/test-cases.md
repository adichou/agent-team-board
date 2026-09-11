# 测试用例 — REQ-20260910-012 app 版的布局优化

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/layout-topbar-rail-20260910-012.test.mjs`（静态契约 + vm 行为，零依赖）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 行为：renderBoard 有项目（已初始化 / 未初始化）时 `#dataDir` 为空（顶栏不渲染路径）；无项目时仅简短引导文案且不含路径 | 高 | 通过 |
| T2 | 静态：`.path:empty` 隐藏空路径行（不占位）；顶栏默认视图无路径展示，完整路径承接位在「管理项目」弹窗（`.proj-path` 现状保留不动） | 高 | 通过 |
| T3 | 静态：模块页签 `.module-nav` 上移并入顶栏（位于 `.brand` 之后、`.top-actions` 之前），独立第二行消失；`.view-tab` 与 `data-view` 绑定不变 | 高 | 通过 |
| T4 | 静态：顶栏内 `.module-nav` 无 border-bottom、保留 overflow-x:auto（窄窗口页签横滑不裁切）；`.topbar` 仍 nowrap | 中 | 通过 |
| T5 | 静态：`#filterBar` 移入 `#reqView` 内（列表/详情区左缘），`.filter-bar` 纵向排布 + chip 文字竖直（writing-mode）；`.req-view` 改行向 flex；chips 数据结构（data-filter / 计数 / active / 事件委托）不变 | 高 | 通过 |
| T6 | 静态：讨论模块 `.disc-filters` 同步纵向化（oncall.js 结构保留 filter-chip 机制）；无子页签模块（任务 / 文件 / 设置）不渲染纵向栏——`#filterBar` 仅需求模块显隐逻辑保持 | 高 | 通过 |
| T7 | 静态：Electron 壳层共存——交通灯让位（padding-left 78px）与 `.top-actions` no-drag 保留，新增 `.topbar .module-nav` no-drag !important（页签可点击、其余顶栏空白可拖动） | 高 | 通过 |
| T8 | 静态：`ui-demo.html` 存在、无外网依赖、覆盖新旧布局对照与正常 / 空 / 加载 / 失败状态切换 | 中 | 通过 |
| T9 | 回归：受本需求替代的旧契约测试同步更新（view-tabs-right / workbench-layout / topbar-overflow / caption-toolbar 中「第二行独立模块导航」「筛选条横向换行」断言改为「顶栏内模块页签」「纵向栏竖向滚动」），其余既有测试全量通过（143 个测试文件 0 失败；scheduler-unclaimed 为与本条目无关的既有 flaky，HEAD 基线亦复现） | 高 | 通过 |
