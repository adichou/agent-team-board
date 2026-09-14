# 测试用例 — REQ-20260908-022 支持就单一需求和 Agent 进行讨论的功能

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | store：createTicket 带 req 落 reqId；缺省 reqId=null（老单兼容）；非法格式 / 不存在 / Bug 编号拒绝 | P0 | ✅ |
| R2 | store：卡片与 listTickets 按 reqId 过滤（与状态过滤组合）；过滤无匹配返回空 | P0 | ✅ |
| R3 | 上下文：readTicketFull 带 req 元信息与三文档全文；需求删除后 missing 不崩；未绑定单不变 | P0 | ✅ |
| R4 | codex 提示词：buildOncallWorkerPrompt 注入归属需求节（元信息 + README/design/test-cases 全文）；未绑定单无该节 | P0 | ✅ |
| R5 | CLI：oncall new --req 创建；list --req 过滤且行内显示 [REQ-…]；show 文本含归属需求与文档上下文，--json 含 req | P0 | ✅ |
| R6 | serve：POST /api/oncall/ticket 带 req；GET /api/oncall/tickets?req= 过滤；board 卡片与详情带 reqId/req；非法 req 400 | P0 | ✅ |
| R7 | UI 静态契约：需求抽屉「需求讨论」区块与发起入口、统一弹窗关联需求输入；讨论卡片/抽屉归属徽标与双向跳转接缝（atb:open-req / ATBOncall.openDrawer） | P1 | ✅ |
| 回归 | oncall-store / oncall-cli / oncall-serve / oncall-dispatch / oncall-ui / oncall-isolation 既有用例不回归 | P0 | ✅ |
