# 设计 — REQ-20260906-019 Codex 一键派发要使用批量实施的方案，放弃当前的方案

> 由 Agent 在 /dev 开发前补充，人可随时批注。批次 worker（zcode-batch-003-21）按调查补全并实施。

## 背景

当前「派发给 codex」（REQ-20260903-003 落地形态）：

- 前端 `launchCodex()`：复制提示词 → `POST /api/dispatch/codex` → 失败降级 `codex://threads/new?prompt=…` 深链。
- 服务端：`buildCommandScript()` 生成 `.command` 脚本（`mkdtempSync` + `0o755`），`open` 拉起 Terminal 新标签执行。

问题：弹终端、无账本、看板不可追踪；与 REQ-20260906-003 已落地的后台调度方案（`codex exec` + `dispatch/runs`
账本 + 抽屉可视化）形成两套并行方案。用户决定放弃旧链路，一键派发统一走批量实施方案。

## 方案

### 1. 调度器新增 `dispatchItem(itemId)`（scripts/lib/scheduler.mjs）

把 `tick()` 中「为已选定条目启动 run」的部分抽成内部函数 `startRunForItem(item)`（hub 全局并发获取 →
项目实施锁 → 复核条目仍 accepted → `store.newRun` → worker 提示词落盘 → `stampProjectLock` → 设置
`S.current` → `spawnAttempt`），`tick()` 与 `dispatchItem()` 共用，行为完全一致。

`dispatchItem(itemId)` 前置校验（任一失败返回 `{ ok: false, error }`，不动任何状态）：

1. `S.stopping`（服务关停中）/ `S.current`（当前有执行，首期并发 1）；
2. CLI 配置（与 `tick()` 同判据：注入 `cli.path` 或 settings 的 `cliPath` 存在）；
3. 条目存在且 `status === 'accepted'`；
4. 依赖满足（`store.depsSatisfied`，与自动选单同口径）;
5. 项目占用（`findProjectBlocker`：unknown in-progress / cleanup_pending）；
6. `startRunForItem` 内部的 hub/项目锁互斥（失败原样返回占用方）。

语义要点：

- **不依赖 `S.enabled`**：一键派发是用户显式单条动作，自动派发开关关闭也照常执行；也不改写开关状态。
- run 生命周期是事件驱动的（`spawnAttempt` 的 promise 结算链），timer 只负责自动选新单，二者不冲突；
  `tick()` 开头 `S.current` 非空即返回，不会干扰进行中的一键派发。
- 不受 REQ-20260906-018 scope 影响：scope 只过滤自动选单候选；一键派发由用户指定单条，直达。
- 结算路径复用既有逻辑：网络重试、认证/额度暂停、续跑、上报核对、工作区遗留检查全部照旧。

### 2. 服务端端点替换（scripts/server.mjs）

- 删除旧 `POST /api/dispatch/codex`（.command 生成 + open）及 `OPEN_CMD`/`CODEX_CLI` 常量（`os`/`spawn`
  依赖若无他用一并清理）。
- 新增 `POST /api/dispatch/codex/item`：body `{ id }`；`dispatch.ITEM_ID_RE` 校验单号（非法 400）→
  `schedulerFor(root).dispatchItem(id)` → `{ ok, runId?, error? }`。错误经 `ok:false` 呈现（与
  `resume-item` 的语义一致），仅参数非法走 400。

### 3. 前端重写 `launchCodex`（scripts/web/app.js）

- `POST /api/dispatch/codex/item` `{ id }`；成功：`flashDispatchBtn('已开始后台执行 ✓')` +
  `state.batch.mode = 'codex'` + `openBatchDrawer()`（自动展示当前执行）；失败：toast 服务端 `error`。
- 移除：剪贴板复制、`codex://` 深链、`fallback` 分支。`copyDispatchText` 仍服务 zcode 通道。
- `dispatchPrompt()` 删除 codex 分支（调度器内置 worker 提示词），仅保留 zcode 版；点击处理 codex 分支
  改为 `launchCodex(b, it)`。
- `dispatchBtnHtml` codex 按钮 title 更新为后台执行说明。

### 4. 旧方案清理（scripts/lib/dispatch.mjs）

移除 `CODEX_CLI_DEFAULT`、`shQuote`、`buildCommandScript`、`buildCodexThreadUrl`；保留 `ITEM_ID_RE`
（新端点校验）与 `buildZcodeWorkspaceUrl`（zcode 深链纯函数，测试引用）。

### 影响面

- 改动文件：`scripts/lib/scheduler.mjs`、`scripts/server.mjs`、`scripts/lib/dispatch.mjs`、`scripts/web/app.js`。
- 测试：重写 `scripts/tests/dispatch-launch.test.mjs`（旧 .command/深链用例作废，改为新契约 + 集成）；
  `dispatch.test.mjs` P1/P1.5 改为 zcode 单版断言；`scheduler.test.mjs` 增 D21+；`dispatch-api.test.mjs` 增 T7。
- 不动：Zcode 批次链路、REQ-20260906-018 scope 语义、codex-adapter、execution-verifier、UI 抽屉结构。

## 风险与边界

- **永不降级**：旧链路的深链/剪贴板兜底一并移除；环境不满足时如实报错转人工，符合「自动派发永不降级为
  弹终端或复制粘贴流程」的既定约束（REQ-20260906-003 范围与限制）。
- **并发语义**：一键派发与自动派发共用 `S.current`（项目内串行）与 hub（全服务并发 1），不会并行两项。
- **开关隔离**：一键派发不改写 `enabled`/scope/paused 状态；被一键派发暂停执行器（如认证失败）时，
  自动派发同样暂停——环境错误是项目级事实，不应被绕过。
- **兼容性**：旧端点直接删除（前后端同仓同版本发布，无跨版本调用方）；历史 `.command` 临时文件不回收
  （本就注释可随时删除）。

## 实施记录（2026-09-07，zcode-batch-003-21）

- `scripts/lib/scheduler.mjs`：抽取 `startRunForItem(item)`（自动选单与一键派发共用启动路径，失败返回
  `{ ok:false, error, waiting? }`，tick 沿用原 waiting 形态不变）；api 新增 `dispatchItem(itemId)`，前置
  校验顺序：关停中 → 当前执行 → CLI 配置 → 单号 → 条目存在且 accepted → 项目占用 → 依赖 → 互斥启动。
- `scripts/server.mjs`：`POST /api/dispatch/codex/item`（`ITEM_ID_RE` 校验非法 400，AtbError 路由）替换旧
  `.command` 端点；移除 `CODEX_CLI`/`OPEN_CMD` 常量与 `spawn` 导入（`os` 仍被注册表/模型预检使用，保留）。
- `scripts/lib/dispatch.mjs`：仅保留 `ITEM_ID_RE` 与 `buildZcodeWorkspaceUrl`，移除
  `CODEX_CLI_DEFAULT`/`shQuote`/`buildCommandScript`/`buildCodexThreadUrl` 与 `path` 导入。
- `scripts/web/app.js`：`dispatchPrompt(it)` 仅 zcode 版；`launchCodex(b, it)` 改 POST 新端点，成功后
  flash「已开始后台执行 ✓」并切到 Codex 页签打开批量实施抽屉；失败 toast 服务端 error；按钮 title 更新。
- 测试：TDD 先红后绿。`scheduler.test.mjs` +D21～D25；`dispatch-api.test.mjs` +T7（端到端）；
  `dispatch-launch.test.mjs` 整体重写（U1～U4/C1～C2 契约 + I1～I3 临时端口集成，旧 .command/深链用例作废）；
  `dispatch.test.mjs` P1/P1.5 改为 zcode 单版。`npm test` 全量 46 文件 0 失败。
- 遗留说明：/tmp 中旧版本测试遗留的 `atb-dispatch-*` 目录属历史产物（生成脚本注释明示可随时删除），
  I1 用快照对比断言「不新增」规避污染，不做清理。
