# 设计 — BUG-20260911-009 禁用态按钮无视觉反馈，点击看似无响应（如批量开发「启动新一轮」）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：**REQ-20260909-011**（已核验存在：`atb show REQ-20260909-011`，状态 done）

REQ-20260909-011 将终态「启动新一轮」去 Agent 化时确立了「无候选时禁用并说明原因（不靠接口报错兜底）」的设计：按钮渲染为 `disabled`，原因放在 `title`（`scripts/web/app.js` `renderZcodeBatchPanel` 中 `nextDisabled`/`nextTitle`，代码内注释明确标注 REQ-20260909-011）。但配套的 `scripts/web/style.css` 未同步补通用 `.btn:disabled` 禁用态视觉——文件中仅有 `.sel-group .btn:disabled`（行 429）、`.card-accept-btn:disabled`（行 510）、`.shot-x:disabled`（行 932）、`.refine-badge:disabled`（行 1906）等个别上下文规则，通用 `.btn` 无禁用样式。于是该设计落地后，任务面板里被禁用的主操作按钮外观与可点击时完全一致，点击被浏览器静默吞掉，形成「点了没反应」的体验。

登记时已同步定位（2026-09-11 会话排查），修复阶段直接沿用本归因即可。

## 根因分析

（登记时已定位）`scripts/web/style.css` 缺通用 `.btn:disabled` 规则：禁用属性只挡住了 JS 事件（浏览器对 disabled button 不派发 click），视觉层无任何变化。`app.js` 多处按「禁用 + title 说明」口径渲染按钮（`#batchNext` `#devStart` `#refineNext` 等），落入了这个无样式缺口。触发场景为批量开发面板批次结束且无 planned 候选——按钮照常渲染但被禁用，用户点击无反馈。

## 方案

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界
