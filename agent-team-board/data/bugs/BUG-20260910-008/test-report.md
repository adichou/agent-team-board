# 测试报告 — BUG-20260910-008 批量完善提示词中要针对自动转入计划的配置进行处理

- 时间：2026-09-10T05:49:46.841Z
- 执行者：zcode-batch-031-11
- 测试框架：node:assert/strict 脚本式契约测试（node scripts/tests/*.test.mjs）
- 覆盖率：100%

## 总结

完善提示词按「完善完成后自动转入计划」开关分态：buildRefinePrompt/buildRefineWorkerPrompt 新增 autoPlan 参数（缺省关闭=现状零回归），createRefineBatch/newCodexRefineRun 经 refineAutoPlanOn 实时读取开关冻结提示词；normalizePromptForDisplay 扩展 autoPlan 选项（开方向补系统流转说明/关方向剥除，幂等，账本不回写）；CLI refine create 回显与输出行、usage、server /api/refine/create、refineSummary/publicView 按实时开关分态；ON 文案明示 done 后系统自动 accepted→planned 属预期、不得据此暂停，Agent 纪律不放宽；新增 16 用例全绿，全量 144 测试文件零回归

## 明细

（可粘贴命令输出、失败用例说明等）
