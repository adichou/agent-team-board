# 设计 — BUG-20260920-006 为什么在版本计划详情页面，点击合并到 main 按钮没有响应

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260920-003（`atb list` 核验存在，done）——五步发布流程落定详情页「合并入 main」
  按钮的禁用条件（`gate.locked` / 不在 dev / `mergeBusy`）与 title 回落逻辑
  （`gate?.reason || '前置条件未满足'`），禁用态点击无反馈与误归因由此引入；
  卡片行内按钮禁用口径由 REQ-20260913-004（按钮迁入卡片时确立，done）沿用
  「merging / merged(现 pushed) / mergeBusy」三态，不含文档门禁与 dev 检查，
  两入口口径分叉由此引入。本单修复点击反馈，不改变后端守卫与合并行为。

## 根因分析

1. **禁用态点击无反馈**：两处入口均用 HTML `disabled` 属性禁用按钮。按浏览器标准，
   disabled 表单控件不派发 click（也不冒泡），点击「物理上无事件」，原因只存在于
   悬停 title——这是「按钮没有响应」体感的直接来源（`scripts/web/build.js`
   `renderMergePane` 与 `renderVersionList` 的 mergeBtn）。
2. **title 误归因**：详情页按钮禁用由「不在 dev」或「全局合并执行中」导致时，
   title 取 `gate?.reason || '前置条件未满足'`——门禁未锁时一律回落
   「前置条件未满足」，与真实禁用原因不符。
3. **点击处理静默返回**：`openMergeConfirm` / `doMerge` 的
   `if (!v || state.mergeBusy) return;` 在版本不存在（另一标签页已删除、本页 DOM 未刷新）
   或全局合并执行中时无声返回，无 toast、无弹窗、无状态变化。
4. **两入口口径分叉**：卡片按钮禁用条件不含文档门禁 / dev 分支检查，同状态下
   详情页已禁用而卡片可点（确认后才被后端 409 + toast 拦截），反馈口径不一致。

## 方案

统一「禁用原因求值 + 点击守卫」为单一来源，两处入口共用；禁用视觉从
`disabled` 改为 `aria-disabled`（保留 `.btn` 禁用样式），使点击可被捕获并给出
真实原因 toast。该口径沿用本仓库既有先例 BUG-20260913-005（会话入口
`aria-disabled="true"` + 点击 toast 真实原因，`scripts/web/build.js` 941/944 行），
符合 WAI-ARIA 官方做法（APG 对「需解释为何不可用」的场景推荐 aria-disabled 而非
disabled），不涉私有能力。

1. **新增 `mergeBlockReason(v)`**（build.js，靠近 openMergeConfirm）：按优先级返回
   不可合并的真实原因，空串表示可合并。优先级：全局合并执行中（mergeBusy）→
   版本 merging → 已正式发布（pushed，BUG-20260920-005 基准）→ 五步门禁
   （暂无关联条目 / 文档未编写 / 未提交 / 范围过期，取 gate.reason，口径同
   `scripts/lib/publish-flow.mjs` `publishStepsState` 与服务端守卫）→ 不在 dev
   （含 detached HEAD，带分支名）。门禁与分支仅对已加载五步装配（`pfOf(v).plan`，
   即当前选中版本进入 docs/merge/release 步后）可知；未加载时不猜测，放行至
   确认后由后端守卫 409 + toast 拦截（真实原因同样可达）。
2. **两处按钮渲染共用该函数**：禁用时输出 `aria-disabled="true" title="<真实原因>"`
   （title 归因与实际原因一一对应，不再回落「前置条件未满足」误归因）；可用时保持现状。
   卡片按钮因此与详情页同口径（选中版本且装配已加载时同样检查门禁与 dev），
   消除「一端可点一端禁用」。merging / pushed / mergeBusy 三态为计划无关条件，
   任何卡片都生效。
3. **style.css**：`.btn:disabled` 扩展为同时命中 `.btn[aria-disabled="true"]`
   （现有 .btn 无 aria-disabled 使用者，无回归面），禁用视觉与光标维持
   「半透明 + not-allowed」（BUG-20260911-009 口径）。
4. **`openMergeConfirm` 守卫不再静默**：版本不存在 → toast
   「未找到该版本（可能已被删除）：请刷新页面后重试」；不可合并 → toast 真实原因
   （错误样式，同 BUG-20260913-005 口径）。可合并路径维持原弹窗行为零回归。
5. **`doMerge` 守卫不再静默**：版本不存在 → 关闭残留确认弹窗 + toast 刷新提示；
   mergeBusy → toast「合并中，请勿重复触发」，弹窗保留。合并执行本身（请求、
   toast、防重复触发语义）不变——防重复触动的真实保护本就在 `state.mergeBusy`
   状态守卫，aria-disabled 不削弱它。
6. **i18n**：新增 title / toast 文案进 `scripts/web/i18n.js`——静态词条
   （合并中请勿重复触发 / 暂无关联条目 / 三条文档门禁文案 / 版本不存在刷新 /
   前置条件未满足兜底）与 EN_DYNAMIC（当前分支是 ◇ 不在 dev / detached HEAD 两条），
   中英同步。
7. **测试**：新增 `scripts/tests/bug-build-merge-click-feedback-20260920-006.test.mjs`
   （vm 假 DOM 口径同 build-ui.test.mjs）：五状态 title 归因断言、点击守卫 toast
   断言（openMergeConfirm / doMerge 各分支）、两入口口径一致断言、可合并链路回归、
   i18n 词条断言、静态契约（mergeBlockReason 双入口共用 / aria-disabled 样式选择器）。
   受口径影响的既有断言（bug-build-ver-card-acts-20260913-004 B2、bug-20260920-005 U1、
   bug-build-ver-published-chip-20260917-001）随「disabled → aria-disabled + 新 title」
   同步核对更新，行为语义（禁用防重复触发 / 合并链路）不回退。

**开源选型（REQ-20260909-015）**：无引入。改动为纯前端自研（既有 toast / aria-disabled /
CSS 机制复用），无合适库（也无需库）——自研理由：仓库已有同口径先例与 i18n 体系，
引入库成本高于自研且无对应收益。不创建 licenses.md。

## 风险与边界

- **aria-disabled 与 disabled 的语义差**：aria-disabled 按钮仍可聚焦 / 可点击（这正是
  反馈所需的捕获通道），键盘 Enter 同样触发反馈；防重复触发由 `state.mergeBusy`
  状态守卫保证（与现状一致），不依赖 disabled 属性。屏幕阅读器对 aria-disabled 的
  「不可用」播报与 disabled 一致。
- **范围收敛**：只改「合并入 main」两处入口与其守卫 / i18n / 禁用样式选择器；
  其他模块的「禁用 + title」既有全局口径（开发启动、批量执行等）不动（README 待确认 1
  按最小范围处理：本单单独增强，不动全局口径）。推送主分支按钮的同类似问题不在本单范围。
- **未加载五步装配的卡片**（未选中 / 未进入相关步骤）：门禁与分支不可知，点击放行至
  确认弹窗，确认后由后端守卫 409 + toast 给出真实原因——反馈链路完整，不误报。
- **登录用户实际命中场景待确认**（README）：三条已核实路径均修复，不受该确认影响。
