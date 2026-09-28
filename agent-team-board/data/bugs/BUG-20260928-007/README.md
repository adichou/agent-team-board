# BUG-20260928-007 发布文档 AI 总结 / 翻译 / 校对提示词的版本号仍用计划编号派生，未取计划 x.y.z 版本号

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-28T05:26:28.286Z

## 现象

与 BUG-20260928-006（官网提示词版本号不对）同构：publish-flow.mjs 的 buildDocSummaryPrompt / buildDocTranslatePrompt / buildDocProofreadPrompt 均只收 planId 并在函数内以 versionNumberOf(planId) 派生 YYYYMMDD-NNN，server.mjs / atb.mjs 各调用点未传 v.version，提示词内「版本号」与计划 x.y.z（REQ-20260922-006 同源口径）不一致；存量计划（无 version 字段）不受影响。本单由 BUG-20260928-006 排查中发现登记，引入来源待修复时归因。

## 复现步骤

1.

## 期望行为
