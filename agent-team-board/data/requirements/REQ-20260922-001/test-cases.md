# 测试用例 — REQ-20260922-001 命令看板中要隐藏那些只能在 AI Agent 中执行的命令，例如 AI 开发，AI 分析相关的

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现文件：`scripts/lib/cli-registry.mjs`（agentOnly 标记 + visibleGroups + validateRunRequest 拒绝）、
> `scripts/server.mjs`（/api/cli/commands 过滤）、`scripts/web/commands.js`（最近执行残留过滤 + 全隐藏空态）。
> 测试文件：`scripts/tests/req-20260922-001.test.mjs`（C1 注册表 / C2 服务端 / C3 前端沙箱）；
> 受影响回归：`scripts/tests/req-20260920-004.test.mjs`（C2a 清单断言、C1d 提示语按新口径更新）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1a | 注册表命令面不变：五个 AI Agent 分组（batch / run / refine / summary / translate）与组内三命令（claim / report / hold declare）仅追加 agentOnly 标记，allCommands() 仍含全部命令（C1 同步校验不回归） | P0 | 通过 |
| C1b | visibleGroups()：五个分组整体不出现（无空分组标题残留）；条目生命周期组剩 new req/new bug/rename/delete/status/move/prune-locks；人工决策组剩 hold list/show/answer/resume/cancel；数据与分发 / 挂起确认 / 查询 / 服务 / 终端命令组完整保留 | P0 | 通过 |
| C1c | validateRunRequest 对 agentOnly 命令拒绝下发（batch create / run receipt / claim / report / hold declare，参数齐全也拒绝）；保留命令（show）照常通过 | P0 | 通过 |
| C2a | GET /api/cli/commands 只返回可见分组：五组不出现、claim/report/hold declare 不在清单；保留命令（commit which / prune-locks / hold list 等）在 | P0 | 通过 |
| C2b | POST /api/cli/run 对 agentOnly 命令（run receipt 带全参）返回 400，提示属 Agent 会话命令；保留命令链路不受影响 | P0 | 通过 |
| C3a | 最近执行残留过滤：localStorage 预置 batch next + list 记录，进入模块后 batch next 被忽略不展示、list 保留（不报错） | P0 | 通过 |
| C3b | 最近执行全为隐藏命令时显示空态提示（引导切换「全部命令」），不显示空白 | P0 | 通过 |
| C3c | 清单内无隐藏命令：搜索 batch / refine 落入「无匹配命令」空态且可清除恢复；搜索保留命令仍正常过滤 | P1 | 通过 |
| C3d | 保留命令行为回归：list 执行成功后最近执行计入、详情回填不变（沿用 BUG-20260921-010 口径） | P1 | 通过 |
| C4 | 回归：req-20260920-004（C1 同步 / C2 服务端全链路 / C3 前端契约 / C4 i18n）、bug-20260921-009 / 010 全部通过；i18n 无新增未入词典文案 | P0 | 通过 |
