# 测试报告 — BUG-20260909-017 批量完善的提示词中依然含有子代理模型配置的相关内容表述，应和批量开发一样保持一致。

- 时间：2026-09-09T15:51:45.919Z
- 执行者：zcode-batch-027-4
- 测试框架：node:assert 契约测试（run-all.mjs）
- 覆盖率：100%

## 总结

归因 REQ-20260908-020（005/011 转向后残留）。生成层统一：buildRefinePrompt/generatePrompt 移除 manual 固定行分支，任何模型入参一律注入 FOLLOW_SESSION_PROMPT_LINE，旧行不再可生成；展示/回显归一：task-settings 新增 normalizePromptModelLine，refineBatchPublicView、atb/server refine create 回显接入，存量 14 个完善批次账本不回写（历史原样，design.md 已声明处置口径）；新建批次口径正确；refine next/done/check 不回归。新增 bug-model-line-20260909-017.test.mjs 先红后绿，model-follow-session T5/T6 manual 断言随新契约翻转，全量 126 测试文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
