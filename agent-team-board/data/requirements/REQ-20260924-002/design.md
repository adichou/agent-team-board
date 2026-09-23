# 设计 — REQ-20260924-002 AI 总结与 AI 翻译任务面板增加终止任务功能

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

AI 开发（/api/batch/abort）与 AI 分析（/api/refine/abort）面板已有「终止任务」，AI 总结（docs-summary）与 AI 翻译（docs-translate）面板进行中状态没有终止入口。summary.lock / translate.lock 无超时自动接管，人工停掉执行子代理会话后仍需手动执行 atb summary fail / atb translate fail 收尾，否则锁悬挂、无法启动新一轮。

## 方案

（技术选型、接口设计、影响面）

**开源选型（REQ-20260909-015）**：本单为既有面板交互补齐，完全复用仓库内既有模式与依赖（零新增 npm 依赖，无需 licenses.md）：服务层复用 docs-summary-store / docs-translate-store 既有 `finishSummaryRun` / `finishTranslateRun`（result=failed）收尾口径；前端复用既有 uiConfirm 危险二次确认组件与 `.btn danger` 样式（与 AI 开发 / AI 分析终止同交互形态）。自研理由：引用了既有库/模块——收尾、锁释放、残留回退、全局面板移出全部由既有 store 承接，本单只做入口与目标 run 解析，无合适第三方库可替代（业务闭环内聚于本仓库）。

### 服务端（scripts/server.mjs）

- 新增 `POST /api/build/docs-summary/abort` 与 `POST /api/build/docs-translate/abort`（runPost 包装，AtbError → 400）。
- 目标 run 解析 `runningDocsRunId(runs, runId, label)`：body.runId 优先（须 phase=running，否则 400「不在进行中」）；缺省取唯一进行中 run（锁单一保证至多一个）；无进行中 run 400「尚无进行中的 AI ×× 任务」。
- 收尾统一 reason：`人工终止任务：看板「终止任务」收尾（在途执行子代理需在对应 Agent 会话人工停止）`（≤200 字，带「人工终止」口径）。finishXxxRun 自动完成：run 置 failed、残留 summarizing/translating 回退 pending（不悬挂）、已完成文件保留跨 run 可续跑、释放 summary.lock / translate.lock；全局任务面板因 unfinished 过滤自动移出该 run，终止后可立即重启（createXxxRun 只检查未收尾 run）。

### 前端（scripts/web/app.js）

- `renderSummaryPanel` / `renderTranslatePanel` 的 running 分支末尾新增 `.drawer-actions`（右对齐）内红色危险按钮 `#summaryAbort` / `#translateAbort`（文案「终止任务」，title 说明中断收尾口径与在途人工停止提示）；failed / done / 空态不出现。
- 新增 `abortSummaryTask()` / `abortTranslateTask()`：仅 running 态响应；`uiConfirm({ danger: true, confirmText: '终止任务' })` 二次确认（取消不发请求、零状态变更）；确认后 POST abort（带 runId）、成功 toast、清空轮询签名（state.summary.sig / state.translate.sig）并 refreshSummary / refreshTranslate——面板随 2 秒轮询切到既有 failed 视图（中断原因 + 中断时间 + 锁已释放），按钮消失。
- `bindBatchDrawer` 内完成两个按钮的 click 绑定。

### i18n（scripts/web/i18n.js）

中英同步新增：确认标题「终止 AI 总结任务？/ 终止 AI 翻译任务？」、确认正文两条（回退 / 保留 / 锁释放 / 立即重启续跑 / 在途人工停止提示）、按钮 title 两条（静态 EN）；成功 toast「✓ 已终止 AI 总结任务：◇ / ✓ 已终止 AI 翻译任务：◇」（EN_DYNAMIC 插值，notice 为插值段）。

## 风险与边界

- 在途执行子代理会话不受远端影响：终止只做账本收尾与锁释放，运行中的子代理需人工到对应会话停止（确认弹层与按钮 title 均提示，与 AI 开发 / AI 分析口径一致）。
- 终止与子代理回执并发：finishXxxRun 对已收尾 run 重复回执报错（幂等保护），面板侧 running 态校验 + 服务端 400 双重兜底。
- 影响面：两类子面板 running 态新增一个按钮与确认弹层；无状态机、无条目状态改动；AI 校对（docs-check）面板不在本单范围。

## 实施记录（Agent 补充）

- TDD：scripts/tests/req-20260924-002.test.mjs（7 例，先红后绿）——L1 数据层回归（failed 收尾：残留回退、已完成保留、锁释放、可立即重启，summary/translate 同构）、L3 服务接口（abort 200 / 无进行中 400 / runId 已收尾 400 / 全局面板移出 / 可立即重启）、L4 面板渲染（仅 running 出 danger「终止任务」按钮，failed/done/空态不出现）、L5 交互与绑定静态契约、L6 i18n 中英词条齐备（静态 + 动态插值往返）。`npm test` 全量 344 文件 0 失败。
- test-cases.md 用例全部通过（见该文件结果列）。
