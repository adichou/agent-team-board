# 设计 — REQ-20260910-027 删除所有任务中对开发人员的设置功能

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260907-002 为三类批量任务（批量开发 / 批量完善 / 批量 Commit）引入「开发人员」
设置：3 处 UI 输入框（`#batchDev` / `#refineDev` / `#commitDev`）+ CLI `--dev`，用途仅
「调度会话命名 + 看板展示」，链路含 localStorage 记忆（`atb.batch.dev`）与 git
user.name 首次预填（`/api/batch/current` 的 `gitUser`）。本需求整体下线该功能。

## 方案

（技术选型、接口设计、影响面）

纯删除型改动（输入 → 创建 → 提示词 → 展示/搜索 → CLI 全链路移除），分层如下：

### 1. lib 层（`scripts/lib/`）

- `batch.mjs`：删除 `normalizeDeveloper()` 与 `DEV_MAX_CHARS`（无其他消费方，
  `oncall-store.mjs` 的 `STAFF_MAX_CHARS` 是独立常量仅注释对齐）；`generatePrompt()`
  签名保留 `developer` 参数但**忽略**（`void`，兼容旧调用，与 REQ-20260909-011 对
  `agent` 参数的处理同法），不再生成「请将当前会话名改为：<batchId>-<开发人员>」行；
  `createBatch()` 不再读取/校验/落账 `developer`（参数保留但忽略）；`batchBrief()`
  不再输出 `developer`。
- `refine-store.mjs`：删除 `normalizeDeveloper` import；`buildRefinePrompt()` /
  `createRefineBatch()` 同上（参数保留但忽略、不落账）；`refineBatchPublicView()` 与
  `refineBatchBrief()` 不再输出 `developer`。
- `commit-store.mjs`：删除 `normalizeDeveloper` import；`buildCommitPrompt()` /
  `createCommitBatch()` / `commitBatchPublicView()` 同上。

### 2. server.mjs（API）

- 删除 `gitUserName()` 与 `/api/batch/current` 无批次分支的 `gitUser` 字段
  （唯一消费者是开发人员输入框预填，随输入框删除成死链路）。
- `/api/batch/create`、`/api/refine/create`、`/api/commit/create`：不再透传
  `body.developer`（**遗留入参忽略不报错**，与 `body.limit` / `body.agent` /
  `body.mode` 的既有惯例一致），响应不再含 `developer`。
- `/api/batch/current`：`batch` 视图与 `queue` 排队项均不再输出 `developer`。

### 3. 前端（`scripts/web/app.js`）

- 三处启动区删除输入框：`renderDevStartBar()` 顶行只剩「启动」按钮；
  `renderRefinePanel()` / `renderCommitPanel()` 启动区删「开发人员」label 行。
- 删除 `batchDevInitial()`；全部 `localStorage` `atb.batch.dev` 读写删除
  （`createBatchAndCopy` / `createRefineBatchAndCopy` / `createCommitBatchAndCopy`
  请求体不再带 `developer`；终态「启动新一轮」不再回退上次值）。
- 展示侧：运行态状态行（develop/refine/commit 三处概况页签）、排队批次行、全局任务
  行 meta 的「开发人员」片段删除；`retryRunFromRecord` refine 重建请求体只带 `ids`。
- 搜索过滤：`globalTaskMatches` 与 BUG-20260910-009 排队批次过滤字段列表去掉
  `developer`（其余字段口径不变）。

### 4. CLI（`scripts/atb.mjs`）

- 三个 create 的 `parseOpts` 白名单移除 `dev`；帮助文本（主 usage、`BATCH_USAGE`、
  `REFINE_USAGE`、`COMMIT_USAGE`、`--limit` 提示句）同步去掉 `--dev`。
- 显式传 `--dev` 时与 `--limit` 同款 `die` 明确提示「开发人员设置已移除
  （REQ-20260910-027）」（CLI 面向人工，明确反馈优于静默吞值）。
- `create` / `summary` 输出行与 JSON payload 不再含「开发人员 / developer」。

### 5. 文档同步

- `skills/agent-team-board/SKILL.md` CLI 速查去掉 `[--dev 名称]`。
- `docs/agent-team-board/batch-execution.md` §6 的 REQ-20260907-002 命名指令段更新为
  「REQ-20260910-027 已移除」口径。

### 待确认决策（README「待确认」逐项落定）

| 待确认项 | 决策 |
| --- | --- |
| API/CLI 遗留 `developer` 入参 | API 忽略不报错（旧客户端兼容）；CLI `--dev` 显式 die 提示已移除；lib 函数签名保留参数但忽略 |
| `gitUser` 字段与 `gitUserName()` | 一并移除（预填链路唯一消费者已删，保留即死代码） |
| 账本 `developer` 字段 | 新建批次不再写；存量账本不迁移不清洗，读取侧缺字段自然回退（无展示即无需回退文案） |
| 替代展示（git user.name 自动展示/命名） | 不做（边界明确：字段整体下线，命名指令不再出现） |

### 存量兼容

- 历史批次账本中的 `developer` 字段保留原样；`getBatch` / `getRefineBatch` /
  `getCommitBatch` 读取不受影响，公开视图/brief/CLI 摘要均正常工作（只是不再透出）。
- 存量批次冻结的提示词文本不回写；面板展示走 `normalizePromptForDisplay` 归一，
  旧命名行按 BUG-20260910-001 既有归一逻辑处理，不受本改动影响。

**开源选型（REQ-20260909-015）**：本需求为纯删除型改动，未引入任何新依赖，无开源库
选型问题（自研理由：无合适库的原因——不涉及新增功能实现，仅移除既有自研代码）。

## 风险与边界

- 改动横跨 lib / server / 前端 / CLI 四层与 16 个既有测试文件，需全量回归
  （`npm test` = `scripts/tests/run-all.mjs`）。
- 提示词模板变化仅删除行，未填开发人员的存量提示词与新版逐字一致（零回归基线沿用
  batch-core D2 的「逐字一致」断言思路，反向改造为「传 developer 也与不传逐字一致」）。
- 不动三类任务的候选口径、排队/幂等、暂停/终止、回执与状态机；不改「启动 = 创建任务
  并复制提示词」等既有口径文案（仅去掉开发人员相关片段）。

## 实施记录（2026-09-10，zcode-batch-20260910-032-03）

按上述方案完成四层移除与文档同步，全部落于：

- `scripts/lib/batch.mjs`：删 `normalizeDeveloper()` / `DEV_MAX_CHARS`；`generatePrompt()`
  与 `createBatch()` 的 developer 入参 `void` 忽略；账本与 `batchBrief()` 不再输出。
- `scripts/lib/refine-store.mjs` / `scripts/lib/commit-store.mjs`：同口径（去 import、
  prompt 命名行、账本字段、publicView/brief 透出）。
- `scripts/server.mjs`：删 `gitUserName()` 与 `/api/batch/current` 的 `gitUser`；三个 create
  端点遗留 developer 忽略、响应去字段；current 的 batch/queue 视图去字段。
- `scripts/web/app.js`：三启动区输入框与 `batchDevInitial()` 删除；localStorage
  `atb.batch.dev` 读写全删；三个创建函数与 refine 单条目重建请求体不带 developer；
  状态行 / 排队批次行 / 全局任务行 meta 删除开发人员片段；全局与排队搜索过滤字段去
  developer。
- `scripts/atb.mjs`：三处帮助文本与 parseOpts 白名单去 dev；显式 `--dev` die 明确提示
  已移除；create/summary 输出与 JSON payload 去 developer。
- 文档：`skills/agent-team-board/SKILL.md` CLI 速查去 `--dev`；
  `docs/agent-team-board/batch-execution.md` §6 命名指令段改为移除说明。

附带修复：`scripts/web/app.js` 内 `renderZcodeBatchPanel` 概况模板一处既有的闭合反引号
损坏（diff 显示 HEAD 为反引号、工作区为单引号，导致全文件语法错误、60 个测试文件连带
失败），已按 HEAD 原样恢复为反引号；该损坏非本需求改动引入，修复后 175 个测试文件
全量通过。

新契约测试：`scripts/tests/dev-setting-removed-20260910-027.test.mjs`（D1-D8，先跑红后
跑绿）；既有 13 个测试文件按移除后口径更新（batch-core D1-D4 / batch-cli / batch-serve /
batch-ui U14 / refine-cli / refine-store / refine-ui R12-3 / commit-serve / commit-ui /
global-board G1 / agent-generic A2+G1 / batch-search-filter L3 / tasks-tabs N13）。
