# 测试用例 — REQ-20260913-005 批量完善和批量开发的文案改为 AI 分析和 AI 开发，要全面排查整改

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 契约测试文件：`scripts/tests/copy-rename-20260913-005.test.mjs`；存量断言旧文案的用例同步更新（见 test-report.md）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | W1 静态契约：index.html / app.js 用户可见文案换新词——档位快捷入口「▶ 开始 AI 分析 / ▶ 开始 AI 开发」（含 aria-label 与两枚 title）、任务模块子页签「AI 分析 / AI 开发」、类型筛选档与全局类型标签（RUN_KIND_TABS / GLOBAL_KIND_LABEL）、完善三态徽标 hint、终止二次确认弹窗标题、面板说明、全局空态、复工 title/toast、驳回禁用 title | 高 | 通过 |
| 2 | W2 静态契约：剔除注释后 index.html / app.js / i18n.js / style.css 不再出现「批量完善 / 批量开发 / 开始完善 / 开始开发」；旧可见字符串（枚举逐条）不残留 | 高 | 通过 |
| 3 | W3 i18n 中英成对：19 个旧键全部换新键，新键存在且值非空；英文措辞 AI analysis / AI development / Start AI analysis / Start AI development | 高 | 通过 |
| 4 | C1 CLI/服务端静态契约：atb.mjs 帮助与日志、core.mjs 占用与驳回报错、batch.mjs 占位规范与调度员首句、refine-store.mjs 调度员首句、git-flow.mjs 提交 summary、state-guard.mjs 拒绝提示、task-settings.mjs TASK_KIND_LABEL 均为新词；剔除注释后旧词零命中 | 高 | 通过 |
| 5 | C2 数据层：TASK_KIND_LABEL 导出值 = { refine: 'AI 分析', develop: 'AI 开发' }；buildRefinePrompt / generatePrompt 首句为「AI 分析调度员 / AI 开发调度员」；normalizePromptForDisplay 把存量冻结的「批量完善调度员 / 批量开发调度员 / 批次调度员」归一为新词且对现行输出幂等 | 高 | 通过 |
| 6 | R1 回归：存量 UI/行为测试（lane-quick-entry、tasks-tabs、batch-title-removed、caption-toolbar(-icons)、commit-rollback、realtime-round、batch-core、prompt-legacy-words 等）断言同步改新词后全绿；标识符（data-bmode、'refine'/'develop'、gotoRuns、API 路径）不动 | 高 | 通过 |
