# 测试用例 — BUG-20260910-015 全局任务中的副标题精简，同时将搜索框和副标题放在同一行

被测对象：

- `scripts/web/index.html` 的 `#globalPanel` 头部结构（副标题 + 搜索框同排）。
- `scripts/web/style.css` 的 `.global-panel-head / .global-panel-tools / .global-panel-scope / .search-input` 布局规则。
- `scripts/web/app.js` 全局面板行为不回归（搜索常驻、不随内容重渲染、Esc / 焦点 / 快照恢复）。

测试文件：`scripts/tests/global-panel-head-compact-20260910-015.test.mjs`
（零依赖 node:assert 静态契约测试，沿用 global-entry-panel-20260910-004.test.mjs 风格；
浏览器实际同排视觉与窄屏折行按 README 验收标准人工核对，可借条目 ui-demo.html 对照）。

## 用例

| # | 用例 | 断言 |
|---|------|------|
| U1 | 副标题精简 | `.global-panel-scope` 文案为「跨项目批量任务」，不再含原长句「全部注册项目的批量任务」；面板内仍保留「跨项目」跨项目语义 |
| U2 | 原语义辅助保留 | `.global-panel-scope` 带 `title="不随顶栏项目选择变化"`，悬停可读，不占版面 |
| U3 | 同排结构 | `.global-panel-tools` 内同时含 `.global-panel-scope` 与 `#globalSearchInput`（副标题左、搜索右同块同排）；`.global-panel-title` 内只余 `<h2>全局任务</h2>`，不再包含副标题 |
| U4 | 首行独立 | `.global-panel-head` 内标题在前、`#globalPanelClose` 在后；关闭按钮与搜索输入均位于 `#globalPanelBody` 之前（常驻头部，不随内容重渲染） |
| U5 | 搜索输入契约不变 | `#globalSearchInput` 的 type=search / placeholder（搜项目 / 批次号 / 条目编号…）/ aria-label（搜索全局任务（跨项目））/ enterkeyhint / autocomplete 保持原值 |
| U6 | 同排样式 | `.global-panel-tools` 为 flex + `flex-wrap: wrap`（窄屏行内自然折行）+ 单条 `border-bottom`；`.global-panel-scope` 不再需要标题下间距（margin 收敛）；`.global-panel-tools .search-input` 不再全宽（flex 伸缩 + min-width，非 `width: 100%`） |
| U7 | 消除重复分隔与留白 | `.global-panel-head` 规则不再带 `border-bottom`（分隔线只剩工具行一条）；头部区（head + tools）合计纵向留白收敛（head 底 padding 小于顶 padding） |
| U8 | 窄屏适配 | ≤640px 媒体查询保留 `.global-panel-head` 与 `.global-panel-tools` 的密排 padding；head 保留 flex-wrap（关闭按钮不被遮挡） |
| U9 | 行为不回归 | app.js 中搜索仍为常驻节点：渲染只写 `#globalPanelBody`、`renderGlobalView` 不重建 `#globalSearchInput`；Esc 清空不冒泡、Enter 立即过滤、快照恢复回填搜索输入的原有实现保留（不因本单改动） |

## 执行与验证记录

见 test-report.md（跑红 → 实现 → 跑绿）。
