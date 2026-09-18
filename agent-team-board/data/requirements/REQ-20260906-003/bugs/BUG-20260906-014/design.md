# BUG-20260906-014 实施记录：Codex 宿主 hooks schema 兼容

## 根因

1. Codex CLI（≥ hooks 特性开启时）会默认解析插件根 `hooks/hooks.json`，而该文件是 ZCode 专属 schema（`type: "process"` + `args` 数组 + `timeoutMs`），Codex 0.153.4 解析报 `unknown variant \`process\`, expected one of \`command\`/\`mcp_tool\`/\`prompt\`/\`agent\``。
2. 即便解析通过，Codex 的文件编辑经 `apply_patch` 工具下发：目标路径在 patch 文本头部行（`*** Update/Add/Delete File: <path>`），`tool_input` 无 `file_path` 字段——state-guard 的 file 模式会因取不到路径直接放行，状态守卫实际失效。
- 引入来源：见 README「关联（引入来源）」节（未定位：插件初始自带 hooks.json，面向 Codex 发布时未适配宿主 schema）。

## 方案（官方 manifest hooks 覆盖机制）

Codex 官方机制：插件 manifest（`.codex-plugin/plugin.json`）定义 `hooks` 条目时，Codex 使用 manifest 条目而**不加载**默认 `hooks/hooks.json`。据此双宿主各自供配置：

1. **新增 `hooks/codex.json`**（Codex schema）：
   - `PreToolUse` / `^Edit$|^Write$` → `node "$PLUGIN_ROOT/scripts/state-guard.mjs" file`，`timeout: 10`（秒），statusMessage 同 ZCode 侧。Codex 的 apply_patch 兼容匹配 Edit/Write。
   - `PreToolUse` / `^Bash$` → `node "$PLUGIN_ROOT/scripts/state-guard.mjs" bash`，同上。`$PLUGIN_ROOT` 为 Codex 注入的插件根变量（路径带双引号防空格）。
2. **`.codex-plugin/plugin.json`**：新增 `"hooks": "./hooks/codex.json"`；版本 0.3.14 → 0.3.15；longDescription 更正「钩子为 ZCode 专属」的过时表述。
3. **`.zcode-plugin/plugin.json`**：版本同步 0.3.15（仍指 `hooks/hooks.json`，process schema 不变——ZCode 侧零改动）。
4. **`scripts/state-guard.mjs`** file 模式增强：`patchTargetPaths()` 从 `tool_input.command`（patch 文本）提取 `*** Update/Add/Delete File:` 与 `*** Move to:` 目标路径，与 `file_path`/`path` 字段一并逐个检查（status.json 直写拦截 + 插件源码保护）。patch 路径同样按 `hook.cwd` 解析相对路径。拒绝文案由「禁止用 Write/Edit 直接修改」改为「禁止直写修改」以涵盖 apply_patch 形态。

## 测试（scripts/tests/codex-hooks.test.mjs，TDD 先红后绿）

- H1 codex.json 全 handler 符合 Codex schema（type=command、无 process/args/timeoutMs、timeout 正整数秒）
- H2 matcher 覆盖 `^Edit$|^Write$` 与 `^Bash$`，command 引用 `$PLUGIN_ROOT` 与正确模式参数
- H3 `.codex-plugin/plugin.json` 声明 hooks 覆盖默认路径（解析错误消除的机制前提）
- H4 回归：ZCode 侧 hooks/hooks.json 保持 process schema 不变
- H5 apply_patch 直写 status.json → exit 2（Codex file 输入契约）
- H6 patch 更新看板 markdown（内容提及 status.json 字样但目标非它）→ 放行
- H7 绝对路径 patch 改插件源码：无锁 exit 2 / 有锁 exit 0
- H8 Codex Bash 契约：`atb status <ID> done` 拦；`cat status.json` 放行
- H9 回归：ZCode file_path 契约直写 status.json 仍拦
- 全量回归：`npm test` 57 个测试文件全部通过（失败 0）

## 真实验证（宿主侧）

- `codex plugin add agent-team-board@personal` 重装 → 缓存 0.3.15 含 hooks/codex.json。
- `codex exec --json`（两次）：启动事件流**不再出现** `failed to parse plugin hooks config ... unknown variant \`process\``（对比 dispatch/runs/run-20260906-183630-bb3a/events.jsonl 的 item_0），会话正常完成（turn.completed）。
- **已知限制（如实）**：端到端「模型发起工具调用 → PreToolUse hook 拦截」在本机不可验证——本机 codex 0.153.4 的 shell 工具因缺 code-mode host 整体 fail closed（连 `echo` 探针也无法执行，属环境预置问题，修复前同样存在）；且插件 hooks 按 Codex 信任机制首次需人工在 `/hooks` 审阅信任。守卫在 Codex 输入契约下的行为已由 H5–H8 子进程实测覆盖，待人工在可用环境做一次最终确认。
