# BUG-20260906-009 真实 codex exec resume 不支持适配器传入的 -C 参数

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-003
- 创建：2026-09-06T06:40:04.233Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 C-P1。

## 现象

本机 codex-cli 0.153.4 执行适配器构造的 exec resume <ID> --json -C <project> -，立即退出 2，报 unexpected argument '-C' found，尚未进入会话或模型调用。PATH CLI 和自动探测到的 ChatGPT 内置 CLI 均复现。

## 复现步骤

通过 startCodexExec 传入 resumeThreadId 和绝对 projectRoot，使用真实 CLI；核对 args、退出码和 stderr。

## 期望行为

按 exec 与 exec resume 各自支持的参数构造命令，真实同项恢复能够进入指定会话。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/lib/codex-adapter.mjs:buildExecArgs
- 2026-09-06 随 BUG-20260906-010 的真实参数核验完成修复，待人工确认完成。

## 根因与修复

buildExecArgs 为新建和恢复共用 `--json -C <projectRoot>`，但本机 0.153.4 的 resume 子命令没有 `-C`。已改为只在新建时传 `-C`；恢复仍以 spawn.cwd 指定项目目录，以确切会话 ID 调用 resume，提示词继续通过 stdin 注入。没有改用 --last，也没有修改沙箱和审批设置。

## 验证

- codex-adapter A1 新预期先红后绿，适配器 12 组测试通过；假 CLI 的帮助分支也会拒绝 resume 的 `-C`，避免再次被宽松夹具掩盖。
- 调度器恢复用例 D4 验证同一 run 通过确切会话 ID 续跑后上报，调度器总计 19 组通过。
- 本机 `/Applications/ChatGPT.app/Contents/Resources/codex` 0.153.4 已使用实际构造的参数加 `--help` 验证新建/恢复均通过。仅检查解析，不向模型发请求，因此不声称已完成真实模型会话恢复。
- 全库 37 个文件中 36 个通过，唯一存量失败为 BUG-20260906-011。未测全库覆盖率。

## 关联（引入来源）

- 引入来源：REQ-20260906-003（CodexExecAdapter 错把新建命令的 -C 参数用于 resume；已通过 atb show 核验）。


## 复现步骤

1.

## 期望行为
