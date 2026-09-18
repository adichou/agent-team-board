# 设计 — REQ-20260907-002 批量实施批次关联开发人员：调度会话命名与看板展示

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

单条派发已约定会话名改为单号（REQ-20260904-001：`请将当前会话名改为 <单号>`），
但批量实施的主调度提示词（`batch.generatePrompt`）没有会话命名指令，批次账本
（`batch.json`）也没有开发人员字段：多人使用同一项目时，Zcode 会话列表与看板
批次面板区分不出批次由谁发起/负责。

## 方案

### 1. 账本核心层（scripts/lib/batch.mjs）

- `createBatch(dataDir, { limit, ids, projectRoot, mode, developer })` 新增 `developer`：
  - 规范化：String → trim；空/缺省 → `null`；含换行/控制字符 → `AtbError` 拒绝
    （名字会内嵌进提示词单行与 Zcode 会话名，不得折行）；
    码点长度 > 30（新常量 `DEV_MAX_CHARS = 30`）→ `AtbError` 拒绝。
  - 新批次账本写入 `developer: <string|null>`；幂等返回旧批次不改动账本
    （幂等判定仍以冻结候选集合为准，与 limit 现状一致，developer 不参与）。
  - 仅用于展示与会话命名，不参与任何权限判断。
- `generatePrompt({ ..., developer })`：developer 非空时在「批次：」行后插入一行
  `请将当前会话名改为：<batchId>-<developer>。`（沿用 REQ-20260904-001 句式）；
  developer 为空时提示词与现状逐字一致（不回归，不加缺省名）。
- `checkBatch` 不加字段：最小核对协议（≤2KiB）载荷合同不变。
- `batchSummary` 返回的 `batch` 即账本对象，天然携带 developer；存量批次缺字段
  由展示层回退「未指定」，不迁移账本。

### 2. CLI（scripts/atb.mjs）

- `atb batch create [--dev <开发人员>]`：`--dev` 透传 createBatch（非法值 die 提示）。
- `batchPublicView` 增加 `developer` 字段（summary/pause 的 JSON 视图）。
- `batch create` 成功输出附带「开发人员 <名>」（未填显示「未指定」）；
  `batch summary` 输出开发人员行，存量批次显示「未指定」。
- USAGE 文案同步更新。

### 3. 看板服务（scripts/server.mjs）

- `POST /api/batch/create`：body.`developer` 透传；非法值经 AtbError → 400（全局
  错误处理既有行为）；响应增加 `developer`。
- `GET /api/batch/current`：`batch` 视图与 `queue` 排队项各带 `developer`；
  无批次（创建表单数据）时 stats 附 `gitUser`（`git config user.name`，
  `spawnSync` 超时/非 git 仓库 → null），供 UI 首次预填。

### 4. 前端（scripts/web/app.js）

- 创建区新增「开发人员」输入框（`#batchDev`，maxlength=30，说明仅用于会话命名与
  展示）：初值优先级 localStorage `atb.batch.dev`（上次使用）> stats.gitUser（首次
  预填）> 空。
- `createBatchAndCopy`：读取输入值（运行视图「创建下一批」无输入框时回退
  localStorage 记忆值）随请求提交；成功后非空值写入 localStorage、空值移除记忆键。
- 运行面板 meta-grid 新增「开发人员」格：`b.developer || '未指定'`；
  排队批次行尾追加「开发人员 <名/未指定>」。

## 风险与边界

- 回执（receipt）与核对（check）协议载荷不变，不新增字段，避免破坏 ≤2KiB 合同。
- 存量批次账本不迁移：无 developer 字段一律在展示层回退「未指定」。
- git 预填只在「无记忆值」时使用，git 不可用回退空，不阻塞创建（developer 可空）。
- developer 不参与幂等判定：重复创建（候选一致）返回旧批次沿用旧提示词，与 limit
  现状一致，不构成回归。
- 互斥/领取/回执流程不读取 developer，权限语义零变化。
