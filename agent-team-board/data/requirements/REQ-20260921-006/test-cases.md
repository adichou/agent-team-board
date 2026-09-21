# 测试用例 — REQ-20260921-006 优化当前的 AI 分析，AI 开发，AI 完善，AI 总结的提示词，以提升提示词缓存命中率

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

结构断言口径：**静态前缀** = 提示词从开头到「运行参数（」标记行之前的内容；四条流水线在同一
配置组合下、仅随调用变化的值不同时，静态前缀必须逐字一致，动态值只允许出现在运行参数区。

| # | 用例 | 优先级 | 结果 |
| ---- | ---- | ------ | ---- |
| T1 | AI 开发主调度 generatePrompt：不同 projectRoot / atbPath / workerSpecPath 的输出静态前缀逐字一致；三个动态值只出现在运行参数区 | 高 | 通过 |
| T2 | AI 开发主调度：模型跟随行只在尾部——modelSource=follow 与不传模型信息共享同一静态前缀；不传时全文无跟随行 | 高 | 通过 |
| T3 | AI 分析主调度 buildRefinePrompt：不同 projectRoot / atbPath 前缀一致、动态值仅在参数区；autoPlan 开/关共享同一静态前缀（关：全文无「自动转入计划」，OFF 约束行整行保留；开：ON 约束段整段保留且不出 OFF 行）；模型跟随行仅尾部 | 高 | 通过（T3a/T3b 两断言组） |
| T4 | AI 分析单项 buildRefineWorkerPrompt：两个不同条目（编号/标题/目录/缺失原因/执行编号不同）静态前缀逐字一致；autoPlan 开/关前缀一致（关：无「自动转入计划」）；「条目目录：」「缺失原因：」「执行编号：」仍为整行稳定形态 | 高 | 通过 |
| T5 | AI 总结 buildDocSummaryPrompt：不同 planId / runId / 关联条目的输出静态前缀逐字一致；回执命令段为恒定形态（不传 runId 也含 atb summary file/done/fail 与 `<执行编号>` 占位）；README 链接提示（README.md → CHANGELOG.md / FEATURES.md）在静态段；计划号/版本号/执行编号/项目路径/文档清单/关联范围只在参数区 | 高 | 通过 |
| T6 | AI 完善 buildPrompt（web/build.js vm 装载）：两个不同版本（id/名称/描述/关联条目不同）静态前缀逐字一致；「版本名称：<一行>」「版本描述：<可多行>」在静态段；版本号/当前信息/关联条目清单只在参数区；parseAnswer 仍按约定解析回答 | 高 | 通过 |
| T7 | 展示层兼容：normalizePromptForDisplay 对四类新生成提示词（开发 / 分析主调度开与关 / 分析单项开与关）幂等；开关分态归一仅发生在尾部参数区；存量冻结旧形态（含批次行/旧前缀）归一行为不回退 | 高 | 通过 |
| T8 | 语义护栏（不回退）：新生成提示词仍含各流程关键命令与纪律锚点——`batch check --dir`、`atb refine next --by refine-<序号>`、`refine check --dir`、`atb summary done <执行编号>`、`版本名称：<一行>`；开发/分析主调度首行角色句不变 | 中 | 通过 |

新增测试文件：scripts/tests/req-20260921-006.test.mjs（TDD 先红后绿：实现前 9 项断言全红，实现后全绿）。
同步更新的依赖提示词形态的既有夹具：scripts/tests/bug-build-session-entry-20260913-005.test.mjs（AI 完善复制断言锚点「请为看板版本 <ID>」→「看板版本：<ID>」）。
