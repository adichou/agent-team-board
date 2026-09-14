# 测试用例 — REQ-20260908-011 修改单需支持修改标题和描述。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | core：submitted 需求同时改标题 + 描述成功——status.title、README/design/test-cases 首行、README「## 描述」节全部同步，history 一条留痕且 note 可追溯变更 | P0 | ✅ edit-content.test.mjs C1 |
| C2 | core：submitted Bug（独立与归属）改描述写回 README「## 现象」节，其余小节（复现步骤等）不受影响 | P0 | ✅ edit-content.test.mjs C2 |
| C3 | core：仅改描述（标题不变）保存成功，不触发「与原标题相同」报错 | P0 | ✅ edit-content.test.mjs C3 |
| C4 | core：仅改标题（描述不变 / 未传）行为与既有 renameItem 一致 | P1 | ✅ edit-content.test.mjs C4 |
| C5 | core：标题与描述均无变化（或均未传）拒绝，明确提示无变化，不写盘 | P1 | ✅ edit-content.test.mjs C5 |
| C6 | core：标题非法（空 / 超 120 字）拒绝，且描述不落盘（原子性，不得只改一半） | P0 | ✅ edit-content.test.mjs C6 |
| C7 | core：accepted / in-progress / done 状态拒绝编辑并报错（与 renameItem 同口径） | P0 | ✅ edit-content.test.mjs C7 |
| C8 | core：README 缺「## 描述」/「## 现象」节（被人工删改）时明确报错，不做模糊写入 | P1 | ✅ edit-content.test.mjs C8（含标题不落盘的整单拒绝断言） |
| C9 | core：描述清空提交——按 design 确认的空描述口径一致生效（默认写回「（待补充）」占位） | P2 | ✅ edit-content.test.mjs C9 |
| C10 | server：POST /api/item/:id/content 合法更新返回 200 与最新 status；非 submitted、非法参数返回 4xx/错误信息 | P0 | ✅ edit-content.test.mjs C10 |
| C11 | CLI：`atb rename` 旧用法回归不受影响；描述参数（若确认纳入）与网页同口径生效 | P1 | ✅ edit-content.test.mjs C11（含 `--desc -` stdin 多行子进程实测；旧用法回归另见 rename-reject R8） |
| U1 | UI：submitted 需求与 Bug 的卡片、详情抽屉渲染编辑入口；非 submitted 不渲染 | P0 | ✅ edit-content.test.mjs U1 |
| U2 | UI：编辑弹窗双字段预填当前标题与描述（经 /api/item/:id/doc/README.md 拉取截取）；取消 / Esc / 遮罩关闭不发请求 | P0 | ✅ edit-content.test.mjs U2（静态 + 沙箱） |
| U3 | UI：保存期间按钮禁用防重复提交；成功 toast + 列表与抽屉刷新；失败 toast 报错且弹窗输入保留可重试 | P0 | ✅ edit-content.test.mjs U3（静态 + 沙箱，含服务端报错 onSubmit 抛错可重试） |
| U4 | UI：按钮文案消歧断言——编辑入口文案 / aria-label 覆盖「标题 + 描述」语义，与「修改提示词」按钮文案可区分（最终文案以人工确认为准） | P1 | ✅ edit-content.test.mjs U4（采用文案：「✎ 改标题/描述」+「修改提示词」，见 design 实施记录） |
| U5 | 回归：「修改提示词」「删除」「接受 / 驳回」既有交互不受影响，rename-reject 等既有测试全部保持通过 | P0 | ✅ edit-content.test.mjs U5 + run-all 全量（89 文件 0 失败；rename-reject / edit-prompt 断言随本需求 UI 契约同步更新，core/CLI 断言未动） |

执行文件：`scripts/tests/edit-content.test.mjs`（本需求新增，19 用例）；
另按新 UI 契约同步更新 `rename-reject.test.mjs`（U1/U3 前端函数与端点断言：renameItem→editItem、/title→/content、uiPrompt→uiEditForm）与
`edit-prompt.test.mjs`（按钮文案「修改」→「修改提示词」），core 层 R1–R8 与既有行为断言保持原样并通过。
