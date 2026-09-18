# 测试用例 — REQ-20260908-003 支持待接受的需求删除

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | core：submitted 需求删除——目录移除、listItems 不再出现、其余条目与计数器不受影响 | P0 | 通过 |
| D2 | core：submitted Bug（独立与归属需求）删除——各自目录移除，宿主需求完好 | P0 | 通过 |
| D3 | core：非 submitted（accepted / in-progress / done）删除被拒绝，目录完好 | P0 | 通过 |
| D4 | core：需求有下属 Bug 时删除被拒绝并指引先处理；下属 Bug 删除后需求可删 | P0 | 通过 |
| D5 | core：不存在 / 非法单号报 AtbError | P1 | 通过 |
| D6 | server：DELETE /api/item/:id——submitted 成功且看板列表不再含该条目；accepted 拒绝 400；未知单号 400 | P0 | 通过 |
| D7 | CLI：usage 登记 atb delete、分发 delete 子命令并调用 core.deleteItem（静态契约） | P1 | 通过 |
| U1 | UI 静态：submitted 卡片与详情页渲染删除按钮（仅在 submitted 条件分支内），提交走 DELETE /api/item/:id | P0 | 通过 |
| U2 | UI 静态：deleteItem 用页面内 danger uiConfirm（不用 window.confirm），删除成功后刷新并关闭被删条目抽屉 | P0 | 通过 |
| U3 | UI 沙箱：确认后发一次 DELETE 请求；取消确认不发请求 | P0 | 通过 |
