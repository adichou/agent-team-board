# 测试用例 — REQ-20260908-006 详情页面的操作按钮要改成横向布局

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| H1 | CSS 静态：`.drawer-actions-center` 改横向（flex-direction: row、水平居中 justify-content、允许 wrap） | P0 | 通过 |
| H2 | CSS 静态：行内 `.btn` 不被压缩（flex: none）且文案不折行（white-space: nowrap），防挤压变形 | P0 | 通过 |
| H3 | CSS 静态：容器行内垂直居中（align-items: center）、`1 / N` 序号不断行 | P1 | 通过 |
| H4 | 回归：模板结构不动——notice 仍在 `.drawer-actions` 之前独立成行，中栏仍为按钮 + 序号（drawer-nav D1/D4 继续跑绿） | P0 | 通过 |
| B1 | 浏览器实测：待接受详情页「接受 / 改标题 / 删除」一行横排居中，两翼导航对齐，窄屏整按钮换行 | P1 | 待人工 |
