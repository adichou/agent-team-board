# 设计 — REQ-20260908-006 详情页面的操作按钮要改成横向布局

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

详情抽屉 `renderDrawer` 的操作区是「两翼 + 中栏」结构：`.drawer-actions`
（`display: flex; gap: 10px`）左右放 prev/next 导航按钮，中间
`.drawer-actions-center`（REQ-20260901-001）用 `flex-direction: column`
把操作按钮、编辑按钮、`1 / N` 序号自上而下堆叠。待接受条目有 3 个操作按钮，
纵向堆出一高条，浪费纵向空间，视觉重心也不稳。

## 方案

**纯 CSS 改动（`scripts/web/style.css`），不动模板结构**：

1. `.drawer-actions-center` 由 `column` 改 `row`：
   - `flex-direction: row; align-items: center; justify-content: center;`
     （保持整体居中，行内垂直居中对齐）；
   - `flex-wrap: wrap`（窄屏放不下时整按钮换行，不挤压变形）；
   - `gap: 4px → 8px`（横向按钮间距对齐外层 10px 量级）。
2. `.drawer-actions-center .btn { flex: none; white-space: nowrap; }`：
   行内按钮不被压缩、文案不折行（换行由容器 wrap 承担）。
3. `.drawer-nav-pos { white-space: nowrap; }`：`1 / N` 序号在行尾不断开。
4. 模板（app.js `renderDrawer`）不动：notice 独立成行在操作行上方
   （REQ-20260901-001 三次修订契约）、两翼导航、序号在中栏末尾的顺序均保持。

影响面：仅详情抽屉操作区视觉布局；`.drawer-actions.batch-actions`
（批量抽屉等复用容器）各自定义对齐方式，不受中栏规则影响。

## 风险与边界

- **窄屏溢出**：多按钮一行放不下 → `flex-wrap: wrap` 整按钮换行兜底，
  不出现文字折行或按钮压缩。
- **既有契约回归**：drawer-nav D1（notice 拆分、中栏不含说明文字）与
  D4（中栏容器存在）仍由 `drawer-nav.test.mjs` 保障，本次不触碰。
- 无 JS 行为变化，无数据面影响。

## 实施记录

- 2026-09-08（zcode-batch-012-01）：按上述方案实施；测试
  `scripts/tests/drawer-actions-row.test.mjs`（CSS 静态契约，模式对齐
  detail-close-btn / drawer-nav 既有测试）。
