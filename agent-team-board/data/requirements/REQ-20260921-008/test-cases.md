# 测试用例 — REQ-20260921-008 发布模块的文档编写页面优化

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现文件：scripts/tests/req-20260921-008.test.mjs（分层 L1–L6）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | 四态枚举与文案唯一事实源：DOCS_FLOW_LABEL 恰为 未总结/正在总结/已总结待审核/已审核 四态 | P0 | ✅ 通过 |
| L1-2 | evaluateDocsFlow 基础求值：无审核无总结 → 全 unsummarized；marks.summarizing → summarizing；marks.summarized → summarized | P0 | ✅ 通过 |
| L1-3 | 审核与回退：review hash=磁盘 → reviewed；reviewed 后内容修改（hash 不一致）→ 回退 summarized；scopeStale → reviewed 失效回退 summarized | P0 | ✅ 通过 |
| L1-4 | 直接审查路径：unsummarized 文件不经总结标记，直接给 review 记录 → reviewed | P0 | ✅ 通过 |
| L1-5 | 提交门禁求值：canCommit 仅 8/8 reviewed；missing 列出未审核文件与各自状态 | P0 | ✅ 通过 |
| L1-6 | AI 总结提示词：含计划号/版本号/项目路径/八文档清单/逐文件进度回执 CLI 指令（summary file/done/fail）；沿用写作约束 | P0 | ✅ 通过 |
| L2-1 | docs-summary 账本：createSummaryRun 建八文件 pending run + 占用 summary.lock；重复 start 报「已有进行中」 | P0 | ✅ 通过 |
| L2-2 | markSummaryFile：summarizing/summarized 流转 + 非法文件/非法状态/非 running run 拒绝 | P0 | ✅ 通过 |
| L2-3 | finish：done/fail 收尾释放锁；fail 把残留 summarizing 回退（不悬挂「正在总结」）；latestSummaryRun/summaryMarksForVer 聚合正确 | P0 | ✅ 通过 |
| L2-4 | 锁隔离：summary run 进行中，impl.lock / refine.lock 均不存在（三锁互不占用）；recordDocsReview 写 v.review 且不改 v.docs 提交语义 | P0 | ✅ 通过 |
| L3-1 | API：docs-summary/start（merging 拒绝 / 正常返回 runId+prompt）；docs-summary/current 反映进度 | P0 | ✅ 通过 |
| L3-2 | API：docs/review 通过审核 → docsFlow 该文件 reviewed；编辑保存后回退 summarized | P0 | ✅ 通过 |
| L3-3 | API：docs/commit 门禁——未全审核 400 带缺口明细；不在 dev 400（不自动切分支）；全审核后在 dev 提交成功（hash + pathspec 只含八文档） | P0 | ✅ 通过 |
| L3-4 | publish-plan：响应含 docsFlow（八文件四态）与 summary；docsPrompt 字段移除 | P1 | ✅ 通过 |
| L4-1 | 前端 renderDocsPane：副标题 + 四按钮（刷新/AI 总结/审查/提交）+ 八文件行 + 四态 chip（图标+文字）+ 门禁条 | P0 | ✅ 通过 |
| L4-2 | 提交按钮门禁：非 8/8 reviewed 时 aria-disabled + title 缺口明细；加载失败态保留按钮与错误反馈 | P0 | ✅ 通过 |
| L4-3 | 审查对话框：四类型页签 × 中英双栏；每栏 编辑/预览 切换、保存、通过审核；双栏同步滚动绑定存在；文件名 data-i18n-skip 豁免 | P0 | ✅ 通过 |
| L4-4 | 文案更名：文档编写页签内不再出现「AI 写作」（「官网 AI 写作」保留在正式发布步）；toast 文案同步 | P0 | ✅ 通过 |
| L5-1 | 任务模块：AI 总结页签渲染（进行中进度/当前文件/独立锁标注/失败原因/空态） | P0 | ✅ 通过 |
| L5-2 | 全局任务面板：kind=summary 简报行（标签 AI 总结、进度计数）；收尾后移出 | P1 | ✅ 通过 |
| L6-1 | i18n：新增文案中英词条齐备（四态/按钮/门禁/对话框/任务面板），往返不变形；旧「AI 写作」文档页键清理 | P0 | ✅ 通过 |
| L6-2 | 回归：evaluateDocsState / publishStepsState（合并门禁）零改动；npm test 全量通过 | P0 | ✅ 通过 |
