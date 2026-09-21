# 测试用例 — REQ-20260920-004 提供命令模块，提供 atb 所有命令的界面按钮下发

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现：`scripts/tests/req-20260920-004.test.mjs`（注册表 / 服务端 / 前端契约 / i18n 四节）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1a | 注册表命令与 atb.mjs 实际命令面双向一致：注册表首 token ⊆ atb.mjs 已注册主命令（无虚构）；atb.mjs 主命令（除 help 与排除三组 oncall/disc/growth）全部被注册表覆盖（无遗漏） | P0 | 通过 |
| C1b | 排除三组恒不出现：注册表任何命令的 token 序列不以 oncall / disc / growth 开头；EXCLUDED_PREFIXES 与该清单一致 | P0 | 通过 |
| C1c | 分组结构与 help 一致：README 范围的 11 个分组（数据与分发 / 条目生命周期 / 批量开发 / 执行回执 / 人工决策 / 挂起确认 / 批量完善 / 查询 / 服务 / 终端命令 及其子命令面）全部在册；高危清单含验收下限 8 项（delete/status/batch delete/refine abort/migrate/rebuild/prune-locks/pack）；cli 三命令 disabled；serve 不列入高危 | P0 | 通过 |
| C1d | validateRunRequest 白名单：未注册命令拒绝；command 非字符串拒绝；args 非字符串数组拒绝；args 携带 `--dir` 拒绝；disabled 命令拒绝执行；合法命令通过并返回 spec | P0 | 通过 |
| C2a | GET /api/cli/commands 返回注册表分组（分组名 / 命令 / 参数元数据），排除三组不出现 | P0 | 通过 |
| C2b | POST /api/cli/run 白名单：未注册命令 400；args 携带 --dir 400；cli disabled 命令 400；参数数组逐个传递（真实执行 `show` 带中文标题条目 ID 参数回显正确） | P0 | 通过 |
| C2c | 真实执行成功链路：`list` 执行 exitCode 0、stdout 回显条目表、durationMs ≥ 0；run-status 从 running 收敛到完成态 | P0 | 通过 |
| C2d | 执行失败链路：`show <不存在ID>` exitCode 非 0、stderr 完整回显 | P0 | 通过 |
| C2e | 同项目在途互斥：第一条未完成的执行期间再次下发 409；小项目（互斥按项目隔离）不受大项目在途影响 | P0 | 通过 |
| C2f | 执行中断不悬挂：run-status 对无记录项目返回 404 语义（服务重启后内存丢失口径），前端可判「结果未知」 | P1 | 通过 |
| C3a | index.html：顶栏「命令」页签位于「任务」与「设置」之间；#commandsView 容器存在；commands.js 在 app.js 之前加载 | P0 | 通过 |
| C3b | app.js 接线：VIEWS 含 commands；setView 联动 ATBCommands.enter；MODULE_SUB 含命令模块；命令模块隐藏全局搜索框；`/` 快捷键在命令模块聚焦模块内搜索框 | P0 | 通过 |
| C3c | commands.js：挂载 window.ATBCommands；左缘竖排页签（最近执行在前且默认 / 全部命令）；命令列表平铺无展开折叠；高危二次确认（取消参数保留）；serve 影响告知；cli 禁用原因与终端指引（无执行入口）；执行历史最近 20 次无清空入口；最近执行按命令去重 10 条（成功计入、失败不计入）；必填校验；命令预览含 --dir；输出区 stdout/stderr/退出码/耗时/复制；未初始化项目 needsBoard 命令初始化引导 | P0 | 通过 |
| C3d | style.css：命令模块样式存在（竖排页签 / 列表 / 详情 / 输出 / 历史 / 确认弹窗）；静态 commands.js 可经 HTTP 获取 | P1 | 通过 |
| C4 | i18n 中英同步：commands.js 源码全部中文片段命中 EN / EN_DYNAMIC / ALLOWLIST；注册表分组名 / 命令说明 / 参数标签全部命中词典 | P0 | 通过 |
