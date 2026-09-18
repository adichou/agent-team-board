# 设计 — BUG-20260911-002 发布模块的副标题有问题，不仅仅是 Git 和 App Store，要更通用

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260910-029（新增发布模块时将模块副标题定为「Git 远端与 App Store 发布流水线：预检 → 计划确认 → 执行 → 核验」，以当时仅有的两类发布目标定义模块概述）。
  核验过程：`atb list/show` 确认 REQ-20260910-029 真实存在（状态 in-progress 待人工确认），其标题即「新增发布模块：Git 远端与 Apple App Store 发布流水线」，design.md 改动面明确列有「模块副标题」（app.js）；`scripts/web/app.js` 该行行内注释亦标注 `// REQ-20260910-029`。仓库 git 历史仅一次初始化提交（`git log -S` 无更早轨迹），无法定位具体提交，以条目文档与行内注释交叉核验归因。
  后续 REQ-20260910-030 新增桌面应用（Electron）发布目标时未同步更新该副标题，使文案与目标列表不一致（本次修复对象）。

## 根因分析

副标题是一处「模块概述」文案，却在 REQ-20260910-029 实施时以枚举当时仅有的两个具体目标（Git 远端、App Store）的方式写成。模块能力后续按目标粒度扩展（REQ-20260910-030 加入桌面应用），目标列表与空态说明随 `scripts/web/release.js` 的 TARGETS 表更新，但 `scripts/web/app.js` 的 `MODULE_SUB.release` 是独立维护的另一处文案，没有随目标扩展联动，形成「概述只覆盖部分能力」的漂移。根因是概述文案与能力清单耦合：枚举具体渠道的概述必然随渠道扩展过时。

## 方案

将 `scripts/web/app.js` 中 `MODULE_SUB.release` 由「Git 远端与 App Store 发布流水线：预检 → 计划确认 → 执行 → 核验」改为目标无关的统一口径「**构建与发布流程：预检 → 计划确认 → 执行 → 核验**」（README 期望行为约定的文案）。副标题只描述模块流程（预检 → 计划确认 → 执行 → 核验），不枚举渠道、不宣称所有渠道均已可执行；具体目标能力继续由模块工具栏的目标选择器与 `release.js` 的 TARGETS 表达。行内注释补标 BUG-20260911-002 溯源。

不改预检、启动、确认、执行、核验任何实际行为；不新增发布渠道；不动 `release.js`。

**开源选型（REQ-20260909-015）**：本项为单行展示文案修正，无任何库可替代，属纯自研文案变更（无合适库的原因：不涉及任何可复用逻辑），不引入依赖，不创建 licenses.md。

**测试（TDD）**：新增静态契约回归测试 `scripts/tests/release-sub-generic-20260911-002.test.mjs`，先跑红（C1 副标题文案 / C2 旧文案清零两项失败）再实现跑绿。用例：
- C1 `MODULE_SUB.release` 精确等于新通用文案，且行内标注 BUG-20260911-002；release 键文案不出现 Git / App Store / Electron 等渠道枚举。
- C2 网页源码（app.js / release.js / index.html）不再出现旧文案「Git 远端与 App Store 发布流水线」。
- C3 其他模块副标题不回退（status / oncall / runs / files / marketing 文案保留，settings 空串占位）。
- C4 文案变更不影响目标能力：release.js 目标列表仍含 git / apple / electron 三项与「桌面应用（Electron）」入口。
- C5 条目目录 `ui-demo.html` 离线自包含（无外网资源引用）且包含修复后文案。

## 风险与边界

- 纯文案变更，风险极低；副标题仍走 `updatePageHead()` 的 `#moduleSub` 辅助文字层级，位置、样式与窄窗口换行行为不变。
- 既有契约测试 `release-ui.test.mjs` U2 仅断言 `MODULE_SUB` 含 `release:` 键，不锁具体文案，无冲突（全量 185 个测试文件回归通过）。
- 代码注释中「REQ-20260910-029：新增发布模块（Git 远端 / Apple App Store 发布流水线…）」为历史变更记录（描述该需求当时交付内容），不是展示文案，按惯例保留不改。

## 实施记录（2026-09-11，批次 batch-20260911-034 / run-20260911-188）

1. `scripts/tests/release-sub-generic-20260911-002.test.mjs` 新增（C1–C5），跑红：C1/C2 失败，C3–C5 不变量通过。
2. `scripts/web/app.js` `MODULE_SUB.release` 改为通用文案并补行内溯源注释，跑绿（5/5 通过）。
3. 全量回归：`npm test`（`node scripts/tests/run-all.mjs`）185 个测试文件全部通过，失败 0。
