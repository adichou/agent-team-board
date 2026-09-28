# 设计 — BUG-20260928-012 发布页面取消草稿模块

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：BUG-20260915-014 + BUG-20260928-002（编号已经 `atb list` 核验真实存在）
  - BUG-20260915-014：发布页签就地展示「发布记录列表卡片 + 运行详情」模块，并引入卡片摘要渲染
    `REL_STEP_LABEL[r.targets?.webapp] || r.targets?.webapp`（targets 值为对象，回退分支字符串化为
    `[object Object]`）；草稿（draft）态运行随之驻留页面。
  - BUG-20260928-002：一键发布链路「确认 → 自动创建草稿 → 预检 → 启动」——草稿在确认阶段即创建，
    链路中止（预检未通过 / 确认弹窗被关闭）后草稿残留且无取消 / 清理入口（cancel 服务端能力存在但
    界面无对应模块 / 按钮）。

## 根因分析

1. **草稿残留无清理入口**：一键发布把「创建草稿」前置到二次确认之后立即执行，而「取消后续阶段」
   按钮只对 prechecking / running 状态渲染，draft 态既不能取消也不能删除——中止链路必然残留草稿卡片。
2. **摘要 `[object Object]`**：运行数据 `targets:{webapp:{status:'pending'},site:{status:'pending'}}`
   （build-publish-store.mjs createRun），而摘要渲染把 `r.targets.webapp`（对象）当状态字符串键查
   `REL_STEP_LABEL` 必然未命中，回退 `|| r.targets?.webapp` 把对象整体拼接成 `[object Object]`。
   release.js（隐藏模块）第 306 行存在同构缺陷（`TARGET_STATUS_LABEL[r.targets?.webapp] || r.targets?.webapp`）。
3. 人工定夺（2026-09-28）：修复方向不是补「取消草稿」按钮，而是**删除整个发布运行记录展示模块**，
   发布交互收敛为「检查提示 → 二次确认 → 执行 → 出结果」一条直线。

## 方案

前端重构（scripts/web/build.js）为主，服务端不改：

1. **删除展示模块**：`renderReleasePane` 不再渲染发布记录列表卡片（含摘要行）与运行详情面板；
   随之删除 `renderRelDetailPane`、`renderPublishDirectories`、`openPublishDirectory`、`relAction`、
   `openRelPlan` / `closeRelPlan` / `confirmRelStart` / `renderRelPlanModal`、`fetchRelDetail` /
   `selectReleaseRun`、`relStatusChip` / `relStepChip` 及对应绑定（data-rel-run / data-rel-act /
   data-rel-detail-retry / data-publish-open / bldRelPlan*）。原运行详情动作（预检 / 重新冻结 /
   预览发布计划 / 刷新状态 / 取消后续阶段）不再出现在发布页签。服务端能力（cancel 等）与内部草稿
   复用机制（draft/failed/canceled 可续跑）保留不动——草稿降级为内部机制，不再上屏。
2. **发布直线流程**（`state.releaseFlow` 会话态：`version`（补填版本号）→ `checking`（检查中）→
   `confirm`（二次确认）→ 执行，`failed-check`（检查未通过）分支不进入执行）：
   - 点击「发布」（`openPublishConfirm`，守卫不变：仅 merged、须配置官网仓库、发布中不重复）：
     计划有版本号直接开始检查；无版本号先弹「发行版本号」补填（沿用旧输入校验）。
   - 检查 = 复用 / 创建草稿（from-build）+ 预检（run/:id/precheck，服务端口径沿用 BUG-20260928-011
     重构后的必检 / 提醒项）——检查结果在弹窗内逐项展示；有不通过项 → 明确提示「本次不进入发布」，
     不进入二次确认、不发 start；全部通过 → 进入二次确认（列检查项 + 「即将发布版本 vX.Y.Z。」）。
   - 确认发布 → POST start（token = 预检指纹，服务端守卫不变）。执行期间无中间进度界面，仅
     「发布」按钮禁用并显示「发布中…」；前端 3 秒一轮轮询运行状态，执行结束（succeeded / failed）
     直接显示结果面板：
     - 成功：`✓ 发布成功` + 发布时间（`fmtTimeLocal` 按浏览器本地时区格式化 YYYY-MM-DD HH:mm:ss，
       标注「（本地时间）」）+ 原「标签已更新 / 计划已锁定」说明；
     - 失败：`✕ 发布失败` + 失败阶段与错误信息 + 「重试」按钮——重试重新走同一发布流程
       （检查 → 确认 → 执行，README 人工口径，不跳过确认）。
   - 轮询离开发布步 / 切版本 / 切项目即停止（与 siteTimer 同口径）；进入发布步发现既有
     running/prechecking 运行同样启动轮询（覆盖服务重启后的恢复场景）。
3. **摘要对象渲染修复**：build.js 卡片摘要路径随模块删除消失；release.js 第 306 行同构缺陷改为
   `TARGET_STATUS_LABEL[r.targets?.webapp?.status] || '未提供'`（按状态标签显示，字段缺失显示
   「未提供」）。全局不再存在把 targets 对象当状态字符串拼接的展示路径。
4. **中英文同步**：新增 / 变更文案集中在 scripts/web/i18n.js（EN 静态 + EN_DYNAMIC 插值），
   随模块删除的旧词条一并清理。

**开源选型（REQ-20260909-015）**：本修复为既有前端模块交互重构（删除模块 + 重排既有 fetch 链路
+ 一次 setTimeout 轮询），无新增能力需要引入库；自研理由：无合适库（改动全部落在自有 UI 代码内，
不涉及可复用的第三方能力），未引入开源库，不创建 licenses.md。

## 风险与边界

- 老测试口径迁移：BUG-20260928-002 与 BUG-20260915-014 的既有用例中针对「记录列表 / 详情动作区 /
  预检后直接启动」的断言按本 Bug 新口径改写（发布链路服务端契约与守卫不变，仅前端交互顺序调整）。
- 「检查通过后不进入执行需用户显式确认」与 BUG-20260928-005（正式发布以二次确认为准）口径一致：
  确认时点仍是 start 前，recordReleaseConfirm 服务端落账不受影响。
- 预检 checks 的渲染按服务端返回 label / detail / advisory 原样展示，不在前端重新发明检查规则
  （BUG-20260928-011 预检口径由服务端单一事实源提供）。
- 失败结果面板取「最新 failed 运行」的错误信息；draft / canceled 残留不上屏（模块已删），
  内部复用机制照常，不新增「取消草稿」入口（人工口径明确不加）。
