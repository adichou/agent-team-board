# 测试用例 — REQ-20260909-003 需求文档引用讨论、纪要归档与说明同步

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | store：createDiscussion 生成 DISC 编号并绑定需求（非法/不存在/Bug 拒绝），round 1 与元数据落盘 | P0 | 通过 |
| D2 | store：启动/收尾提示词含项目根、需求/讨论编号、轮次、文档只读入口与落盘三件套路径；继续讨论开新轮且提示词带第 2 轮 | P0 | 通过 |
| D3 | store：readOutcome 四态——waiting（无发布标记）/ error（缺纪要、缺草稿、JSON 非法、绑定不符）/ published（成套读取 minutes+draft 并回写 publishedAt） | P0 | 通过 |
| D4 | store：saveQuote 落引用快照（文档/行/版本/原文），复制记录不改 README | P1 | 通过 |
| D5 | store：archiveRound 置 archivedAt 幂等，不写 README | P0 | 通过 |
| D6 | store：applyDraft 成功路径（勾选项写入、未选项不动、旧版 vN 保留、applied 记录、版本 +1）；重复应用幂等；空选择/原文缺失或多义/基线不符整体失败且 README 不变 | P0 | 通过 |
| D7 | store：continueDiscussion 保留旧轮归档与应用记录，新轮 outcome 独立 | P1 | 通过 |
| S1 | serve：/api/req-disc 全链路（start 提示词、?req= 状态、quote、archive、apply、非法参数 400） | P0 | 通过 |
| U1 | UI 静态契约：index.html 引入 req-disc.js；app.js 挂载区块并随轮询刷新；req-disc.js 含操作条/提示词复制/阅读模式行号与复制引用/纪要等待与失败重试/归档/逐项应用；style.css 有 rd-* 样式 | P0 | 通过 |
