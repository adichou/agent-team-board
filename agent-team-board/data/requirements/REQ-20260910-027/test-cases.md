# 测试用例 — REQ-20260910-027 删除所有任务中对开发人员的设置功能

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

新口径契约测试：`scripts/tests/dev-setting-removed-20260910-027.test.mjs`（静态源码
契约 + lib 行为断言，风格沿 settings-runparams-removed-20260909-011.test.mjs）；
既有测试按移除后口径更新（batch-core D1-D4 / batch-ui U14 / refine-ui R12-3 /
commit-ui / batch-cli / batch-serve / refine-serve / commit-serve /
global-board / agent-generic / tasks-tabs / batch-search-filter / refine-store /
next-batch-entry / prompt-legacy-words）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | lib：createBatch / createRefineBatch / createCommitBatch 账本不再写 developer；generatePrompt / buildRefinePrompt / buildCommitPrompt 任何入参（含传 developer）都不含「请将当前会话名改为」命名指令 | 高 | ✅ |
| D2 | lib 遗留兼容：三个 create 传 developer 不报错（参数保留但忽略）、账本无该字段；prompt 生成函数传 developer 与不传输出逐字一致 | 高 | ✅ |
| D3 | lib 存量兼容：账本手工含 developer 的批次 summary / publicView / brief 正常且不透出 developer | 高 | ✅ |
| D4 | 前端：三处启动区无 #batchDev / #refineDev / #commitDev 输入框、无「开发人员」label；源码无 localStorage `atb.batch.dev` 读写、无 batchDevInitial；三个创建函数请求体不含 developer | 高 | ✅ |
| D5 | 前端展示/搜索：develop/refine/commit 运行态状态行、排队批次行、全局任务行 meta 无「开发人员」片段；globalTaskMatches 与排队批次过滤字段不含 developer | 高 | ✅ |
| D6 | server：/api/batch/current 无批次响应无 gitUser 键、源码无 gitUserName；三个 create API 不透传 developer（源码契约）、响应不含 developer；/api/batch/current 的 batch 视图与 queue 项不含 developer | 高 | ✅ |
| D7 | CLI：batch/refine/commit create 的 parseOpts 白名单无 dev；帮助文本无 --dev；create/summary 输出与 payload 无「开发人员/developer」；显式 --dev 时 die 提示已移除 | 高 | ✅ |
| D8 | 保留项不回归：三处启动区「启动」按钮与无候选禁用 title、终态「启动新一轮」、排队批次行其余片段（位次/总数/创建时间）、搜索其余字段（批次号/编号/标题/执行器）保持 | 中 | ✅ |
| D9 | 既有测试全量更新并通过（npm test） | 高 | ✅ |
