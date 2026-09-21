# 设计 — REQ-20260921-011 发布模块的文档预览要支持 Markdown 格式预览

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

审查对话框（`scripts/web/build.js` `renderReviewModal`）每栏「预览」态目前把 Markdown 源文本
直接放进等宽 `<pre class="bld-review-preview">`，审查者看到的是标记符号而非排版效果。

## 方案

（技术选型、接口设计、影响面）

**开源选型（REQ-20260909-015）**：按 README 调研结论执行——**复用仓库已 vendor 的 marked
v12.0.2（MIT，`scripts/web/marked.min.js`，`index.html` 已全局加载）+ 既有 `sanitizeHtml` 消毒
口径，零新增依赖、零新增 vendor**。理由：app.js / req-disc.js / oncall.js 三处模块已有同一
`renderMd()`（`sanitizeHtml(window.marked.parse(md))`，异常回退 `<pre>` 源码）先例，本场景渲染
的是本仓库、经人工审查的文档，第四处沿用同一口径一致性最好；markdown-it 备选不再引入
（README 对比结论成立，无成本收益）。未引入新库，不创建 licenses.md。

**接口设计**（全部前端 `scripts/web/build.js`，模块内新增两个模块级函数）：

- `sanitizeHtml(html)` / `renderMd(md)`：与 app.js 等三处逐字同口径——`window.marked.parse` 输出
  经 `sanitizeHtml`（剥 `<script>` 块与 `on*` 内联事件）后返回；渲染器抛错（含 marked 未加载的
  ReferenceError/TypeError）catch 回退 `<pre>` 转义源码，不白屏。
- `renderReviewModal` 预览态分支：
  - 空文档（`!content.trim()`）→ `<div class="bld-review-preview muted small">（空文档）</div>`
    占位，不渲染空白富文本区；占位元素**不带** `data-i18n-skip`，可随界面语言翻译
    （词条已在 i18n.js）。
  - 非空 → `<div class="bld-review-preview md" data-i18n-skip>renderMd(content)</div>` 富文本
    容器：`.md` 提供标题/列表/表格/引用/行内与围栏代码的既有排版（深浅色走 CSS 变量）；
    容器声明 `data-i18n-skip`——**文档内容是各自语言的本体（README.md 中文 / README_en.md
    英文），不进界面词典翻译**（BUG-20260921-004 文件名豁免同口径）；预览所见即将被提交的原文，
    界面词典不得改写审核对象。
  - 编辑态 textarea、读取中、读取失败、页签/保存/通过审核/Esc 关闭等全部不变。
- `bindReviewSyncScroll` 绑定选择器由 `textarea, pre` 改为 `textarea, .bld-review-preview`
  （富文本容器是滚动主体，纳入比例同步；渲染异常回退的 `<pre>` 在容器内部随容器滚动，
  围栏代码块等内层元素不误绑）。
- `style.css` 审查对话框块：`.bld-review-preview` 容器滚动样式（flex:1 / overflow:auto /
  去外框），继承 `.md` 排版；围栏代码块等宽 + pre-wrap。

**语法高亮结论（README「待确认」）**：**不启用** highlight.js——先例口径（三处 `renderMd` 渲染态
均未对 code 元素做高亮），预览用于审查内容而非阅读代码教程，样式化代码块（底色 + 等宽）已满足；
如后续需要另行立项。

**影响面**：

- `scripts/web/build.js`：新增 `sanitizeHtml` / `renderMd`；`renderReviewModal` 预览分支； 
  `bindReviewSyncScroll` 选择器。无服务端 / 接口 / 数据结构改动。
- `scripts/web/style.css`：审查对话框块新增容器与代码块样式。
- 既有测试适配：`req-20260921-008.test.mjs`（L4-3）与 `bug-20260921-004.test.mjs`（B2）经
  函数提取跑 `renderReviewModal`，补提取 `sanitizeHtml` / `renderMd` 两个新依赖（其 vm 上下文
  无 `window`，自动落入回退分支，断言口径不变）。
- 新增 `scripts/tests/req-20260921-011.test.mjs`：L1 renderMd（加载真实 vendored marked：
  GFM 元素 / 消毒 / 抛错与未加载回退）；L2 预览态契约（富文本容器 / 编辑态不变 / 空文档占位 /
  读取中 / data-i18n-skip / 同步滚动绑定）；L3 i18n 词条回归。
- i18n：无新增文案（「（空文档）」「正在读取文档内容…」词条已在 i18n.js）。

## 风险与边界

- **消毒边界**：`sanitizeHtml` 是既有轻量兜底（script 块 + on* 事件），与看板三处渲染同口径；
  预览内容来自本仓库文档（经人工审查），非不可信输入，不升级 DOMPurify（引入新依赖违背
  本单「零新增」结论）。
- **同步滚动**：富文本容器高度与源码 textarea 不同，比例跟随按 `scrollHeight` 归一（既有算法
  不变），「预览-预览」「编辑-预览」「编辑-编辑」组合均由同一绑定覆盖。
- **重渲染**：预览态每次 render 都按 `rv.contents` 最新值（含未保存草稿，`syncReviewDrafts`
  已回同步）重新渲染，切换即反映最新内容。
