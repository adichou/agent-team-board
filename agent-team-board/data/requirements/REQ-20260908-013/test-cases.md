# 测试用例 — REQ-20260908-013 讨论单的问题正文改为可选，如果用户没有填则复制标题作为正文。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | store：createTicket 不传 question / 传空串——创建成功，question.md 内容为标题文本，meta 状态 pending、轮次结构正常（scripts/lib/oncall-store.mjs） | P0 | ✓ oncall-store S6 |
| S2 | store：question 为纯空白（空格 / 换行 / 制表符）——按留空处理，question.md 同样回退标题 | P0 | ✓ oncall-store S6 |
| S3 | store（回归）：question 非空——question.md 原样落盘，不被标题覆盖（对齐 oncall-store.test.mjs 既有 S1 断言口径） | P0 | ✓ oncall-store S6b + 既有 S1 |
| S4 | store（回归）：标题为空仍抛「标题不能为空」；标题超 120 字仍抛「标题过长」——正文可空不放松标题校验 | P0 | ✓ oncall-store S6b |
| S5 | store：留空正文 + 附件组合——question.md 为标题，附件照常落盘并进第 1 轮 rounds[0].attachments | P1 | ✓ oncall-store S6c |
| S6 | store：buildOncallWorkerPrompt 对留空创建的单——「当前待答问题（第 1 轮）」后为标题文本，不为空行 | P1 | ✓ oncall-store S6c |
| S7 | store（回归）：askTicket 追问正文为空仍抛「追问正文不能为空」，追问口径不受影响 | P0 | ✓ oncall-store S6b |
| H1 | server：POST /api/oncall/ticket 只传 title（question 缺省 / 空串）返回 200 与新单 meta；详情 GET /api/oncall/ticket/:id 第 1 轮 question 为标题（scripts/server.mjs） | P0 | ✓ oncall-serve H4 |
| C1 | CLI：`atb oncall new --title <标题>` 不带 --question / --question-file 创建成功，`atb oncall show` 第 1 轮问题为标题；带 --question 时行为不变（scripts/atb.mjs） | P1 | ✓ oncall-cli C3 |
| U1 | UI 静态：app.js 不再含「讨论单的问题正文不能为空」拦截；讨论类型正文标签 / placeholder 含「可留空」语义（最终文案以确认为准） | P0 | ✓ oncall-question-optional U1 |
| U2 | UI：统一新建弹窗类型选讨论、正文留空提交——成功创建，toast「✓ 已创建 ASK-…（待回复）」，进入讨论模块并 reveal 定位新单；详情抽屉第 1 轮显示标题作为问题 | P0 | ✓ oncall-question-optional U2（vm 沙箱；抽屉展示经 oncall-serve H4 数据 + 既有 roundHtml 渲染验证） |
| U3 | UI（回归）：正文填写时创建、附件上传 / 粘贴、需求与 Bug 类型描述可留空创建均不受影响 | P1 | ✓ oncall-question-optional U3 + workbench-layout W6/W7 |
| R1 | 回归：scripts/tests/oncall-store / oncall-cli / oncall-serve / oncall-ui / workbench-layout 既有测试全部保持通过（涉及文案的静态断言随实现同步更新） | P0 | ✓ run-all：90 个测试文件 0 失败（既有静态断言未受文案调整影响，未需改动） |

执行文件建议：store / CLI / server 用例分别并入或对齐 `scripts/tests/oncall-store.test.mjs`、`oncall-cli.test.mjs`、`oncall-serve.test.mjs` 既有模式（真实临时数据目录 + 真实服务 HTTP）；UI 用例按 `workbench-layout.test.mjs` 的源码静态断言与沙箱口径新增。
