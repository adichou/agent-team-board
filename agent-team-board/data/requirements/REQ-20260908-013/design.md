# 设计 — REQ-20260908-013 讨论单的问题正文改为可选，如果用户没有填则复制标题作为正文。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现状与相关既有需求（源码均为真实路径）：

- **三处必填拦截**（同一口径「问题正文不能为空」）：
  - 前端 `submitNew()`：`if (type === 'ask' && !desc) { toast('讨论单的问题正文不能为空', true); return; }`（scripts/web/app.js，统一新建弹窗提交函数）；
  - store 层 `createTicket()`：`if (!question.trim()) throw new AtbError('问题正文不能为空')`（scripts/lib/oncall-store.mjs），随后 `question.md` 写入条目根（第 1 轮问题，`roundQuestionFile(dir, 1)`）；
  - CLI `atb oncall new`：`if (!question.trim()) die('问题正文不能为空（--question-file 或 --question 提供）')`（scripts/atb.mjs），用法说明同步标注 `--question-file`。
- **正文下游依赖**：question.md 是第 1 轮问题唯一真源（meta `ticket.json` 的 rounds 只存附件名等元数据，不存正文）——详情抽屉 `roundHtml()` 以 `renderMd(r.question)` 渲染（scripts/web/oncall.js）；派单提示词 `buildOncallWorkerPrompt(dataDir, id)` 以 `cur.question` 作「当前待答问题（第 N 轮）」（scripts/lib/oncall-store.mjs）。因此放开必填必须同时兜底，不能允许空正文入库。
- **既有能力来源**：统一新建弹窗（REQ-20260907-004，需求 / Bug / 讨论单三类同一表单，讨论单走 `/api/oncall/ticket` 并带截图附件与粘贴）；讨论单本身出自 REQ-20260907-001（Oncall 看板，独立 ASK 序列，保存即入列表、无需人工接受）；类型选项文案已统一为「讨论（ASK）」（BUG-20260907-014）。
- **追问是另一条路**：`askTicket()` 校验「追问正文不能为空」并写 `rounds/N/question.md`（N ≥ 2），追问轮没有标题可复制，不在本需求范围。

## 方案

（标〔待确认〕处为实施前需人拍板的决策点，其余为建议方案）

### store 层（scripts/lib/oncall-store.mjs）——回退唯一落点

- `createTicket()`：标题校验（非空、≤TITLE_MAX_CHARS=120 字）保持；将「question 为空即抛错」改为「question 为空白（trim 后为空）时以标题作为 question」，再写 `question.md`。回退放在 store 层使网页 API、CLI、未来调用方行为天然一致，避免各入口各自兜底产生分叉。
- 回退写入的内容为已 trim 的标题原文，不做任何包装（不追加「（正文同标题）」之类标记，保持派单提示词与抽屉展示干净）。
- `askTicket()`（追问）完全不动；`ticket.json` meta 结构不动（本就不存正文）。

### server 层（scripts/server.mjs）

- `POST /api/oncall/ticket` 无需改动：透传 `question`（可为空串 / 缺省）给 `createTicket`，由 store 回退。错误处理范式不变。

### 前端（scripts/web/app.js）

- `submitNew()`：删除 `type === 'ask' && !desc` 的拦截分支；其余流程（提交中禁用防重复、成功 toast、`setView('oncall')` + `ATBOncall.reveal(t.id)` 定位、失败保留弹窗可重试）不变。不在前端做 `question: desc || title` 的兜底——统一交给 store，防两端口径漂移。
- `syncNewFormFields()`：讨论类型的正文标签与 placeholder 注明可留空及后果，候选「问题正文（Markdown，可留空＝以标题作为正文）」〔文案待确认〕；需求 / Bug 的「描述（可留空，后续补充）」文案不动。

### CLI（scripts/atb.mjs）

- `atb oncall new`：去掉「问题正文不能为空」die（scripts/atb.mjs），`--question-file` / `--question` 均缺省时直接以空 question 调 `createTicket` 由 store 回退标题；用法说明（ONCALL_USAGE 两处）同步改为可选标注〔是否同步放开 CLI 待确认，默认同步——store 放开后 CLI 若仍拦截会与网页口径不一致〕。

### 影响面

- 改动集中在 `scripts/lib/oncall-store.mjs`（回退逻辑）、`scripts/web/app.js`（删拦截 + 文案）、`scripts/atb.mjs`（删 die + 用法文案）；不动 server、不动状态机、不动存储结构。
- 兼容性：带正文创建、附件上传 / 粘贴（含 BUG-20260907-004 修复后的体积限制口径）、追问、派单与回答回传均不受影响；历史存量单不受影响（question.md 仅创建时写入）。
- 测试：新增用例进 test-cases.md，风格对齐 `scripts/tests/oncall-store.test.mjs`（S 系列 store 集成）、`oncall-cli.test.mjs`（CLI）、`oncall-serve.test.mjs`（真实服务 HTTP）、`workbench-layout.test.mjs` / `oncall-ui.test.mjs`（前端静态断言）。

## 风险与边界

- **空正文入库风险已消除**：回退保证 question.md 恒非空（标题本身必填），派单提示词与抽屉展示不会出现空问题。
- **标题含 Markdown 字符**：回退后标题会按 Markdown 渲染（如 `#`、`*`、`[]()`），展示与提示词语义可能轻微偏移。默认接受（标题 120 字内、日常以纯文本为主），不做转义〔待确认是否需要转义〕。
- **用户感知**：留空创建的用户可能不知道正文已被回退为标题。靠表单文案（可留空＝以标题作为正文）+ 创建后抽屉第 1 轮直接可见解决；是否在 toast 中额外提示〔待确认，默认不加，保持 toast 简洁〕。
- **不扩大到追问**：追问正文必填口径不动，避免出现「空追问」派单给回答者。
- **文案属体验决策**：标签 / placeholder 最终文案需人确认后实施。
