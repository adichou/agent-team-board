# 测试用例 — REQ-20260921-012 发布模块的文档编写流程需优化成先写默认语言的文档，待默认语言的文档审核完毕后，再提供 AI 翻译的功能编写剩余语言的文档，然后再审查，最后是整体的审查完结流程

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | 七态枚举与文案：DOCS_FLOW_LABEL 扩展 未翻译/正在翻译/已翻译待审核（reviewed 共用） | P0 | ✅ |
| L1-2 | evaluateDocsFlow 分组求值：剩余语言初始「未翻译」而非「未总结」；translating/translated 标记生效；默认语言侧沿用四态 | P0 | ✅ |
| L1-3 | AI 总结范围收窄：buildDocSummaryPrompt 仅含默认语言 4 文件，不含 README_en.md 等；翻译提示词含基准全文、剩余语言清单与 atb translate 回执指令 | P0 | ✅ |
| L1-4 | canTranslate 门禁：默认语言未 4/4 已审核前 false 且 translateMissing 带缺口；全审后 true；单语言集 false | P0 | ✅ |
| L1-5 | 基准变更检测（mtime）：默认语言文档 mtime 严格晚于剩余语言文档 → 剩余语言文件（含已审核）回退「未翻译」、完结失效、canCommit false；mtime 相同 / 缺失不回退 | P0 | ✅ |
| L1-6 | canFinalize / finalized / canCommit：全部已审核方可完结；未完结 canCommit false；完结记录存在且有效 → finalized.at 与 canCommit true；scopeStale / 语言集变化使完结失效 | P0 | ✅ |
| L2-1 | docs-translate 账本与独立锁：createTranslateRun 仅装剩余语言文件（4×(N−1)）pending、占用 translate.lock；重复 start 拒绝；单语言集报错；与 summary 锁互不占用 | P0 | ✅ |
| L2-2 | markTranslateFile / finishTranslateRun：进度流转、集合外回执拒绝；fail 不悬挂「正在翻译」、translated 跨 run 保留；translateMarksForVer 聚合 | P0 | ✅ |
| L2-3 | recordDocsFinalize：落 v.review.finalized（langsKey + 文件 hash），不动 v.docs；merging 拒绝 | P0 | ✅ |
| L2-4 | AI 总结账本随范围收窄：createSummaryRun 仅默认语言 4 文件 pending；counts.total=4 | P0 | ✅ |
| L3-1 | 服务接口：docs-translate/start 门禁（默认未全审 400 带缺口；全审后 200 返回 runId+提示词+基准变更提示）；docs-translate/current 进度；docs/finalize 门禁与落盘；commit 在完结前 400、完结后 200；publish-plan 带 translate / 阶段字段；全局简报 kind=translate 进行中展示收尾移出 | P0 | ✅ |
| L3-2 | AI 总结 start 提示词与账本经服务接口收窄为默认语言 4 文件（进度 x/4） | P1 | ✅ |
| L4-1 | renderDocsPane：阶段条三阶段 + 六按钮（含 data-pf-translate / data-pf-finalize）+ 文件按语言成组 + 剩余语言「未翻译」chip + 门禁条含默认 / 剩余计数与完结缺口 | P0 | ✅ |
| L4-2 | 翻译 / 整体审查 / 提交按钮禁用态：aria-disabled + title 缺口明细；整体审查完结前提交禁用 | P0 | ✅ |
| L4-3 | 完结对核对话框：核对清单 + 确认完结 / 取消；完结后完结标识 | P1 | ✅ |
| L4-4 | 审查对话框七态 chip 与页脚计数沿用（翻译场景直接复用） | P1 | ✅ |
| L5-1 | 任务模块 AI 翻译页签与面板（进度 / 当前文件 / 独立锁 / 失败 / 空态）；全局面板 translate 类型标签 / 筛选 / 前缀兜底 / 计数口径 | P1 | ✅ |
| L6-1 | i18n：新增文案中英词条齐备（七态 / 阶段条 / 翻译 / 完结 / 门禁新口径）；往返不变形 | P0 | ✅ |
| L6-2 | 回归：evaluateDocsState / publishStepsState 零改动；既有 008 / 010 测试随范围收窄调整后通过 | P0 | ✅ |

执行文件：`scripts/tests/req-20260921-012.test.mjs`（TDD 先红后绿）。
