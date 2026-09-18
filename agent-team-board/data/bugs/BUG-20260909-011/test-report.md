# 测试报告 — BUG-20260909-011 配置界面中的运行参数配置删除

- 时间：2026-09-09T09:06:13.199Z
- 执行者：zcode-batch-023-1
- 测试框架：node:assert+vm 契约测试（settings-runparams-removed-20260909-011.test.mjs）
- 覆盖率：95%

## 总结

设置页删除「运行参数」分区：paintSettingsView 移除标题/五控件(stCliPath,stTimeout,stRetries,stResumeRestart,stAllowNonGit)/#stSave/密钥说明及无用 cfg/dis 变量；bindSettingsView 移除 POST /api/dispatch/settings 保存与 toast。服务端接口与 scheduler/codex-adapter 派发消费不动、落盘配置不清空（待确认项口径）。新增 5 例契约测试（先红后绿），按新口径更新 settings-simplify-20260909-002 / settings-title-removed / task-settings-simplify-20260909-001 三处旧断言；npm test 全量 120 文件通过。引入来源归因：REQ-20260906-003（四项运行参数）+ BUG-20260906-010（allowNonGit 开关，本次定位），已写入 design.md 与 README 头部。

## 明细

（可粘贴命令输出、失败用例说明等）
