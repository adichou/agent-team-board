# 设计 — REQ-20260922-001 命令看板中要隐藏那些只能在 AI Agent 中执行的命令，例如 AI 开发，AI 分析相关的

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

命令清单唯一事实源是服务端注册表 `scripts/lib/cli-registry.mjs`（`GET /api/cli/commands` 序列化 `CLI_GROUPS`，前端不手抄清单）；执行走 `POST /api/cli/run`（`validateRunRequest` 白名单 + 参数数组传递）。AI Agent 工作流命令（`batch` / `run` / `refine` / `summary` / `translate` 五组及组内 `claim` / `report` / `hold declare`）所需的 RUN-ID / 批次 ID / 会话标识只存在于 Agent 会话，人工经界面执行无意义或无上下文。

## 方案

**实现层级：注册表标记 + API 过滤（服务端权威），前端零清单逻辑**：

1. **注册表标记（唯一事实源内表达隐藏范围）**：`CLI_GROUPS` 追加 `agentOnly` 标记——五个整组隐藏分组（`batch` / `run` / `refine` / `summary` / `translate`）用**组级标记**（新增命令自动继承，不会漏标）；组内隐藏的 `claim` / `report` / `hold declare` 用**命令级标记**。`allCommands()` 归一化 `agentOnly: !!(c.agentOnly || g.agentOnly)`，`findCommand` / `validateRunRequest` / 前端消费同一口径。注册表本体保留全部命令（不删除——`findCommand` 白名单查找与 req-20260920-004 C1 注册表↔CLI 同步校验口径不变）。
2. **清单过滤**：新增 `visibleGroups()`（过滤 agentOnly 分组/命令，返回副本不改本体）；`server.mjs` 的 `GET /api/cli/commands` 改下发 `visibleGroups()`。整组隐藏的分组整体不出现（无空分组标题），组内隐藏后分组标题与其余命令保留。搜索空态、深链残留（选中命令不在清单 → 详情回未选中空态）由既有前端逻辑自然成立。
3. **下发同步拒绝（防绕过界面直接调接口）**：`validateRunRequest` 对 `agentOnly` 命令拒绝（参数齐全也拒绝，提示「属 AI Agent 会话工作流命令，不提供网页下发」），与 `disabled` 拒绝同层。理由：网页是人工入口，Agent 会话以 CLI 执行不经此接口，拒绝无合法损失；且 `batch delete` / `refine abort` 等高危命令无人工操作场景，堵住直调接口的误触发面。`atb` CLI 命令面完全不变（`validateRunRequest` 仅服务端 `/api/cli/run` 使用）。
4. **前端残留过滤**：`commands.js` `renderRecent()` 先按 `findCmd` 过滤「最近执行」记录（隐藏命令的 localStorage 残留被忽略而非报错，记录不清除）；全部被过滤时显示既有空态提示（引导切换「全部命令」），不显示空白。无新增界面文案（复用既有空态文案，i18n 无需新词条）；服务端拒绝提示与既有错误回显通道一致，不入静态词典（同「未注册命令」口径）。

**执行历史（会话内最近 20 次）**：保留隐藏生效前的旧记录可回看（README 已声明验收不要求过滤；隐藏命令不再有新执行产生，历史自然收敛）。

**验收第二条（claim / report / hold declare）**：README「待确认」按默认隐藏口径实施（`agentOnly` 命令级标记，撤销隐藏只需删三处标记，无结构改动）。

**开源选型（REQ-20260909-015）**：自研。无合适库的原因：本改动是自有注册表数据的标记 + 过滤 + 白名单拒绝（约 60 行），无第三方依赖必要；不引入任何开源库，不创建 licenses.md。

## 风险与边界

- 不改 `atb` CLI 命令面、参数、行为；Agent 会话（终端 CLI）照常使用被隐藏命令。
- 不以「从注册表删除命令」实现：`findCommand` 白名单与 C1 同步校验（req-20260920-004）不回归（测试已覆盖）。
- `visibleGroups()` 返回副本，注册表本体恒为全量；`/api/cli/commands` 响应分组数由 12 → 7，req-20260920-004 C2a 断言已按新口径更新。
- 撤销/调整隐藏范围只动 `cli-registry.mjs` 标记，服务端与前端零改动。
- 不隐藏专用界面已承载的人工能力；任务页批量面板等不受影响（未触碰）。
