# 设计 — BUG-20260928-007 发布文档 AI 总结 / 翻译 / 校对提示词的版本号仍用计划编号派生，未取计划 x.y.z 版本号

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260922-006**（总结 / 翻译提示词部分）+ **REQ-20260924-001**（校对提示词部分），
  编号均经 `atb list` 核验存在。口径与 BUG-20260928-006（官网提示词，同日登记）一致：
  - 总结提示词（REQ-20260921-008）与翻译提示词（REQ-20260921-012）先于版本号改造存在，
    当时版本号全局均为 planId 派生 `YYYYMMDD-NNN`，提示词与展示一致、无缺陷；REQ-20260922-006
    把版本号改成独立 x.y.z 字段（验收口径「发布文档 AI 总结 / 翻译 / 官网提示词中的版本号同源」），
    实现只改了展示层（`versionNumber: v.version || versionNumberOf(v.id)` 与前端两处），未改
    `buildDocSummaryPrompt` / `buildDocTranslatePrompt` 及其调用点——缺陷由 REQ-20260922-006 引入；
  - 校对提示词为 REQ-20260924-001 后引入：实现时沿用旧的派生口径（函数内
    `versionNumberOf(planId)`、调用点不传 `v.version`），落入了 REQ-20260922-006 同源口径之外的
    同构形态——该部分由 REQ-20260924-001 引入。

## 根因分析

`scripts/lib/publish-flow.mjs` 三个发布文档提示词函数（`buildDocSummaryPrompt` / 
`buildDocTranslatePrompt` / `buildDocProofreadPrompt`）签名均不收 `version`，函数内固定
`const version = versionNumberOf(planId) || planId` 派生 `YYYYMMDD-NNN`；`scripts/server.mjs`
三处（docs-summary / docs-translate / docs-proofread start）与 `scripts/atb.mjs` 三处
（summary / translate / docscheck start）调用点均只传 `planId: v.id` 不传 `v.version`。
新计划（REQ-20260922-006 起 version.json 有 `version` 字段）提示词内「版本号」与同屏
列表卡片 / 详情头部的 x.y.z 口径（`web/build.js` 两处显示逻辑）不一致。

## 方案

与 BUG-20260928-006 已修的 `buildSiteWritingPrompt` 同构：

1. 三个提示词函数签名各新增 `version = null` 参数，版本号统一改为
   `version || versionNumberOf(planId) || planId`（x.y.z 优先，存量计划回退派生口径，
   旧数据不迁移）；提示词内完整计划号 `BLD-…` 与其余内容（角色说明、文档清单、翻译 /
   校对约束）不变——版本号只出现在首行（翻译提示词）与「发布计划号」行的值位置，
   形态仅值变化，兼容 REQ-20260921-006 的「静态段 + 尾部运行参数区」缓存口径。
2. `server.mjs` 三处与 `atb.mjs` 三处调用点各传 `version: v.version`（与官网提示词调用点
   `version: v.version || null` 同口径）。

**开源选型（REQ-20260909-015）**：无合适库可替代——本修复为既有自研纯函数的参数透传
（一处签名扩展 + 六处调用点补参），引入第三方库无意义且成本高于自研；不新增依赖，
条目目录不创建 licenses.md。

## 风险与边界

- 存量计划（version.json 无 `version` 字段）：`v.version` 为 undefined → 回退
  `versionNumberOf(planId)` 派生口径，界面与提示词两态一致，不算缺陷、不迁移数据；
- 未传 `version` 的既有直接调用（含历史测试）：行为不变（回退派生），不破坏既有测试；
- 提示词缓存命中口径（REQ-20260921-006 静态段 + 尾部参数区）：版本号本就位于尾部
  运行参数区 / 首行派发句（值变化不影响静态前缀形态）；
- 完整计划号 `BLD-…` 保留（进度回执与提交消息匹配依据），只改「版本号」值。

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界
