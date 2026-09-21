# 测试报告 — REQ-20260920-004 提供命令模块，提供 atb 所有命令的界面按钮下发

- 时间：2026-09-21T04:55:36.803Z
- 执行者：zcode-batch-059-07
- 测试框架：node:assert + http 自研 runner
- 覆盖率：70%

## 总结

看板新增「命令」模块：新建 scripts/lib/cli-registry.mjs 命令注册表（11 组全量命令，排除 oncall/disc/growth 三组，含 REQ-20260921-008 summary 组；高危 8 项、cli 组禁用、serve 影响标记）+ 服务端 GET /api/cli/commands、POST /api/cli/run（白名单 + 参数数组传递不经 shell + --dir 服务端注入 + per-root 在途互斥 + 输出截断）、GET /api/cli/run-status 轮询；新增 scripts/web/commands.js（左缘竖排页签最近执行默认/全部命令、搜索 / 聚焦、说明—参数表单—实时预览—高危二次确认—执行、stdout/stderr/退出码/耗时回显、执行历史 20 次、最近执行去重 10 条成功计入、serve 断连预期态、未初始化引导），index.html/app.js/style.css 最小接线，i18n 中英同步（EN_CLI 注册表词条块 + 动态句）；新增 scripts/tests/req-20260920-004.test.mjs 10 用例（注册表双向一致/白名单/服务端全链路/前端契约/i18n 覆盖），并按需求更新 10 个既有页签契约测试；npm test 303 文件全过

## 明细

（可粘贴命令输出、失败用例说明等）
