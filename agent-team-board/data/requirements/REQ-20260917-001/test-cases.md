# 测试用例 — REQ-20260917-001 需求模块的 AI 分析和 AI 开发按钮点击后，直接复制相应提示词即可，不需要打开任务页面

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1 | 静态契约：`#laneQuickEntry` 点击绑定改为就地创建入口（`laneQuickCreate`），源码不再含旧导航绑定与旧「进入任务模块……」title；index.html 静态 title 同步新语义 | 高 | 通过 |
| L2 | 已接受档点击「▶ AI 分析」：视图保持需求页不切换，`POST /api/refine/create`，剪贴板获得接口返回 prompt（与任务页「提示词」页签同源），toast 统一成功口径（候选 N，子代理模式；状态：待启动） | 高 | 通过 |
| L3 | 已计划档点击「▶ AI 开发」：`POST /api/batch/create`，复制 prompt，toast 成功口径（候选 N，受阻 M；状态：待启动），不切视图 | 高 | 通过 |
| L4 | 无候选禁用：已接受档条目均已完善 → 按钮 disabled 且 title「暂无可完善候选……」，点击不发请求；已计划档空队列 → disabled 且 title「暂无已计划候选……」 | 高 | 通过 |
| L5 | 连点防重复：首个创建请求进行中按钮禁用，期间再点不发出第二个创建请求，回执后恢复可点 | 高 | 通过 |
| L6 | 重复启动（服务端 400）：toast 警示样式原样展示服务端原因，不复制提示词、不新建 | 高 | 通过 |
| L7 | 复制失败：剪贴板抛错 → toast 如实说明任务已创建但复制失败，指引到任务页对应面板「提示词」页签手动复制，不误报「已复制」 | 中 | 通过 |
| L8 | i18n：新 title 4 条（两档 × 有/无候选）与两条复制失败 toast 词条入 EN，旧「进入任务模块……」两条词条移除；i18n-coverage 覆盖卡点通过 | 高 | 通过 |
| L9 | 存量契约同步：copy-rename-20260913-005 / quick-entry-revert-20260914-005 / lane-quick-entry-precise-20260915-009 按新行为改写后通过；gotoRuns 精准落地链路（完善徽标 / 全局总览共用）不回退 | 中 | 通过 |
| L10 | 范围回归：npm test 全量通过（任务页「启动」/「提示词」页签、完善徽标与全局总览跳转等既有契约由存量套件守护）；ui-demo.html 覆盖正常 / 空 / 加载 / 失败 / 重复启动场景 | 中 | 通过 |

覆盖文件：`scripts/tests/req-20260917-001.test.mjs`（L1–L8 vm 行为 + 源码/i18n 契约）；L9 由三个存量测试改写守护；L10 由 `npm test` 全量与人工核对 ui-demo 覆盖。

存量测试同步改写（均为 REQ-20260917-001 行为变更的契约跟随，守护意图不变）：
- `lane-quick-entry-20260909-007.test.mjs`：Q1 绑定契约、Q3/Q4 点击行为改为就地创建口径；Q2/Q5/Q6 保留。
- `quick-entry-revert-20260914-005.test.mjs`：R2 禁用契约改为「创建进行中或无候选禁用」；R3 补无候选禁用场景；R5 title 改新语义。
- `lane-quick-entry-precise-20260915-009.test.mjs`：R1–R4 触发方式从点快捷入口改为直接 gotoRuns（快捷入口不再导航；gotoRuns 精准落地机制本身仍守护）。
- `copy-rename-20260913-005.test.mjs`：W1a/W1b/W3 快捷入口 title 词条改新语义。
- `refine-ui.test.mjs`：R12-10 创建函数提取正则随 `opts` 签名放宽。
- `commit-rollback-20260911-010.test.mjs`：R8 绑定断言改为 laneQuickCreate（accepted/planned 分支在函数体内守护）。
