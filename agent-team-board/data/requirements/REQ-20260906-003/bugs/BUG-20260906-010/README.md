# BUG-20260906-010 Codex 静态预检误报可运行而当前项目首次执行即被拒绝

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-003
- 创建：2026-09-06T06:40:04.266Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 C-P2。

## 现象

当前项目无 Git 仓库，预检 allOk=true 且宣称参数已核验；实际 exec 退出 1，提示 Not inside a trusted directory and --skip-git-repo-check was not specified；恢复参数也未实际核验。

## 复现步骤

在当前项目调用 GET /api/dispatch/preflight；再用适配器和预检探测到的真实 CLI 执行最小提示词；比较 allOk、退出码与 stderr。

## 期望行为

静态预检区分版本存在、参数兼容、项目运行约束和权限适配，失败条件下阻止开启并展示真实原因。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/server.mjs:staticPreflight；scripts/lib/codex-adapter.mjs:buildExecArgs
- 2026-09-06 已修复并加载到本机 8888 服务，待人工确认完成。

## 根因与实施

实际运行 `run-20260906-170709-5b1f` 在 16 毫秒内退出 1，stderr 为 `Not inside a trusted directory and --skip-git-repo-check was not specified.`。没有创建会话、没有执行 claim。旧预检将版本获取成功误当作参数兼容通过，只检查目录存在，没有检查项目的 Git 约束；结算只显示 worker-did-not-claim，隐藏了直接原因。

- 新增 `scripts/lib/codex-preflight.mjs`：检查 CLI 执行权限、真实版本、实际新建/续跑参数的帮助解析、Git 工作区约束以及服务进程读写项目/看板目录的权限。静态检查明确不代表登录、CLI 沙箱写入权限或模型可达性已验证。
- 项目设置新增 `allowNonGit`（布尔值、默认 false），运行配置中显示「允许非 Git 项目执行」。仅显式开启后传入 `--skip-git-repo-check`，新建、续跑和模型验证遵守同一策略；不修改沙箱和审批配置，不执行 git init。
- 开启派发和模型验证均要求静态检查通过。项目约束/参数错误直接记入运行结果并暂停执行器；其他无会话失败保留 stderr 摘要。
- 参数核验同时修复 BUG-20260906-009：resume 不再传不支持的 `-C`，由 spawn.cwd 保持项目目录，仍使用确切会话 ID。
- 重复派发由 BUG-20260906-006 修复，失败历史保留，不伪造原运行成功或会话 ID。

## 验证与当前状态

TDD 红阶段：适配器 2 组失败、API 1 组失败。修复后适配器 12 组、派发 API 7 组、调度器 19 组和未认领回归 3 组全部通过；全量 37 个测试文件中 36 个通过，唯一存量失败为 BUG-20260906-011 的 detail-close-btn T2。未测全库覆盖率。

本机 codex-cli 0.153.4 通过新建和续跑的真实帮助参数解析；未调用模型或运行需求开发。服务已在全部项目无运行任务且自动派发关闭时重启，已恢复此前的批量实施勾选范围。

用户随后明确同意非 Git 执行，已通过项目设置 API 保存 `allowNonGit=true`，静态预检全部通过。保留旧失败记录，为 REQ-20260906-006 重新启动 `run-20260906-183630-bb3a`，取得真实会话 ID `01a0764a-869d-7161-9081-39f838e3e860`。模型连接曾超时重连，恢复后已成功认领并进入 TDD；最终结果以新运行账本和需求测试报告为准。自动派发总开关保持关闭，仅重新执行用户指定的一项。

官方依据：[非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)；本机参数以 CLI --help 的实际核验为准。

## 关联（引入来源）

- 引入来源：REQ-20260906-003（静态预检把版本存在误当作参数兼容、未检查非 Git 约束，运行结算掩盖启动诊断；已通过 atb show 核验）。


## 复现步骤

1.

## 期望行为
