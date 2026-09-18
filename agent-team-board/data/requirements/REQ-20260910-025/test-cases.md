# 测试用例 — REQ-20260910-025 排序下拉组件要和搜索框平齐

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/sort-search-align-20260910-025.test.mjs`（静态契约测试，参照 sort-locate-group-20260910-016 风格）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| A1 | 等高平齐（核心）：`.page-head .locate-group` 作用域内 `.sort-select` 与 `.module-search` 由同一规则声明显式 `height: 32px`（box-sizing 全局 border-box，含边框等高、上下边缘对齐）；排序下拉水平内边距 ≥6px 保持可读 | P0 | 通过 |
| A2 | 组容器对齐契约沿用（016 不回退）：`.page-head .locate-group` 保持 `display:flex`、`align-items:center`、`flex-wrap:wrap`、`min-width:0`、`margin-left:auto`（宽屏靠右、组内垂直居中） | P0 | 通过 |
| A3 | 复用位置不破坏：基础 `.sort-select` 仍为 `height:24px; padding:0 4px`（讨论筛选条行末排序维持原状）；基础 `.global-search` 规则不含显式 height；`.search-input` 基础规则 `font-size:12.5px`、`padding:6px 2px` 不变（全局面板搜索复用不受影响） | P0 | 通过 |
| A4 | 窄屏契约不回退：≤720px 媒体查询保留 `.page-head .locate-group { flex:1 1 100%; margin-left:0 }` 与 `.page-head .module-search { flex:1 1 auto; min-width:0 }`（分行/伸缩、无溢出） | P1 | 通过 |
| A5 | 行为契约不回退（静态）：index.html 定位组内 `#reqSort` 仍在 `#searchInput` 之前、初始 hidden、五选项保留；app.js `syncReqSortVisibility` 存在且被 `setView` / `renderBoard` 调用；`#searchFeedback` 仍位于 `#pageHead` 之后、不混入定位组 | P0 | 通过 |
| A6 | ui-demo 守护：条目目录 `ui-demo.html` 离线自包含（无外链脚本/样式/网络资源）、含「现状 / 平齐后」对照、参考线、排序/搜索/模块切换与「正常/空/加载/失败」四态；README 含 `./ui-demo.html` 相对链接 | P1 | 通过 |
