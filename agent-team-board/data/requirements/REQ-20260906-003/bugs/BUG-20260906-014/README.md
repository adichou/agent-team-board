# BUG-20260906-014 Codex CLI 无法解析 agent-team-board hooks 的 process 类型

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-003
- 创建：2026-09-06T14:12:18.039Z

## 现象

重新执行 REQ-20260906-006 时，本机 codex-cli 0.153.4 输出插件 hooks 配置解析错误：unknown variant process, expected command/mcp_tool/prompt/agent；位置为已安装插件 0.3.14 的 hooks/hooks.json 第8行。源码和安装缓存均使用 ZCode 的 process + args + timeoutMs 配置。CLI 继续启动，但不能据此认定状态守卫已加载。证据：docs/agent-team-board/dispatch/runs/run-20260906-183630-bb3a/events.jsonl 的 item_0。期望按宿主支持的 hook schema 提供兼容配置，并验证状态守卫实际生效；不得以禁用守卫解决。

## 复现步骤

1. 在 Codex CLI（本机 0.153.4，`features.hooks = true`，插件 agent-team-board@personal 0.3.14 已启用）中执行 `codex exec`（如重跑 REQ-20260906-006 的派发）。
2. 观察启动事件流：`item.completed` 出现 `failed to parse plugin hooks config .../agent-team-board/0.3.14/hooks/hooks.json: unknown variant \`process\`, expected one of \`command\`, \`mcp_tool\`, \`prompt\`, \`agent\` at line 8 column 29`。
3. 源码 `hooks/hooks.json`（ZCode schema：`type: "process"` + `args` 数组 + `timeoutMs`）被 Codex 按 `.codex-plugin` 插件默认路径 `hooks/hooks.json` 自动发现并解析，因类型不兼容失败。

## 期望行为

- Codex 宿主加载本插件时不再出现 hooks 配置解析错误：按宿主各自 schema 提供配置（Codex 用 `type: "command"` 单字符串命令 + `timeout` 秒 + `PLUGIN_ROOT` 变量；ZCode 侧 `hooks/hooks.json` 保持 `process` schema 不变）。
- 状态守卫在 Codex 下实际生效，而非仅"CLI 容忍错误继续启动"：
  - `Bash` 工具（`tool_input.command`）触发 bash 模式拦截；
  - 文件编辑（Codex 经 `apply_patch`，路径在 patch 文本 `*** Update/Add/Delete File:` 行中，无 `file_path` 字段）触发 file 模式拦截 status.json 直写与源码保护。
- 不得以禁用守卫或移除 hooks 解决；需有守卫在 Codex 输入契约下生效的测试证据，及宿主真实解析通过的验证证据。

## 关联（引入来源）

- 引入来源：未定位（排查过程：`hooks/hooks.json` 属插件初始自带配置，现存最早条目 REQ-20260829-001 起的需求文档均未记载其创建；REQ-20260901-003 design 第 4 节明确记载该文件为「现有，不变」。根因是插件面向 Codex 发布（`.codex-plugin/plugin.json`）时未按 Codex hooks schema 适配——Codex 会默认解析插件根 `hooks/hooks.json`，与 ZCode 专属的 `process + args + timeoutMs` 格式冲突）。
