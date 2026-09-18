# 设计 — BUG-20260914-020 已合并的版本计划不允许再使用 AI 完善按钮了。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：BUG-20260913-004（经 `atb list` 核验存在，状态 done；commit 26fc9de 将「提示词与回答回填」更名「AI 完善」并从右侧详情底部迁入左侧版本卡片时，禁用口径只按既有 merging 继承，未覆盖 merged）
- 根源可追溯 REQ-20260913-001 构建模块首版（commit ff5ed18，经 BLD-20260914-001 合并入 main）。

## 根因分析

- **渲染层**：`scripts/web/build.js` `renderVersionList()`（约 913 行）的 answerBtn 禁用条件仅 `v.status === 'merging'`；同卡 mergeBtn 已对 merging / merged / mergeBusy 禁用，AI 完善漏掉了 merged。
- **入口层**：`openAnswerModal(verId)`（约 514–520 行）只查版本存在性（带参回落 `findVersion`、无参回落 `selVersion`），不做任何状态校验，merged 版本仍可弹窗并完整走通「复制 → 粘贴 → 解析 → 应用」。
- **写入层（不在本单范围）**：数据层 `buildStore.saveInfo` 后置校验 `assertEditableStatus` 同样只拦 merging，merged 可改写名称 / 描述——但 README 范围边界明确「默认不动手动行内编辑口径、不收窄 `POST /api/build/version/save` 对 merged 的写入」，本单只锁 AI 完善入口，不碰写入链路。

## 方案

**开源选型（REQ-20260909-015）**：无合适库——本修复为项目内前端按钮禁用口径与一处防御性状态校验（约 10 行改动），不涉及可复用的第三方能力，引入开源库成本高于自研；不引入任何依赖，不创建 licenses.md。

实现（全部在 `scripts/web/build.js`，数据层零改动）：

1. **渲染禁用**：`renderVersionList()` 的 answerBtn 禁用条件改为 `merging || merged`；title 按状态区分——merged 用「已合并入 main，不允许再 AI 完善」（措辞参照同行合并键「已合并入 main」口径），merging 维持「合并中，请稍候……」；draft / failed 维持可用与既有 title。
2. **防御路径**：`openAnswerModal(verId)` 在定位到版本后增加状态守卫：`merging / merged` 一律直接 return 不弹窗（卡片按钮禁用后天然不可触发，此处兜底无参回落与测试直调路径；merging 与按钮禁用口径同步收口，UI 无既有路径受影响）。
3. **i18n**：`scripts/web/i18n.js` EN 词典新增「已合并入 main，不允许再 AI 完善」词条（title 属性走全文精确翻译）。
4. **测试**：`scripts/tests/bug-build-ver-card-acts-20260913-004.test.mjs` B2 补 merged 的 AI 完善禁用断言（disabled + title 口径）；新增用例覆盖防御路径（直调 / 无参回落均不弹窗、draft 仍可打开）与 i18n 词条。

## 风险与边界

- merged 版本名称 / 描述的**手动行内编辑**与 `POST /api/build/version/save` 写入口径按 README 边界保持不变（如需一并锁定另行确认）。
- merged 删除键维持可用（仅移除看板记录）；merging 的 AI 完善 / 合并 / 删除禁用口径与 title 零变化。
- 状态竞态（弹窗打开期间版本转 merging / merged）维持现状不处理，写入层 merging 拦截仍在。
