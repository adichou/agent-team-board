# 设计 — BUG-20260925-005 二次编辑界面的编辑和预览功能要和审查界面保持一致。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260924-006（经 `atb list` 核验存在，状态 in-progress）。二次编辑弹窗为该单
  新增（默认语言单语言编辑），实现时预览只接了 `renderMd` 基础渲染、编辑器样式与定位落点
  反馈未对齐审查对话框既有口径。富媒体增强层本身由 BUG-20260923-002 先于该单引入且只接入
  了当时的宿主（审查对话框等四处），新宿主未接入属该单实现缺口，故归因 REQ-20260924-006。

## 根因分析

四项差异均为 REQ-20260924-006 新增二次编辑弹窗时未对齐审查对话框既有能力，而非增强层缺陷：

1. **预览缺富媒体增强**：`build.js` 绑定段（`bindCommon`）只对审查对话框 `#bldReviewWrap` 内的
   `.bld-review-preview.md` 调用 `window.ATBMdRich?.enhance(el, { imgBase: … /api/fs/raw … })`；
   `#bldEditWrap` 绑定段无任何 enhance 调用——预览容器虽复用 `.bld-review-preview.md` 类名，
   但相对路径图片不改写（按页面地址解析 → 裂图）、mermaid / plantuml 只剩普通代码块。
2. **编辑器非等宽**：`style.css` 中审查编辑框 `.bld-review-col-body textarea` 为
   `12.5px/1.65 ui-monospace, Menlo, Consolas, monospace`；弹窗编辑框 `.bld-edit-body .bld-edit-editor`
   为 `font: inherit`（界面默认非等宽字体）。
3. **定位缺落点闪烁**：`focusReviewIssue`（审查）在选区 + 聚焦 + 滚动后加
   `bld-review-focus-flash` 类 2 秒移除；`focusEditIssue`（弹窗）注释自称「口径同 focusReviewIssue」
   实际缺这两行（样式类与 keyframes 已存在，可直接复用）。
4. **预览排版走 `.md` 通用样式**：审查预览容器有专门规则（无边框 / 13px / 1.7 / 围栏代码等宽
   pre-wrap）；弹窗预览位于 `.bld-edit-body` 内不命中该选择器，落到 `.md` 通用样式（带外框
   边框 + 圆角 + 13.5px），同一文档两界面观感不同。

## 方案

不新建增强层、不改 `md-rich.js`（共享层四宿主先例已稳定）：把二次编辑弹窗按审查对话框既有
口径接入即可，全部为前端接线与样式对齐。

1. **预览富媒体增强（build.js `bindCommon`）**：在 `#bldEditWrap` 绑定段（遮罩点击绑定后）对
   `editWrap.querySelectorAll('.bld-review-preview.md')` 逐容器调用
   `window.ATBMdRich?.enhance(el, { imgBase: state.project ? (raw) => \`/api/fs/raw?path=…&project=当前项目\` : null })`
   ——与审查对话框逐字同口径：相对路径图片改写白名单端点、失败就地占位（md-rich 内置）、
   mermaid 渲染（深浅色自适应、失败回退源码）、plantuml 降级提示 + 源码；可选链调用保证库 /
   模块缺失静默降级不白屏。render 每次重建后 `bindCommon` 重跑，切换文件 / 编辑·预览切换 /
   重试后均会重新增强（enhance 幂等标记防重复）。
2. **编辑器等宽（style.css）**：`.bld-edit-body .bld-edit-editor` 由 `font: inherit; line-height: 1.7`
   改为 `font: 12.5px/1.65 ui-monospace, Menlo, Consolas, monospace`（与审查编辑框同口径）。
3. **定位落点闪烁（build.js `focusEditIssue`）**：补齐与 `focusReviewIssue` 相同的两行——定位后
   `classList.add('bld-review-focus-flash')` + 2 秒后移除（行号缺失 / 空内容的既有兜底不触发
   闪烁，维持「仅打开编辑态」）；`style.css` 闪烁选择器扩展覆盖 `.bld-edit-editor`
   （动画 keyframes `bldReviewFocusFlash` 复用）。
4. **预览排版口径（style.css）**：新增 `.bld-edit-body .bld-review-preview` 规则——去 `.md` 外框
   （无边框 / 圆角 / 底色、`margin: 0; padding: 0`，滚动主体仍为 `.bld-edit-body`）、
   `font-size: 13px; line-height: 1.7`，围栏代码等宽收敛换行（`pre`：`white-space: pre-wrap;
   overflow-wrap: anywhere; 12px/1.6 ui-monospace…`），与审查预览容器逐项对齐。

**职责边界不变**：弹窗仍为默认语言单语言——不加其他语种对照列、不加「通过审核」；文件切换 /
刷新 / 未保存挂起三动作、保存反馈、读取失败重试不丢输入等既有行为零改动（无相关代码路径变更）。
**无新增界面文案**（增强提示文案由 md-rich 既有 i18n 词条覆盖），i18n.js 不改。

**开源选型（REQ-20260909-015）**：本单为既有前端接线与样式对齐，不引入新依赖、不自研新库；
mermaid（11.17.2，MIT）沿用 BUG-20260923-002 既有 vendor 与 licenses.md，本单不新增条目文件。

## 风险与边界

- **enhance 时机**：绑定在每次 render 后执行，预览容器随 render 重建，不存在「增强后又被冲掉」；
  两弹窗（审查 / 二次编辑）子树不相交，enhance 幂等标记下互不影响。
- **未保存挂起等既有交互**：改动不触碰 `requestEdit*` / `resolveEditPending` / `saveEditFile`
  路径，回归由既有 req-20260924-006 / bug-20260925-001~004 测试兜底。
- **闪烁动画复用**：`bld-review-focus-flash` 类名与 keyframes 为共享资源，扩展选择器不改既有
  审查行为（BUG-20260924-004 既有测试兜底）。
- **范围边界**：BUG-20260925-006（审查界面移除编辑功能）为另单范围，本单不实施；本单完成后
  编辑 / 预览能力在二次编辑弹窗内完整承接，是该收敛的前置。
