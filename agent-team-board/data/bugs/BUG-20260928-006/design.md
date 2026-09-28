# 设计 — BUG-20260928-006 官网资料更新的 AI 提示词的版本号不对，请修改。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260922-006**（版本号改独立 x.y.z 字段；其验收口径明确「发布文档 AI 总结 /
  翻译 / 官网提示词中的版本号同源」，编号经 `atb list` 核验存在。实现只改了展示层
  `versionNumber: v.version || versionNumberOf(v.id)` 与前端两处回退，`buildSiteWritingPrompt`
  调用点未传 `v.version`，提示词继续用 planId 派生 `YYYYMMDD-NNN`。REQ-20260922-006 之前
  版本号全局均为派生口径，提示词与展示一致、无此缺陷）。

## 根因分析

- `scripts/lib/publish-flow.mjs` `buildSiteWritingPrompt` 签名只收
  `{ projectRoot, siteRoot, planId, baseline }`，函数内 `versionNumberOf(planId) || planId`
  自行派生版本号，无接收计划 x.y.z `version` 字段的通道；
- `scripts/server.mjs` `/api/build/publish-plan` 装配 `sitePrompt` 时未传 `v.version`；
  同一响应的 `versionNumber` 字段却已按 `v.version || 派生` 口径展示 → 同屏两个版本号口径分裂，
  提示词一侧为错。

## 方案

**开源选型（REQ-20260909-015）**：未引入开源库（无合适库的原因：参数透传 + 回退归一的
纯函数小改，约 3 行逻辑，无外部依赖场景）。

1. `buildSiteWritingPrompt` 新增可选参数 `version`：`const ver = version || versionNumberOf(planId) || planId`，
   提示词内两处「版本号 ${ver}」统一取该值（首行说明 + 「发布计划号」行）；
2. `server.mjs` 调用点传 `version: v.version || null`：新计划取 x.y.z；存量计划（无 `version`
   字段）`null` → 构建函数内回退 `YYYYMMDD-NNN` 派生口径（REQ-20260922-006 旧数据不迁移），
   与同响应 `versionNumber` 展示口径完全同源；
3. 其余内容不动：完整计划号仍保留（官网提交消息匹配 / 官网时间窗扫描依据），已发布基准、
   材料范围、提交要求文案不变。

## 风险与边界

- 向后兼容：`version` 为可选参数，未传时行为与修复前逐字节一致（存量数据 / 既有调用零影响）；
- **同构缺口（新登记 BUG-20260928-007，不在本单范围）**：`buildDocSummaryPrompt` /
  `buildDocTranslatePrompt` / `buildDocProofreadPrompt`（发布文档 AI 总结 / 翻译 / 校对提示词）
  存在完全相同的版本号派生问题，本单仅按登记范围修复官网提示词，其余按 /bug 流程另行处理；
- 提示词为派发给 AI 子代理的指令文本，不进 i18n 双语体系（无界面文案变更，不涉及
  BUG-20260912-001 中英文同步）。
