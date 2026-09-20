# 设计 — BUG-20260920-003 AI 分析进入待人工确认分析去人后，进入续跑状态，需要自动复制续跑提示词，并提示用户到 AI Agent 中进行续跑操作

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260914-001（已核验：`atb list` 存在该需求；`git log -S '已确认，正在继续当前条目分析'` 首现于 e3ed1c5「自动提交不完整时挂起条目并暂停队列，人工 REQ-20260914-001」）。该需求引入挂起确认面板与分析确认续跑闭环（confirmAnalysisContinue / resumeAfterAnalysisConfirm / 面板「确认并继续」），确认成功反馈只写了「已确认，正在继续当前条目分析」，未接续批量完善面板已有的提示词复制能力，形成本缺口。

## 根因分析

- 确认链路三段分工：`scripts/web/app.js` confirmContinueAction 分析侧成功分支只发 toast + 面板短消息；`scripts/server.mjs` 调 `confirmStore.confirmAnalysisContinue` + `refine.resumeAfterAnalysisConfirm`（答案回传、条目重排队首、解除暂停），服务端从不启动外部 Agent；`scripts/lib/refine-store.mjs` 也不在此路径生成 / 返回提示词。
- 批量完善面板早已有同批次主调度提示词与「重新复制」（`b.prompt` ← /api/refine/current，展示前经 normalizePromptForDisplay 归一），但确认面板从未消费它——「确认了」与「去 Agent 会话续跑」两步之间没有交接动作，也没有文案告知必须人工粘贴发送，用户误以为分析已自动继续。

## 方案

前端闭环（服务端零改动，复用既有只读接口与既有复制工具，不拼凑简化指令、不创建新任务）：

- 确认成功（`r.ok` 且分析侧）后在 confirmContinueAction 内触发**一次** `fetchAndCopyResumePrompt(d, r.batchId || d.batchId)`：经 `GET /api/refine/current?batchId=<确认返回的分析任务号>` 取当前分析任务的完整主调度提示词（与批量完善面板「提示词」页签同一事实源、同一归一口径），`copyDispatchText` 复制。
- 状态机入 `state.confirms.resume`（itemId → { status, prompt, error }，status = fetching | copied | copy-failed | fetch-failed | empty；不进轮询签名，保留至页面重载），面板常驻续跑提示词卡（`#confirmResumeCard`，只更新卡容器不打断作答输入）分态呈现：
  - copied：「已确认并加入续跑队列。续跑提示词已复制，请到当前项目的 AI Agent 调度会话粘贴并发送…」+ 条目编号 + 项目路径 + 完整提示词文本 + 「重新复制」；
  - copy-failed：保留排队结果，明示复制失败，完整可选中文本 + 「重新复制」（recopy 只重试剪贴板，不再请求）；
  - fetch-failed / empty：不复制空文本、不显示成功，显示原因 + 「重新获取」（refetch 复用同一入口，成功后再尝试复制）；
  - 已确认但无状态（页面重载 / 重开面板）：只渲染「复制续跑提示词」显式入口，不自动覆盖剪贴板。
- 区分「已进入续跑队列」与「Agent 已开始执行」：卡内常驻说明 + 确认消息改为「已确认并加入续跑队列：正在自动复制续跑提示词…」（替换旧「正在继续当前条目分析」口径，i18n 死键同步清理）。
- 确认失败（未答齐 / 版本过期 / 续跑排队失败）、保存草稿、保持挂起均不触发复制；获取 / 复制进行中 confirmResumeBusy 防重复触发。
- 样式：`.confirm-resume` 卡（成功描边强调色 / 失败态警示色）+ 复用 `.batch-prompt` 展示完整提示词（可滚动、可整段选中）。

**开源选型（REQ-20260909-015）**：未引入开源库。自研理由：改动是既有确认面板内的小型 UI 状态机 + 既有只读接口与既有 `copyDispatchText` 的组合复用（无新领域算法），无成熟库可替代且引入成本高于自研；未使用开源库的条目不创建 licenses.md。

## 风险与边界

- 不改变 AI 开发确认、条目业务状态、人工答案保存与队列优先级；不自动打开 / 自动发送消息 / 新建 Agent 会话（深链跳转也不做，仅复制 + 文案引导）。
- 自动复制仅在确认动作成功时发生一次；轮询 / 刷新 / 重开面板不写剪贴板（浏览器剪贴板写本身需要用户手势上下文，确认点击即手势，后续重开不再具备）。
- `GET /api/refine/current` 为面板既有数据源（其 checkRefineBatch 吸收逻辑与面板打开一致）；接口异常或提示词为空如实分态反馈，不伪装成功、不回滚已确认结果。
- 提示词文本按当前任务号取「当前分析任务」口径（与 UI「去批次概念」术语一致，i18n 词表不得出现「批次」字样）。
