# 测试报告 — REQ-20260909-010 支持需求完善后自动转入计划，提供配置，默认是手动

- 时间：2026-09-09T05:58:04.590Z
- 执行者：zcode-batch-022-1
- 测试框架：node assert/strict（npm test 聚合，118 文件全绿）
- 覆盖率：12%

## 总结

完善后自动转入计划落地：tasks/settings.json 新增 refine.autoPlanAfterDone（默认关闭）；finishRefineRun done 核验通过后系统内部 accepted→planned（history by=system+runId，失败不阻断回执）；done 核验放宽 planned（人工提前移入计划时回执成功不流转）；server codex 路径 precheck/settle 对齐 accepted 并同口径接入；设置页新增开关（草稿/保存/toast）；CLI 输出流转行；面板记录标注；state-guard 与 HUMAN_ONLY_TO 零改动

## 明细

（可粘贴命令输出、失败用例说明等）
