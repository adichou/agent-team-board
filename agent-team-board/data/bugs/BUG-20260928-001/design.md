# 设计 — BUG-20260928-001 版本计划的已合并标签应在文档与翻译合并后再显示。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**BUG-20260926-002**（编号经 `atb list` 核验存在，done「文档编写中的整体审查阶段已经不需要，请在流程各种去除。」）
  - 归因依据：五步流程重定义（选择条目与提交 → 挑选合并 → 文档与翻译 → 文档合并 → 发布）由提交 `7c36018`（主题「fix: 人工确认补交 REQ-20260926-002」，主题与代码注释中的 REQ- 编号系笔误，看板仅存在 BUG-20260926-002）引入——`git log -S docsMerge --reverse` 首个引入 `v.docsMerge` 落账、`/api/build/release/push`「发布文档尚未合并入 main」门禁与独立「文档合并」第四步的提交。
  - 该次重排把「文档与翻译提交合入 main」从合并动作后移到独立第四步，`finishMerge` 仍只覆盖条目提交即置 `merged`，但 `STATUS_LABEL.merged = '已合并'`（更早来自 REQ-20260913-001 构建模块）的显示口径未随之后移，产生「标签已合并 / 门禁拦推送」的矛盾。

## 根因分析

- 状态机与显示口径脱节：`finishMerge`（`scripts/lib/build-store.mjs`）在条目提交全部 cherry-pick 并入 main 后即置 `status = merged`；五步重排后该时刻只代表第 2 步「挑选合并」完成，而 `scripts/web/build.js` 的 `STATUS_LABEL.merged = '已合并'`（绿色 `st-ok`）沿用「merged = 全部合入」的旧含义。
- 三处渲染位直读 `statusChip(v.status)`：左侧版本卡片（`versionChip` 回退）、右侧详情标题（概况名称行）、删除确认弹窗，均未参考 `v.docsMerge` 是否落账。
- 卡片 meta「阶段」同步放大误导：`merged` 即显示「正式发布」，而此时文档未合并、远端未推送，与 `/api/build/release/push` 门禁（docsMerge 未落账即拦）自相矛盾。

## 方案

只收敛显示口径，不改状态机（`finishMerge` 判定）与任何发布门禁：

1. `scripts/web/build.js` 新增纯函数（测试与三处渲染共用）：
   - `docsMergedOf(v)`：`!!(v.docsMerge && v.docsMerge.commitHash)`——与落账证据（重放提交 / main 头）一致；
   - `statusChipFor(v)`：`status = merged` 且 docsMerge 无落账 → 中间态标签 `代码已并入 · 文档与翻译未合并`（`st-wait`，非绿）；其余回退 `statusChip(v.status)` 原四态；
   - `stageOf(v)`：卡片 meta「阶段」同口径——merged 无落账显示同一中间态文案，落账后维持「正式发布」；draft / merging / failed 文案不变。
2. 三处渲染位（卡片 `versionChip` 回退分支、详情概况名称行、删除确认弹窗）从 `statusChip(v.status)` 换为 `statusChipFor(v)`；`versionChip` 的 `release.published` →「已发布」最优先级不变（已发布旧数据无 docsMerge 也不误显中间态）。
3. `scripts/web/i18n.js`：新增中文键 `代码已并入 · 文档与翻译未合并` 的英文翻译（静态精确键），中英同步。
4. 测试：新增 `scripts/tests/bug-20260928-001.test.mjs`（A 标签口径 / B 三处收敛与阶段一致 / C i18n 同步）；既有 `bug-build-ver-published-chip-20260917-001.test.mjs` 夹具（docsMerge 未落账）断言同步为中间态口径。

**开源选型（REQ-20260909-015）**：本改动为纯前端显示口径收敛（一个纯函数 + 三处调用点替换），无成熟开源库可替代本仓库自有 UI 渲染逻辑，自研理由：无合适库（不涉及可复用的第三方能力）；未引入开源库，不创建 licenses.md。

## 风险与边界

- 存量数据兼容：`docsMerge` 缺省 / 空对象 / `commitHash` 为 null 均按「未落账」处理（中间态）；已推送、已发布版本经 `release.published` 优先级维持「已发布」，不受影响。
- 中间态文案含「合并」字样但整词与既有五态标签（计划中 / 合并中 / 已合并 / 失败 / 已发布）可区分，测试按整词断言防误配。
- 不触碰 `agent-team-board/runtime/status/` 与门禁 / 状态机逻辑；merging 禁删、失败原因与重试入口等行为不变。
- 英文翻译为新键新增，不影响既有词条（无自碰，测试覆盖）。
