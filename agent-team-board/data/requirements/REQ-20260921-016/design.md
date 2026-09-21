# 设计 — REQ-20260921-016 版本计划列表中的操作按钮优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

发布模块左侧版本计划列表每张卡片自 REQ-20260913-004 / REQ-20260915-003 起逐步堆入了
「AI 完善（后迁出）→ 合并入 main（含失败重试）→ 创建并预检 → 查看发布记录 → 删除」五类操作；
而右侧详情在 REQ-20260920-003 五步流程（概况 / 关联条目与提交 / 文档编写 / 合并入 main / 正式发布）
中已分别具备合并主按钮、创建并预检入口与发布记录区。列表操作与详情步骤重复，卡片信息被按钮区挤压。

## 方案

（技术选型、接口设计、影响面）

纯前端布局迁移，不改任何 API 与状态机：

1. **列表卡片精简（`scripts/web/build.js` `renderVersionList`）**：移除卡片 `card-acts` 操作行与
   合并（`data-ver-merge` 模板）/ 创建并预检（`data-ver-release` 卡片模板）/ 查看发布记录
   （`data-ver-release-view`）三个按钮模板；`card-acts` 整行删除（无留白）。
2. **删除迁标题行右端**：删除键 HTML 原样（quiet 弱化 / `aria-label` / merging 与全局
   `state.mergeBusy` 禁用口径），插入卡片标题行 `.t` 内名称之后；标题侧包 `span.bld-card-title`
   （flex 可伸缩换行，长名 `overflow-wrap: anywhere`，`strong` 挂 `title` 提供完整名提示），
   删除键 `flex:none + margin-left:auto` 不被挤出。`.rel-list` 点击处理已忽略 button 点击，
   删除不误触卡片选中；绑定循环 `[data-ver-delete]` 保留。
3. **AI 完善迁描述块头部（`renderDetail`）**：`answerBtn` 模板与锁定口径（BUG-20260920-005 基准：
   merging / 已推送禁用并说明，merged 未推送可用）原样迁移，位置从概况顶部操作行
   （`bld-plan-acts`，本次移除）改为描述块头部操作组 `span.bld-desc-block-acts`，顺序固定
   「AI 完善 → 编辑」（AI 完善紧邻编辑左边）；编辑键原有 merging 禁用规则不变，已推送不禁用。
   编辑表单打开时描述块整体被 `renderPlanEditForm` 替换，两入口随之下线、取消后恢复（既有行为）。
4. **详情步骤入口不动**：合并主按钮在「合并入 main」步（`renderMergePane`，`mergeBlockReason`
   同口径）、创建并预检在「正式发布」步（`relCreateBtnHtml`，同键 `data-ver-release` 与
   `openReleaseConfirm` 弹层）、发布记录就在该步就地展示。`openReleaseTab` 保留为程序化激活入口。
5. **清理**：`[data-ver-release-view]` 绑定循环随按钮移除；CSS 移除 `.bld-plan-acts` 与
   `.rel-card .card-acts`，新增 `.rel-card .t .bld-card-title` / `.rel-card .t .bld-ver-del` /
   `.bld-desc-block-acts`；i18n 补登记 REQ-20260921-014 遗漏的「编辑版本名称与描述」词条
   （本次无新文案，其余词条全部沿用）。

**开源选型（REQ-20260909-015）**：自研理由——无合适库：本变更是既有自研看板 UI 内的按钮
位置迁移与少量 flex 布局，无新增外部能力，引入任何 UI 库的成本与体积均高于本实现；
未引入开源库，不创建 licenses.md。

**影响面**：`scripts/web/build.js`（renderVersionList / renderDetail / bindCommon）、
`scripts/web/style.css`、`scripts/web/i18n.js`（补 1 词条）；无后端 / API / 数据结构改动。

## 实施记录（2026-09-21）

- TDD：先补 `scripts/tests/req-20260921-016.test.mjs`（T1~T8 行为 + S1 静态契约，跑红 7/9）
  → 实现跑绿 9/9。
- 既有回归适配（口径随本单迁移到详情步骤入口核验）：`req-20260921-013`（T2/T3 卡片键断言与
  概况入口位置）、`bug-build-ver-card-acts-20260913-004`（B1/B2 合并键状态改在合并步主按钮；
  setup 补 publish-plan mock）、`bug-20260920-005`（U1 同上）、`bug-build-ver-published-chip-20260917-001`
  （P3/P5 卡片键与 release-view 绑定断言）、`build-release-card-items-search-20260915-003`
  （R1/R2/R7/R10 发布入口迁正式发布步口径）、`build-ui`（N9a 删除键位置断言）、
  `bug-build-merge-click-feedback-20260920-006`（M2/M4/M5/S1 唯一入口口径）、
  `product-release-ui`（H1 查看发布记录入口断言）。
- 全量 `npm test`：317 个测试文件中除 3 个与本单无关的失败（`req-20260918-002` /
  `req-doc-entry-20260916-003`：根 README.md/AGENTS.md 正被其他在途单改写导致文档契约断言
  失败；`bug-leak-residue-20260914-013`：并发端口残留抖动，单独运行通过）外全部通过；
  本单触及的构建模块测试全部通过。

## 风险与边界

- 合并 / 发布入口收敛为详情步骤单入口：列表不再能对未选中版本直接发起合并 / 创建发布——
  与需求「详情页面已经有了」一致；openMergeConfirm / openReleaseConfirm 带参直调与守卫口径
  全部保留（既有测试覆盖不回归）。
- 卡片键盘操作（tabindex 卡片 + 原生 button 删除键）与中英文文案沿用既有机制，无新增交互模式。
