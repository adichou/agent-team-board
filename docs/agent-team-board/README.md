# Agent Team Board 数据目录

本目录是「智能体团队看板」的事实源，请随项目代码提交进 git。

## 批量开发方案

[Zcode 与 Codex 批量开发说明](batch-execution.md) 汇总选定方案、使用流程、上下文控制、运行记录、异常恢复与已验证边界。 汇总选定方案、使用流程、上下文控制、运行记录、异常恢复与已验证边界。

- [REQ-20260906-002：Zcode 轻量主调度与每单新子 Agent](requirements/REQ-20260906-002/README.md)
- [REQ-20260906-003：Codex 后台自动派发与进程回收](requirements/REQ-20260906-003/README.md)
- [REQ-20260906-024：Codex 模型配置、单项覆盖与续跑一致性](requirements/REQ-20260906-024/README.md)

各项目录内提供需求、设计、测试用例和测试报告；实时实施与验收状态以各自 status.json 为准。

## 测试方案

- [Codex 子 Agent 与后台自动派发 A/B 测试方案](codex-ab-test-plan.md)
- [A/B 测试结果报告模板](codex-ab-test-report-template.md)
- [2026-09-07 Codex A/B 合成任务试跑报告](test-runs/20260907-codex-ab-pilot/README.md)
- [2026-09-07 Codex A/B 正式主测](test-runs/20260907-codex-ab-main/README.md)

## 目录与状态

- `requirements/REQ-YYYYMMDD-NNN/` —— 需求（README / design / test-cases / test-report）
- `requirements/<REQ>/bugs/BUG-YYYYMMDD-NNN/` —— 归属该需求的 Bug
- `bugs/BUG-YYYYMMDD-NNN/` —— 独立 Bug
- `status.json` 由 atb 工具维护，**请勿手改**（Agent 写入也会被钩子拦截）

状态流转：submitted → accepted（人工）→ in-progress（Agent 认领）→ done（人工确认）。
人工操作入口：Status Board 网页（`/board`）或终端执行
`node <插件>/scripts/atb.mjs status <ID> accepted|done`。
