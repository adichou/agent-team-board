# 测试用例 — REQ-20260924-002 AI 总结与 AI 翻译任务面板增加终止任务功能

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | 数据层回归：finishSummaryRun(result=failed) 带人工终止原因——残留 summarizing 回退 pending、已 summarized 保留、summary.lock 释放、可立即 createSummaryRun 重启不提示锁占用 | 高 | 通过 |
| L1-2 | 数据层回归：finishTranslateRun(result=failed) 同构口径——残留 translating 回退、已 translated 保留、translate.lock 释放、可立即重启 | 高 | 通过 |
| L3-1 | POST /api/build/docs-summary/abort：进行中 run 终止后 phase=failed、reason 含「人工终止」、残留回退、已完成保留、锁释放；全局任务面板移出该 run；可立即再次 start（不提示锁占用） | 高 | 通过 |
| L3-2 | POST /api/build/docs-translate/abort：同 L3-1 口径（translate.lock） | 高 | 通过 |
| L3-3 | 终止缺省解析唯一进行中 run；body.runId 指向非进行中 run 报错；无进行中 run 时 400（「尚无进行中」） | 中 | 通过 |
| L4-1 | renderSummaryPanel：run.phase=running 渲染红色危险「终止任务」按钮（id=summaryAbort）；failed / done / 空态不出现 | 高 | 通过 |
| L4-2 | renderTranslatePanel：同 L4-1 口径（id=translateAbort） | 高 | 通过 |
| L5-1 | abortSummaryTask / abortTranslateTask：uiConfirm 危险二次确认（取消无请求）、确认后调 abort 接口、刷新面板；bindBatchDrawer 完成按钮绑定 | 高 | 通过 |
| L6-1 | i18n：新增文案（确认标题 / 确认正文 / 按钮 title / 成功 toast）中英词条齐备，静态精确与动态插值各就各位 | 高 | 通过 |
