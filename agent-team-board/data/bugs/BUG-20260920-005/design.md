# 设计 — BUG-20260920-005 已经合并入 main 的版本计划允许重新关联条目和提交

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260920-003（五步发布流程：merged 锁定 link/docs、`assertItemsEditable` 与
  merge 端点的 merged 拒绝均由该单落定；已 `atb list` 核验存在）；关联 BUG-20260914-020
  （「AI 完善」按钮禁用口径对齐到 merged 的直接来源，本单将其一并迁移到推送完成时点）。

## 根因分析

登记口径是「完成推送到远端仓库（正式发布）后才锁定」，但五步流程落定时把三类操作
（关联条目与提交 / 合并入 main / AI 完善）与步骤导航的锁定基准统一取了 `status === 'merged'`
这一更早的时点；「正式发布 → 推送主分支」成功（`recordPushSuccess` 落 `release.pushedAt`）
反而不产生任何新锁。于是「已合并、尚未推送」的版本被提前锁死，而推送完成时点没有独立锁定语义
——锁定整体早于口径一个阶段。合并执行的隔离重放机制本就支持增量（逐条 cherry-pick、
已并入提交幂等记成功、重试只补未合并条目），机制无障碍，仅被状态机提前拦死。

## 方案

锁定基准统一后移：新增 `buildStore.isPushed(v)`（判定 = `release.pushedAt` 落盘，即五步流程
「正式发布 → 推送主分支」成功；产品发布 `release.published` 与官网命中不计入——登记待确认
第 1 条默认口径），三处锁定基准全部从 `merged` 改为 `isPushed`：

1. 数据层 `scripts/lib/build-store.mjs`：`assertItemsEditable` 改为「merging 锁 / 推送完成锁，
   merged 未推送放行」（add / remove / setItemCommit 全链路）；`beginMerge` 允许
   draft / failed / merged（未推送），merging 与推送完成后拒绝——merged 重开合并沿用既有
   增量语义（server 端 `pending = items.filter(!mergedAt)` 只补未合并条目，`finishMerge`
   对已合并条目保持 `mergedAt` 不动，无未合并条目时幂等回 merged）。
2. 服务端 `scripts/server.mjs`：`POST /api/build/version/merge` 移除 merged 拒绝、改为
   推送完成后 409（「版本已正式发布，不可再合并（如需调整请新建版本）」）；
   `/api/build/state` 版本列表随行附带 `pushed` 布尔（`release` 字段仍为产品发布汇总，
   不改既有语义）供前端判定。`/api/build/version/items` 经数据层新口径自动放行 / 拦截。
3. 步骤门禁 `scripts/lib/publish-flow.mjs` `publishStepsState`：link / docs 的
   `lockedScope` 与 merge 的 `canMerge` 从 `merging || merged` 改为 `merging || pushed`
   （待确认第 2 条默认口径：docs 随后移，否则补关联后无法重新提交文档、重开合并走不通）；
   推送完成后的锁定 reason 为「已正式发布，范围锁定 / 不可再合并（如需调整请新建版本）」。
   合并门禁（有条目 + 文档 overall=committed）不放宽，增删条目 / 换 commit 后旧文档提交标识
   照常失效（scopeStale），需重新提交文档才可重开合并。
4. 前端 `scripts/web/build.js`：`pushedOf(v)` 辅助（读 state 附带的 `pushed`）；卡片行内
   「AI 完善 / 合并入 main」、详情「关联条目与提交」步的添加 / 移出 / 换 commit、
   合并步按钮与「暂不可合并」提示，锁定口径同步改为 merging / pushed；`openAnswerModal`
   防御路径（带参直调与无参回落）同口径拦截推送完成后的版本。新增 / 变更文案已同步
   `scripts/web/i18n.js`（含移除旧词条「已合并入 main，不允许再 AI 完善」）。

**开源选型（REQ-20260909-015）**：本单为既有状态机锁定基准迁移，仅改动自有代码分支判定与
文案，无新增第三方库需求；未引入开源库，不创建 licenses.md（自研理由：无合适库——变更点
是本项目发布状态机的时点语义，不存在可复用的通用库）。

**待确认项的默认口径落地**：第 1 条按 `release.pushedAt`；第 2 条 docs 随后移；
第 3 条（推送完成后「删除」键）与第 4 条（卡片 meta 阶段文案 merged 现标「正式发布」）
无默认口径，本单**不改**，维持现状（merged / 推送完成后均可删、meta 文案不变），留人工拍板。

## 风险与边界

- **文档门禁依赖**：merged 未推送放开 link/docs 后，补关联 / 换 commit 会触发 scopeStale，
  重开合并前必须重新提交文档——已有测试覆盖（D3 / build-serve S6.5），门禁未放宽。
- **幂等重开合并**：对无未合并条目的 merged 版本发起合并是幂等 no-op（回 merged、刷新
  mainSha），不会重复 cherry-pick；已由 build-serve 断言覆盖。
- **saveInfo（名称 / 描述编辑）未锁**：三类操作之外的 AI 完善数据落盘路径 `saveInfo`
  按验收口径仅前端拦截（按钮 + 弹窗防御路径），数据层维持只锁 merging——避免把「版本计划」
  步的普通信息编辑一并冻结；如需正式发布后冻结版本信息，属新口径另行登记。
- **前端 `pushed` 依赖 state 端点**：旧版本.json 无 `release.pushedAt` 时 `pushed` 为 false，
  行为等同「未推送」（存量已合并版本因此解锁为可补关联——与本 Bug 期望一致）。
- **中英文同步**：新增 title / reason / 禁用文案已入 EN 词典并跑 i18n 相关测试
  （i18n-dict / i18n-lang / i18n-runtime / i18n-wiring / i18n-coverage）。
