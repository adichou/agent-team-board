# 设计 — BUG-20260915-014 点击发布按钮后提示发布模块已被隐藏，需修复

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260915-002（`atb list` 核验存在，in-progress）。
  其在 `scripts/web/build.js` 新增「查看发布记录」与创建成功后的 `gotoProductRelease()`，
  经 `atb:goto-view`（view=release）跳转发布模块；而发布模块已被 REQ-20260911-002
  （`atb list` 核验存在，done）纳入 `HIDDEN_VIEWS` 暂态隐藏，`setView()` 对隐藏视图
  回落需求模块并 toast「发布模块已暂时隐藏」。跨模块入口与隐藏开关未同步收敛，
  导致用户点发布按钮被弹回需求模块。修复按本 Bug README 的期望行为改为版本详情内
  「概况 / 发布」页签就地展示，不再跳转隐藏模块。

## 根因分析

- `scripts/web/app.js` `HIDDEN_VIEWS = {'oncall','files','marketing','release',…}`，
  `setView('release')` → toast「发布模块已暂时隐藏，已回到需求模块」并回落 `status`。
- `scripts/web/build.js` `doCreateRelease()` 创建草稿成功后调用 `gotoProductRelease()`；
  版本卡片「查看发布记录」按钮同样绑定 `gotoProductRelease()` → 派发
  `atb:goto-view {view:'release', product:true}` → 命中隐藏回落分支。
- 结果：草稿已创建（服务端 201）但用户被带离当前版本，误以为创建/查看失败；
  「查看发布记录」则必然弹回需求模块。

## 方案

在构建模块右侧版本详情内新增「概况 / 发布」两个页签（标题下方，默认概况），
发布记录按「当前项目 + 当前版本（bldId）」就地展示，跨模块跳转入口收敛为本页签切换：

1. **状态**（build.js 模块 state）：
   - `detailTab: 'overview' | 'release'`（默认 overview；随 `enter(项目变化)` 重置）。
   - `rel`：发布页签数据 `{ verId, seq, phase(idle|loading|ready|error), error, runs,
     runId, detailSeq, detailPhase, detailError, detail, planModal, busy }`；
     以 `verId` 与 `seq`/`detailSeq` 双重防串：切换版本 / 项目时整体置空（新对象），
     旧异步响应因闭包对象与 `state.rel` 身份不一致被丢弃，不覆盖新选择。
2. **数据（全部只读 GET，按需加载）**：
   - 列表：`GET /api/product-release/state?project=…` → 前端过滤 `run.bldId === 选中版本 id`。
   - 详情：`GET /api/product-release/run/:id`（选择运行 / 刷新时）。
   - 计划预览：`GET /api/product-release/run/:id/plan`（弹窗展示，确认才执行）。
   - 动作（沿用现有发布流程与允许状态，显式点击触发）：
     `POST /run/:id/precheck | refreeze | start | retry | cancel`；`start` 必经计划确认弹窗。
3. **交互**：
   - 版本卡片「查看发布记录」→ `openReleaseTab(verId)`：选中该卡片版本并切到发布页签，
     不再派发 `atb:goto-view`（app.js 侧监听器保留为通用基础设施，无其他派发方）。
   - 创建发布弹层与校验不变；成功后选中该版本、切到发布页签并选中新草稿
     （`data.run.id`），失败保留输入与错误，创建中禁用重复确认（既有 rc.busy 不变）。
   - 切换版本：清空旧版本发布记录、选中与错误（`selectVersion` 统一置空 `rel`）；
     切换项目：`enter` 重置 `rel` 与 `detailTab`。
   - 快照：`snapshot()` 增加 `detailTab`，恢复时校验合法值；发布页签恢复后按需拉取。
4. **发布页签视图**（`renderReleasePane`）：
   - 加载：`正在加载发布记录…`（页签与版本列表仍可用，不以旧数据顶替）。
   - 读取失败：`发布记录读取失败：<原因>` + 只读「重试」（只重发读取，不触发任何动作）。
   - 空态：`当前版本暂无发布记录`；未合并版本「创建发布」禁用并提示
     `请先完成合并入 main`，已合并可点（打开既有创建弹层）。
   - 正常态：左列运行卡片（运行 ID · 发行版本号 · 状态 · Web App / 官网目标摘要 ·
     失败摘要），点击选择；右侧详情（运行 ID、发行版本号、状态、阶段清单、
     Web App / 官网目标结果、失败阶段与错误信息）；数据缺失显示「未提供」，不猜测。
   - 状态标签区分草稿 / 预检 / 进行中 / 等待人工 / 已发布 / 失败 / 已取消；
     草稿不显示为已发布。
   - 动作区与 release.js 产品页签同口径：draft → 预检 / 重新冻结 / 预览发布计划
     （未预检禁用）；failed → 重试失败阶段 / 重新冻结；prechecking|running → 取消后续阶段；
     任意状态 → 刷新状态。计划确认弹窗（steps + warning）确认后才 `start`。
5. **i18n**：新增静态文案入 `scripts/web/i18n.js` EN，含插值的动态句入 EN_DYNAMIC（◇ 占位）。

**开源选型（REQ-20260909-015）**：未引入开源库。自研理由：无合适库——本修复是项目内
前端视图状态机与既有 fetch/DOM 模式的扩展（发布数据接口、弹层、页签模式均已存在于
build.js / release.js），引入外部库无增益反而增加依赖面。未使用开源库，不创建 licenses.md。

## 风险与边界

- 发布页签只读展示 + 显式动作，切页签 / 选择记录 / 刷新 / 重试读取均不发写请求；
  `start` 仍必经计划确认（沿用现有发布流程），不会自动执行发布。
- `/api/product-release/state` 返回全项目运行，前端按 `bldId` 过滤，避免服务端接口改动；
  数据量级为单项目发布运行数（个位到十位），客户端过滤成本可忽略。
- 旧测试 `build-release-card-items-search-20260915-003.test.mjs` R2 断言
  「查看发布记录」派发 `atb:goto-view`——该行为正是本 Bug 修复点，按新口径更新断言
  （就地切页签、不派发事件）；`product-release-ui.test.mjs` H5 仅静态断言 app.js
  监听器存在，不受影响（监听器保留）。
- 页签 / 选中运行的刷新持久化按 README「待确认」最低要求：快照仅保留 detailTab 与
  版本归属，运行选中不持久化（重进自动选最新一条），不混入其他版本记录。
