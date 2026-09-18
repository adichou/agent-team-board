# 测试用例 — REQ-20260910-006 布局优化，列表的操作按钮要平铺在一行内

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 静态契约测试（对齐 drawer-actions-row.test.mjs 手法）：`node scripts/tests/req-row-actions-inline.test.mjs`；
> 像素级断点/滚动/焦点行为以浏览器人工核验（验收标准第 2、8 条）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| H1 | reqRowEl 模板：复制按钮移入 `.row-acts` 且为第一个按钮，`.item-id` 不再内嵌复制按钮（`itemIdHtml(it.id, { copy: false })`） | P0 | 通过 |
| H2 | reqRowEl 模板：`.row-acts` 内按钮顺序固定为 复制 → 接受（data-accept-id）→ 修改（data-rename-id）→ 删除（data-delete-id） | P0 | 通过 |
| H3 | CSS：`.req-row .row-acts` 为不可拆分单行整体（flex-wrap: nowrap），空间不足整体换行，极窄容器局部横向滚动（overflow-x: auto + max-width: 100%），不撑破页面 | P0 | 通过 |
| H4 | CSS：`.row-acts` 内按钮不被压缩折行（flex: none + white-space: nowrap），复制成功文案变长仍单行 | P0 | 通过 |
| H5 | 回归：接受/修改/删除仍仅在 submitted 条目渲染（三个按钮模板仍以 `it.status === 'submitted'` 为条件），非 submitted 行操作区仅剩复制 | P0 | 通过 |
| H6 | 回归：详情抽屉头部与抽屉 Bug 子项列表的 `itemIdHtml(it.id)` / `itemIdHtml(b.id)` 默认仍内嵌复制按钮，bindCopyIdButtons 绑定不变 | P1 | 通过 |
