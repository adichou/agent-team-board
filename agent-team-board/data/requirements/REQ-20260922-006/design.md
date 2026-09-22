# 设计 — REQ-20260922-006 发布版本的版本号改成 x.y.z 格式，发布时间以推送到远端仓库 main 分支的时间为准。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现状（探索核实 2026-09-22，详见 README「现状」节）：版本计划 version.json 无独立版本号字段，「版本号 20260921-001」由计划编号 `BLD-YYYYMMDD-NNN` 派生（`publish-flow.mjs` `versionNumberOf` + `web/build.js` 两处本地派生）；推送远端 main 成功后 `build-store.mjs` `recordPushSuccess` 已记录 `release.pushedAt`（推送事实对象），但非版本计划一等属性，且仅第五步面板展示。

## 方案

**数据层（build-store.mjs）**

- `createVersion` 新增顶层 `version` 字段：入参可带 `version`（校验 `^\d+\.\d+\.\d+$`；与既有计划重复抛 AtbError 含冲突计划号）；缺省自动分配 = 全部既有计划 version 的最大者 patch+1（按 major/minor/patch 数值比较），无任何历史 version 时 `0.1.0`。存量数据不迁移。
- `nextVersionId`（BLD 计划号）不变——计划号仍用于目录与审计，仅「版本号」显示与提示词换源。
- `recordPushSuccess` 在写 `release.pushedAt` 的同时同步顶层 `releasedAt = pushedAt`（同一时刻），语义完全跟随既有 pushedAt 规则（同基准不重置、基准变化更新）。读取口径：`releasedAt ?? release.pushedAt`（兜底存量已推送计划）。

**服务层（server.mjs）**

- POST `/api/build/version`：透传 `version` 字段（可缺省走自动分配），校验错误按现有错误通道返回。
- `/api/build/state` / 详情：version 与 releasedAt 随 version.json 透出；BPUB `publishedByBld` 汇总对 `release` 字段的覆盖合并时保留 pushedAt / releasedAt 信息（只并入 published/version/runId 标识）。
- publish-plan 装配 `versionNumber`：优先 `plan.version`，无则回退 `versionNumberOf(planId)`（旧数据口径）。

**前端（web/build.js + i18n.js）**

- 版本计划创建表单新增「版本号」输入：预填自动分配值（进入表单时从服务端建议值或本地 state 列表计算），可改，前端同格式校验。
- 列表卡片与详情头部「版本号」：`v.version ?? v.id.replace(/^BLD-/, '')`（回退旧派生）；已发布追加「发布于 <fmtTime(releasedAt ?? release.pushedAt)>」，未发布不显示。
- 第五步创建产品发布弹窗：version 输入默认值 = `v.version ?? ''`，placeholder 不变，手填覆盖。
- 提示词版本号（AI 总结/翻译/官网）由服务端装配，前端无改动。
- i18n：新增键「发布于」中英同步；「版本号」沿用既有键。

**自研，无新增依赖**（不适用开源选型：改动为既有数据结构与展示口径调整，无第三方库需求）。

## 风险与边界

- 存量已推送计划无 `releasedAt`：读取兜底 `release.pushedAt`，显示不回退。
- 版本号唯一性只在「当前存在的计划」范围内校验；删除计划后版本号可复用（与 BLD 编号口径一致）。
- 不改 `release.pushedAt` 既有语义（req-20260920-003 L2-3 断言依赖），`releasedAt` 是同步镜像不是替代。
- 产品发布（BPUB/PREL）自身的发行版本号体系不动，仅弹窗默认值联动。
- 涉 UI 展示但无布局/交互结构变化（新增一个表单项与一处只读文本），不另做 ui-demo。

## 实施记录（zcode-version-xyz，2026-09-22）

- 数据层 `scripts/lib/build-store.mjs`：新增 `VERSION_NUMBER_RE` 导出、`nextVersionNumber`（既有最大 x.y.z 的 patch+1，无历史 0.1.0）、`resolveVersionNumber`（空/缺省自动分配；非法格式、与既有计划重复抛 AtbError 含冲突计划号）；`createVersion` 增 `version` 入参与顶层字段；`recordPushSuccess` 同步写顶层 `releasedAt = release.pushedAt`（同基准不重置、基准变化更新，语义与 pushedAt 完全一致）。
- 服务层 `scripts/server.mjs`：POST `/api/build/version` 透传 `version`（校验错误 AtbError → 400）；`/api/build/state` 列表装配 `releasedAt: v.releasedAt || release.pushedAt || null`（存量回退在服务端统一计算；`release` 键随后被 BPUB 汇总覆盖，推送事实只经 `releasedAt`/`pushed` 透出）；publish-plan `versionNumber: v.version || versionNumberOf(id)`（存量回退派生）。
- 前端 `scripts/web/build.js`：`suggestNextVersion()` 预填建议值；创建表单新增「版本号」输入（`bldNewVersion`，空则服务端自动分配）；列表卡片与详情头部版本号 `v.version ||` 回退派生、已发布追加「发布于 <fmtTime(releasedAt)>」；产品发布弹窗发行版本号默认预填 `v.version`（去 `v` 前缀，可改）。
- i18n `scripts/web/i18n.js`：新增键「发布于」「版本号（x.y.z 语义化格式，留空自动分配）」「0.1.0（自动递增，可修改）」中英同步。
- 既有断言更新：`req-20260920-003.test.mjs` L4 的「版本号 = 计划编号后两段」按新口径改为「= 计划的 x.y.z 字段（本夹具首个计划自动分配 0.1.0）」——该断言的前提（版本号由计划编号派生）正是本需求变更点；L1-1（versionNumberOf 函数本体）不变，函数保留用于存量回退。
- 测试：新增 `scripts/tests/req-20260922-006.test.mjs`（D1–D3 数据层 / S1–S2 服务层真实 server / U1 前端源码契约 / U2 i18n），先跑红（6/6 失败）后实现转绿；build-store / req-20260920-003 / build-serve / bug-build-ver-published-chip 回归全绿。
