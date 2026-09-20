# 设计 — BUG-20260917-001 版本计划发布后，左侧的列表中没有显示版本计划已发布的标签

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260916-001（已经 `atb list` 核验存在，状态 done）。
  该单把「从已合并版本计划发起发布」重设计为构建模块内的独立发布链路（BPUB 运行，`scripts/lib/build-publish-store.mjs`），发布状态只装配进右侧详情「发布」页签（`/api/build-publish/state` 前端按 `bldId` 过滤）；左侧版本列表的数据源 `GET /api/build/state`（`scripts/server.mjs`）从未装配发布状态，`renderVersionList()` 的标签集合只有版本计划合并四态（`STATUS_LABEL` / `statusChip()`），因此发布成功后左侧卡片无任何「已发布」标识。

## 根因分析

1. 左侧卡片标题行固定渲染 `statusChip(v.status)`，标签集合 = draft / merging / merged / failed（合并状态机），与发布运行状态无关。
2. 版本列表数据来自 `GET /api/build/state`，其 `versions` 只带版本计划自身字段 + 管理记录提交状态（`mgtOf`），不含任何发布汇总；发布记录需另行请求 `/api/build-publish/state`（`ensureReleaseData()` 仅在打开「发布」页签时按需加载并按 `bldId` 前端过滤）。
3. 数据层已具备支撑：BPUB 运行带 `bldId` / `status` / `version`（`store.listRuns(dataDir)` 可按 bldId 汇总），但该链路未被列表接口与列表渲染使用。

## 方案

**口径落定（README「待确认」项在此决定）：**

1. **已发布判定**：该版本计划（`bldId`）存在任一 `status === 'succeeded'` 的发布运行即视为「已发布」；多次运行（失败重试、成功后再建新草稿）任一成功即成立——发布成功是不可逆事实，成功后再建新发行版本的草稿 / 失败不撤下标识。汇总取最新一条成功运行（`createdAt` 最大）提供 runId / version。
2. **展示关系**：**替换**原合并状态标签——发布成功后左侧卡片标题行标签由「已合并」变为绿色「已发布」（`st st-ok`，与右侧「发布」页签 `relStatusChip` 同口径），title 提示成功运行编号与版本；合并状态仍在右侧详情「概况」可见。与条目 ui-demo.html「期望修复后」模式一致。
3. **中间态不上卡片**：未创建发布、或发布处于草稿 / 预检 / 进行中 / 失败 / 已取消的版本，卡片保持原「计划中 / 合并中 / 已合并 / 失败」四态，按钮禁用规则不变（中间态在「发布」页签查看，保持卡片标签语义单一）。
4. **实现方式**：**列表接口附带**——`GET /api/build/state` 为每个 version 附 `release` 汇总字段（`{ published: true, version, runId }` 或 `null`），随列表一次装配返回，前端零额外请求（避免逐版本请求风暴）；发布记录读取异常时降级为无标识（`release: null`），不阻塞构建模块 state。
5. **刷新联动**：发布页签动作（`relAction`）与「刷新状态」（`refreshReleasePane`）完成后顺带 `refresh()` 重取构建 state，使卡片标识随最新发布状态更新（单次显式动作触发一次刷新，不引入轮询）；页面刷新后因数据来自服务端同样保持。
6. **i18n**：沿用 `build.js` 模块内中文常量风格（与 `STATUS_LABEL` / `REL_STATUS_LABEL` 一致，文案直接复用 `REL_STATUS_LABEL.succeeded`），不借本单把构建模块状态标签整体接入 i18n（接入需整模块迁移，另行立项）。

**改动点：**

- `scripts/lib/build-publish-store.mjs`：新增纯汇总 `publishedByBld(dataDir)` —— 遍历 `listRuns`（已按 createdAt 新→旧），首条 `succeeded` 即该 bldId 最新成功运行，返回 `Map<bldId, { published: true, version, runId }>`。
- `scripts/server.mjs`：`GET /api/build/state` 装配 `versions` 时附带 `release: publishedByBld(dataDir).get(v.id) || null`（try/catch 降级）。
- `scripts/web/build.js`：新增 `versionChip(v)`——`v.release?.published` 为真渲染绿色「已发布」（title 带运行编号），否则回落 `statusChip(v.status)`；`renderVersionList()` 卡片标题行改用之；`relAction` finally 与 `refreshReleasePane` 追加 `await refresh()`。

**开源选型（REQ-20260909-015）**：未引入开源库。理由：本修复为既有前后端装配链路的小范围扩展（一处数据汇总 + 一处标签渲染 + 一处刷新联动），无对应成熟开源库需求，引入成本高于自研。

## 风险与边界

- `/api/build/state` 新增 `release` 字段为纯增量，旧前端 / 快照消费方不受影响；`publishedByBld` 读取失败降级为空 Map，构建模块可用性不依赖发布记录完好。
- 标签替换仅作用于左侧列表卡片；右侧详情概况、删除确认弹窗等仍用合并状态（`statusChip`），不误改口径。
- 不改变「发布」页签既有行为（列表 / 详情 / 动作 / 重试允许状态原样）；`refresh()` 追加只发生在显式发布动作完成后，单次请求，无轮询、无请求风暴。
- 测试：`scripts/tests/bug-build-ver-published-chip-20260917-001.test.mjs`（先红后绿）覆盖数据层汇总、服务接口附带与降级、前端标签替换 / 未发布不误显 / 动作后刷新联动。
