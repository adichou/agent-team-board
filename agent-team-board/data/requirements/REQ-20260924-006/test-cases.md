# 测试用例 — REQ-20260924-006 文档编写流程优化

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | AI 校对提示词补「超链接有效性」检查项，并约束无法验证（网络不可达 / 需登录）的链接标「待确认」，不得判为有效或确定失效；既有只读 / 不编造 / 行号回执约束不回退 | P0 | ✓ 通过 |
| L1-2 | AI 总结提示词契约回归：含关联需求清单与「按实际代码与提交核实变化」核验要求、只总结默认语言、复制交 Agent 执行的回执命令 | P1 | ✓ 通过 |
| L4-1 | parseChkSuggestion：解析「第 N 行：原文「A」→ 建议「B」」出 line/before/after；无「→ 建议」形态不可应用；before=after 或空 before 不可应用；无行号 line=null | P0 | ✓ 通过 |
| L4-2 | classifyChkIssue：含「待确认」判待确认；链接特征（链接/死链/http）判链接；错别字 / 语法标点 / 默认行文规范分类 | P1 | ✓ 通过 |
| L4-3 | applyChkSuggestion：行号命中行内包含 before 才单处替换；行内不含 / 超行回落全文定位，找不到 before 判 stale；无行号全文定位替换；不修改原字符串 | P0 | ✓ 通过 |
| L4-4 | chkPendingCount：done run 按 issues 行数计待处理；accepted/rejected/stale 决断不计；非 done run 或无 run 计 0 | P0 | ✓ 通过 |
| L4-5 | renderDocsPane 五步操作条：①–⑤ 顺序入口与 data-pf-summary / data-pf-edit / data-pf-proofstep / data-pf-translate / data-pf-commit 钩子；辅助「刷新 / 审查 / 整体审查」与三阶段条保留；加载 / 失败态五步条恒渲染 | P0 | ✓ 通过 |
| L4-6 | renderDocsPane 校对侧栏：无 run 空态「尚未校对」；running 进度；failed 原因 + 重试钩子；done 有问题文件逐条卡片（类型 / 位置 / 原文 / 差异 del-ins 与文字标签 / 接受拒绝钩子）；pass 文件「未发现问题」空态；待确认条目接受禁用 | P0 | ✓ 通过 |
| L4-7 | renderSecondaryEditModal：只列默认语言文件（多语言集无对照列；默认语言非中文与自定义文档生效）；编辑 / 预览切换、保存 / 关闭、未保存提示与「保存并继续 / 放弃修改并继续 / 留在本文件」挂起态；读取中 / 读取失败态 | P0 | ✓ 通过 |
| L4-8 | 二次编辑行为：openSecondaryEdit 读盘；未保存切换 / 刷新 / 关闭先进挂起态不丢字；保存成功才回写 disk 与 savedNote、docsFlow 联动；保存失败保留输入不误标已保存；挂起「保存并继续」保存成功后执行挂起动作 | P0 | ✓ 通过 |
| L4-9 | acceptChkSuggestion：文本未变化 → 单处替换保存成功记已接受（幂等，重复点击不再请求）；磁盘文本已变化 → 记过期不保存不覆盖；保存失败 → 保持待处理不误标；rejectChkSuggestion 记已拒绝原文不动 | P0 | ✓ 通过 |
| L4-10 | startTranslation：未处理建议 > 0 时阻止并提示数量（不发翻译请求）；无建议时行为不回归；单语言集提示「无翻译目标，可跳过翻译」不报「尚缺 0 个」 | P0 | ✓ 通过 |
| L6-1 | i18n：新增静态 / 动态词条中英齐备（五步条、二次编辑弹窗、校对建议卡片与状态、门禁提示）；动态键往返还原；EN 值不与既有词条冲突 | P0 | ✓ 通过 |
