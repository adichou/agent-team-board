# 设计 — REQ-20260929-002 发布模块删除 Web App 构建目标，不再校验任何构建目标

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

BUG-20260928-011 起预检不再含构建识别，但执行阶段仍保留 5 阶段（sync-source / webapp-build / webapp-verify / site-deploy / site-verify）与 `profile()` 构建识别（预检数据）。Chrome 扩展等无 `package.json` / 无根 `index.html` 的项目在 `webapp-build` 必然失败；`inputs()` 还要求源码远端（origin 或唯一 remote）与官网配置读取。本条目按人工两轮定夺做纯删减。

## 方案

**开源选型（REQ-20260909-015）**：纯删减 + 既有内部模块重构，未引入开源库（无合适库——删除本产品自有流程；引入成本高于自研不适用）。

### 服务端（scripts/lib/）

1. **`build-publish.mjs`（执行器）**：
   - 删除 `profile()`、`serve()` / `get()` / `verifySite()`（本机回验服务）、`clean()`、`siteMaterials()` / `siteBase()` / `contentDir()` / `escRegExp()`、`execute()` 全部执行阶段与 `servers` / `stopServers()`。
   - `inputs()` 收敛为本地只读冻结输入：`{mainBranch, mainSha, devSha, version}`——不再解析远端、不读官网配置 / 物料（发布不依赖二者）。
   - `precheck()`：删除 `profile` 计算与 `precheck.profile` 落库、`r.frozen.homepage` 刷新；冻结输入仍作预检新鲜度指纹（plan 校验）。必选检查（发布文档 / 挑选条目）与提醒项不变。
   - `plan()`：步骤收敛为 1 条（将版本计划状态更新为「已发布」，发布时间取确认时点，不推送远端、不构建官网仓库）；token=预检指纹、extraCommits 警告保留。
   - `start()`：token 校验通过 → `recordReleaseConfirm`（确认动作直接写版本计划发布态，幂等首认固化；**失败即发布失败**——不再吞错，run 置 failed + 回退确认锁，可重试）→ run 置 `succeeded`。返回 `{run}`（无 completion）。`cancel()` / `recover()` / `openDirectory()` / `refreeze()`（按新 run 无 stages 兼容）保留。
2. **`build-publish-store.mjs`**：删除 `steps`；`createRun()` 不再初始化 stages / targets / directories（存量旧运行文件原样保留读取）；`publishedByBld` / `assertUnpublished` / `PUBLISHED_READ_ONLY` **移至 `build-store.mjs`**（解除 build-store → build-publish-store 既有反向依赖，避免循环）。
3. **`build-store.mjs`**：
   - `recordReleaseConfirm` 首认固化时同步 `v.releasedAt = confirmedAt`（发布时间取确认时点，REQ-20260922-006 的推送同刻口径随之退役；存量已推送值不动）。
   - 新增 `publishedByBld`：**并集口径**——版本计划确认态（`isReleased`，新落账口径）∪ 存量 succeeded 运行（历史发布不做迁移、不回退标识）；`assertUnpublished` / `PUBLISHED_READ_ONLY` 随迁（本地实现读版本计划，runs 列表用与 `publishRunOf` 同源路径的只读函数）。
4. **`build-publish-api.mjs` / `server.mjs`**：`assertUnpublished` / `publishedByBld` 调用点改从 build-store；run 详情 GET 的 directories 装配保留（旧运行目录查看）；config 接口保留（「发布」模块 PREL 与设置页仍用）。

### 前端（scripts/web/build.js + i18n.js）

- 发布步删除「动作一 · 推送远端 / 动作二 · 官网资料更新」区（`renderReleaseFlowPane` / `pushMain` / `siteScan` / siteTimer 及绑定与导出）——源码远端推送与官网物料不再由「构建」模块发布步承担。
- `openPublishConfirm` / `renderPublishActions`：删除「未配置官网仓库」禁用与「前往设置」入口；禁用原因仅剩 未合并 / 发布中 / 已发布。
- 检查通过后拉取 `GET run/:id/plan`，二次确认弹窗展示发布计划（1 条，服务端数据）。
- `i18n.js`：删除死键（中英同步）：「请先配置官网仓库」「请先配置官网仓库后再发布」「无法识别冻结源码的 Web App 构建方式（…）」及 renderReleaseFlowPane 专属文案键（删除前逐一 grep 确认全仓库无使用）；新增发布计划区与 1 条步骤的动态键。

### 兼容

- 存量 BPUB 运行（含 stages / targets / directories）不迁移：readRun / listRuns 原样读取，目录查看 API 保留；`publishedByBld` 并集口径保证 BUG-20260928-005 之前「run succeeded」历史发布不丢已发布标识、不被解锁。
- `webapp-profile.mjs` 保留（PREL 流水线与官网仓库构建识别共用，不在范围）。

## 风险与边界

- publishedByBld 迁至 build-store 属模块职责调整（已发布态是版本计划属性），server / api 调用点同步，接口签名不变。
- start 中先落账后置 run succeeded：落账成功而 run 写失败时 run 卡 running，由 `recover()` 置 failed + 回退确认锁，重试重新落账，最终一致（与现状同宽口径）。
- 删除执行阶段后「已确认但运行失败」窗口仅剩落账写失败一种，BUG-20260928-015 回退链路保留兜底。
