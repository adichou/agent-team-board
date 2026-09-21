# 测试报告 — REQ-20260921-011 发布模块的文档预览要支持 Markdown 格式预览（run-20260921-323）

- 日期：2026-09-21　执行：zcode-batch-059-08（批次 batch-20260921-059）
- 新增测试：`scripts/tests/req-20260921-011.test.mjs`（TDD 先红后绿，11 例，输出见同目录
  test-output.log）
  - L1 renderMd 渲染层 4 例（vm 加载仓库 vendor 的真实 marked v12.0.2）：GFM 常用元素
    （h1/h2、无序/有序列表、表格、引用、链接、行内代码、围栏代码块、粗/斜体）；消毒
    （script 块与 on* 内联事件不进输出）；渲染器抛错回退转义源码 pre；marked 未加载回退。
  - L2 renderReviewModal 预览态契约 6 例：富文本容器（.md 排版）+ 编辑态 textarea 源码不变；
    端到端消毒；空文档（空串/纯空白）「（空文档）」占位与读取中「正在读取文档内容…」区分；
    data-i18n-skip 口径（富文本容器豁免 / 占位不豁免可翻译 / 文件名豁免沿用）；
    bindReviewSyncScroll 选择器纳入 .bld-review-preview（三种模式组合）+ 比例算法保留；
    页签 / 编辑·预览切换 / 保存 / 通过审核 / 关闭 / n/N 计数交互回归。
  - L3 i18n 回归 1 例：「（空文档）」「正在读取文档内容…」词条中英齐备、往返不变形。
- 既有测试适配 1 处：`scripts/tests/req-20260921-008.test.mjs` L4-3 补提取新依赖
  `sanitizeHtml` / `renderMd`（其 vm 上下文无 window，自动落入源码回退分支，断言口径不变；
  bug-20260921-004 B2 的 docsFlow 夹具无 key 字段、页签 pair 为空，不经预览分支，无需改动）。
- 全量回归：`npm test` → **304 个测试文件，失败 0**
- 覆盖框架：Node 内建 `node:assert/strict` + `vm` 装载前端脚本与真实 vendored marked 的自研
  runner（与仓库既有测试同构）

## 实现摘要（对应验收标准）

1. `scripts/web/build.js`：新增模块级 `sanitizeHtml` / `renderMd`（与 app.js / req-disc.js /
   oncall.js 三处既有 renderMd 逐字同口径：`sanitizeHtml(window.marked.parse(md))`，异常回退
   `<pre>` 转义源码）；`renderReviewModal` 预览态由源码 `<pre>` 改为富文本容器
   `<div class="bld-review-preview md" data-i18n-skip>`，空文档（trim 后为空）显示「（空文档）」
   占位（不豁免、可随界面语言翻译）；`bindReviewSyncScroll` 选择器由 `pre` 改
   `.bld-review-preview`（滚动主体；回退 pre 与围栏代码块随容器滚动不单独绑定）。
2. `scripts/web/style.css`：`.bld-review-preview` 容器滚动样式（flex:1 / overflow:auto /
   去 .md 外框，深浅色走 CSS 变量），围栏代码块等宽 + pre-wrap，沿用 `.md` 既有排版。
3. 零新增依赖：复用 index.html 已全局加载的 vendored marked v12.0.2（MIT），未引入
   markdown-it，不创建 licenses.md（design.md 已记录选型对比结论）。
4. 语法高亮结论（README「待确认」）：**不启用** highlight.js，先例口径 + 预览用于审查而非
   阅读代码（design.md 已记录）。
5. 编辑态、页签切换、保存、通过审核、审核回退、Esc/关闭、双栏比例同步滚动等既有交互零回归
   （L2-5 / L2-6 + 既有 req-20260921-008 / bug-20260921-004 / req-20260921-010 全量回归覆盖）。

## 交付文件

- `scripts/web/build.js`（renderMd / sanitizeHtml / renderReviewModal 预览分支 / 同步滚动选择器）
- `scripts/web/style.css`（审查对话框预览容器样式）
- `scripts/tests/req-20260921-011.test.mjs`（新增）
- `scripts/tests/req-20260921-008.test.mjs`（L4-3 补提取新依赖）
- 条目目录 `design.md`（方案与选型结论）、`test-cases.md`（用例与结果）
