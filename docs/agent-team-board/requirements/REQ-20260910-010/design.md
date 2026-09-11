# 设计 — REQ-20260910-010 项目管理中，提供自动检测不存在的目录并支持一键移出所有不存在的目录

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`/api/project/remove`（scripts/server.mjs）先经 `resolveProjectPath` 校验目录存在才允许移出，
因此「目录已被删除/迁移」的注册记录反而无法从管理面板移出，只能手工编辑注册表。
需求要求：打开项目管理面板即自动检测所有已登记根目录，明确标出不存在项，并支持一键移出。

## 方案

（技术选型、接口设计、影响面）

### 服务端（scripts/server.mjs，全部注册表级、放在 resolveProject 之前，空态可用）

1. 新增 `POST /api/project/scan`（只读检测）：
   - 遍历 `loadRegistry().projects`，对每个根路径做 `fs.statSync`：
     - 目录存在 → `state: "exists"`；
     - `ENOENT` / `ENOTDIR`（含断开的符号链接）或 stat 成功但不是目录 → `state: "missing"`（附 `reason` 说明归类依据）；
     - 其他 stat 错误（`EACCES`/`EPERM`/`EIO` 等，无法确定存在性）→ `state: "error"`（附 `reason`），前端显示「检测失败/待确认」，**不纳入批量移出候选**。
   - 响应：`{ ok, projects: [{ path, state, reason }], summary: { total, missing, error }, defaultProject }`。
   - 不写注册表、不触发隐式登记（不带 ?project=），重复调用幂等。
2. 新增 `POST /api/project/remove-missing`（批量移出，确认时服务端重新核实）：
   - 请求体 `{ paths: [...] }`（非空数组、元素均为绝对路径，否则 400）。
   - 对每个候选：不在当前注册表 → `skipped`（已被其他窗口移出）；stat 判定为存在（目录）→ `skipped`（目录已恢复存在）；
     stat 无法确定（error 归类）→ `skipped`（状态无法确定，不误删）；仍为 missing → `unregisterProject` → `removed`
     （unregister 异常 → `failed` 附原因）。**只在请求给出的候选范围内操作，不扩大到注册表其他项。**
   - 响应：`{ ok, removed, skipped: [{path, reason}], failed: [{path, reason}], projects, defaultProject }`。
   - 沿用 `unregisterProject` 语义：仅改注册表（projects → removed），不删磁盘、不动条目状态、不停止任务。
3. 单项移出 `POST /api/project/remove` 放宽存在性校验：改用「绝对路径 + 尽力 realpath（不存在则原样规范化）」
   解析后交 `unregisterProject`（未注册仍 400）。存在路径行为不变（realpath 对齐注册表 canonical 路径）；
   已不存在的注册根路径（注册时即 realpath 后的 canonical 路径）按原串匹配即可移出。

### 前端（scripts/web/index.html + app.js + style.css）

- `#projList` 上方新增检测条 `#projScanBar`：`#projScanSummary`（总数/不存在数/检测失败数 +「未发现不存在的目录」）
  + `#projScanBtn`「重新检测」 + `#projRemoveMissingBtn`「移出所有不存在目录（N）」。
- `openProjPanel` 在 `refreshHealth` 后自动触发检测（`scanProjPanel()`），检测期间逐行显示「检测中」、
  按钮禁用（复用 `projSetBusy` 与 `projPanel.busy`，批量确认按钮纳入 busy 禁用集）。
- 每行 `.proj-row` 增加 `#projScanState` 文字状态（检测中/存在/不存在/检测失败：原因），不依赖颜色区分；
  路径 `overflow-wrap: anywhere` 既有契约保留。
- 批量移出两步走：点击 → `#projBatchConfirm` 确认区列出候选完整路径、数量与「仅移出列表，不删除目录与文档，
  不停止任务；目录恢复后可重新导入」语义；确认 → 调 `/api/project/remove-missing`（服务端重新核实）→
  按 `removed/skipped/failed` 分项汇报（成功 N、跳过 N（原因）、失败 N（路径）），失败不得显示全部成功；
  取消不产生任何变更。完成后 `state.projects` 更新 → `renderProjectSel()` 同步切换器；当前项目被移出 →
  剩余首项 `switchProject`，无剩余 → `clearProjectState()` 空态引导（沿用单项移出既有逻辑），随后静默重扫刷新行状态。
- 全局检测失败（接口异常）：显示错误与「重新检测」重试入口，批量按钮禁用，不沿用旧结果提交批量操作。

### 待确认项的处理（README「待确认」）

- 外接盘未挂载、断开的符号链接：统一按「不存在」归类（stat ENOENT/ENOTDIR 均判定根目录不可用），
  确认时服务端重新核实，目录恢复（挂载回来）即自动跳过，不会误移出。
- 后台定时检测：不做（需求已确定「打开面板即自动检测 + 手动重新检测」，定时轮询属待确认扩展，保持只读面板内检测）。

### 开源选型（REQ-20260909-015）

未引入开源库：检测即 Node 内置 `fs.statSync` 分类，UI 为既有面板的原生 DOM/CSS 扩展，
无合适且必要的第三方库（引入成本高于自研），不创建 licenses.md。

## 风险与边界

- 批量移出误删风险：三重防护——候选仅来自本次扫描的 `missing`（error/exists 不进候选）、确认区显式列路径、
  服务端确认时逐项重新核实，任何「已恢复/无法确定/已不在列表」均跳过并报告原因。
- 注册表写入竞态：与其他窗口并发时，未注册候选按 skip 处理，不会重复移出或报全局失败。
- `defaultProject` 播种闸门（REQ-20260910-005 的 removed 语义）不变：移出后轮询/深链不会把记录悄悄注册回来。
