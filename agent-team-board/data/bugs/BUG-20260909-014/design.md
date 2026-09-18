# 设计 — BUG-20260909-014 任务模块面板在批量完善和批量开发上方空白较多，而且需要去掉关闭按钮

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：BUG-20260908-009（任务界面去掉任务这个标题；编号已经 `atb list` 核验存在）。
  排查过程：`renderBatchDrawer()` 头部第一行 `.batch-head` 原本承载「任务」大标题
  （h2）+ 右侧操作区；BUG-20260908-009 移除 h2 后（注释见 `scripts/web/app.js`
  renderBatchDrawer 内「BUG-20260908-009：头部不再渲染…」），该行只剩与顶栏
  `#dataDir` 完全重复的 11px 弱化项目路径 `span.path` 与「✕」关闭按钮，形成
  近似空白横带。「✕」按钮与头部模板本身更早来自 REQ-20260907-004（任务模块
  页面化），但「空白横带」这一回归由 BUG-20260908-009 移除标题直接引入。

## 根因分析

1. **空白横带**：`.drawer-head` 通用内边距 `16px 18px 12px` + 仅剩一行 11px 路径文字的
   `.batch-head` + `.batch-modes { margin-top: 10px }` 叠加，页签上方累计约 40px+ 的
   近似空白区；≤640px 窄屏 `.path` 隐藏后该行只剩「✕」，空白更纯粹。
   项目路径与顶栏品牌区 `#dataDir`（`scripts/web/index.html` 第 22 行）完全重复，信息冗余。
2. **「✕」冗余且不一致**：`#batchClose` 点击仅执行 `setView('status')`，与第二行模块
   导航「需求」页签功能完全重复；同为页面化模块的「讨论 / 文件 / 设置」均无关闭按钮，
   任务模块独有，交互不一致。

## 方案

整行移除 `.batch-head`（路径 + 关闭按钮一并去除），头部只剩一级页签并收紧间距：

1. `scripts/web/app.js` `renderBatchDrawer()`：删除头部 `.batch-head` 整个 div
   （含 `.batch-title`/`span.path` 与 `.batch-head-actions`/`#batchClose`）；
   `<header class="drawer-head">` 内直接渲染 `<nav class="tabs batch-modes">`。
   项目路径信息由顶栏 `#dataDir` 持续展示，不丢失。
2. `scripts/web/app.js` `bindBatchDrawer()`：删除 `$('#batchClose')` 事件绑定。
   离开任务模块统一走第二行模块导航（与讨论/文件/设置一致）。
3. `scripts/web/style.css`：
   - 删除 `.batch-head` / `.batch-head .batch-title` / `.batch-head-actions` 三条
     失效规则（原第 1162–1164、1512 行，BUG-20260906-016 的两端布局承载随之消亡）。
   - 新增 `.batch-drawer .drawer-head { padding: 12px 18px 0; }`（作用域限定批量抽屉，
     详情抽屉 `#drawer.drawer` 的 `.drawer-head` 内边距不受影响），对齐 `.page-head`
     的 12px 顶部节奏；`.batch-modes { margin-top: 10px }` 改为 `margin-top: 0`
     （`.tabs` 自带 `margin: 4px 0 10px` 提供页签上下呼吸），页签直接贴近面板顶部。
4. 契约测试同步改写新契约：
   - `scripts/tests/batch-title-removed.test.mjs`：T1/T2/T3 中「✕ / 项目路径保留」
     断言翻转为「不再出现」（`batch-head` / `span.path` / `#batchClose` 均不出现），
     页签与头部容器断言保留；T3 增补 `bindBatchDrawer` 无 `#batchClose` 绑定断言。
   - `scripts/tests/detail-close-btn.test.mjs` T5：`.batch-head` 类承载断言改为
     「批量抽屉头部已无 `.batch-head` 行（BUG-20260909-014 整行移除），app.js 全局
     仍无内联 space-between」。
   - `scripts/tests/settings-simplify-20260909-002.test.mjs` T5 第 147 行
     「关闭按钮保留」断言随本 Bug 新契约翻转为「不再渲染」。
   - `scripts/tests/refine-ui.test.mjs` / `tasks-tabs-20260909-008.test.mjs` 仅匹配
     `<nav class="tabs batch-modes">` 模板，结构保留，无需改动。

## 风险与边界

- `.drawer-head` 通用规则（内边距/下边框）仍被条目详情抽屉 `renderDrawer` 使用，
  本方案不改动通用规则，仅以 `.batch-drawer .drawer-head` 作用域覆盖，详情抽屉
  关闭按钮与布局零影响（回归由 detail-close-btn.test.mjs T1–T4 守护）。
- `#batchClose` 移除后无其他引用（已全局检索 app.js / index.html / style.css）；
  页签切换（`state.batch.mode`）、二级页签记忆、轮询重渲染、深链跳转
  （`gotoRuns('refine'/'develop')`）逻辑不在头部行内，不受影响。
- ≤640px 窄屏：原 `.path { display: none }` 规则保留（顶栏仍在用），批量抽屉内
  已无 `.path` 元素，无副作用；深浅色仅动间距与删除元素，无新增配色。
- 契约翻转涉及三个既有测试文件的历史断言，均在本 Bug 期望行为（去 ✕ + 去空白带）
  范围内，非静默放宽。
