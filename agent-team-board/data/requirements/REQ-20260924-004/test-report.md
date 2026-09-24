# 测试报告 — REQ-20260924-004 整体审核界面的 AI 校对逐项增加修改按钮。

- 时间：2026-09-24T08:35:05.044Z
- 执行者：zcode-batch-071-1
- 测试框架：分层测试（vm 静态契约 + i18n，node:test 风格自研 runner）
- 覆盖率：10%

## 总结

AI 校对问题逐条渲染+修改按钮：提示词约束 issues 一行一条行号开头（口径a，账本不变兼容既有run）；前端 splitProofreadIssues/parseIssueLineNo 逐条拆分，renderFinalizeModal ③ 项按文件分组每条带「✎ 修改」按钮；editFromProofread 先关整体审查再 openReview 参数化跳转（切页签/目标栏编辑态/pendingFocus），focusReviewIssue textarea 选区定位突出问题行+短暂描边；整段/无行号兜底文件级跳转；门禁零改动；i18n 动态键 ◇ · 第 ◇ 行；新增 10 例测试，同步更新 001/003 既有测试注入，npm test 347 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
