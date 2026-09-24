# 测试用例 — REQ-20260924-004 整体审核界面的 AI 校对逐项增加修改按钮。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 分层测试脚本：`node scripts/tests/req-20260924-004.test.mjs`

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | AI 校对提示词回执格式约束：--issues 每条独立一行、行号开头（口径 a），校对约束与回执说明同步 | P0 | 通过 |
| L4-1 | splitProofreadIssues：多行拆逐条（trim + 去空行、保序）；无换行整段作单条不丢内容；空文本空数组 | P0 | 通过 |
| L4-2 | parseIssueLineNo：`第 N 行` 优先、行首 `N. / N、 / N: / L N:` 次之；无行号（含「（无行号）」前缀）返回 null | P0 | 通过 |
| L4-3 | renderFinalizeModal ③ 项：done + fail 时按文件分组逐条渲染，每条一行带「✎ 修改」按钮（data-proof-edit / data-proof-line / title 摘要），回执原文不丢不截断、序号可辨 | P0 | 通过 |
| L4-4 | renderFinalizeModal ③ 项：整段 issues 拆不出多条作一条、按钮无 data-proof-line（文件级跳转）；未运行 / 进行中 / 中断 / 全 pass 均无修改按钮 | P0 | 通过 |
| L4-5 | openReview 参数化：无参 = README 页签全栏预览（现状不变）；带 { file, line } = 切对应页签（含自定义 KEY）、目标栏编辑态、其余栏预览、pendingFocus 记录；行号非法归 null | P0 | 通过 |
| L4-6 | editFromProofread：先关闭整体审查对话框再打开审查对话框（一次一层）；finalize.busy 不放行；数据未就绪不动作 | P1 | 通过 |
| L4-7 | focusReviewIssue：行号 → 选区该行首尾 + 滚动居中 + 短暂描边；行号超界收敛末行；无行号 / 空内容只聚焦不定位；目标不在 DOM 安全返回；pendingFocus 一次性消费 | P0 | 通过 |
| L4-8 | 修改不改门禁：①② 检查区、取消 / 确认完结按钮与顶层 3 条检查项结构在逐条渲染下保持（回归 req-20260924-003 契约） | P1 | 通过 |
| L6-1 | i18n：新增动态键 `◇ · 第 ◇ 行` 中英齐备；`✎ 修改` 词条复用（✎ Edit）；title 摘要英文界面翻译、往返还原 | P0 | 通过 |
