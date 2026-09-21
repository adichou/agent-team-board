# 设计 — BUG-20260921-012 语言集移到文档编写三阶段的右侧对齐

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260921-010（`atb list` 已核验存在：文档编写界面提供一个输入框，允许输入国际化语言集，in-progress）
- 该需求引入 `langsField`（`.bld-docs-langset`）并拼接在副标题条 `.bld-docs-sub` 之后作为独立一行输出，落位未与标题同行。

## 根因分析

`scripts/web/build.js` 的 `renderDocsPane` 中：

- 副标题条 `subBar = '<div class="bld-docs-sub">…</div>' + langsField`——语言集控件（`.bld-docs-langset`）
  整体拼接在 `.bld-docs-sub` **之后**，作为兄弟节点独占一行输出；
- `scripts/web/style.css` 的 `.bld-docs-langset { padding: 8px 12px 2px; … }` 按独立行样式定义
  （上下留白 + 左右 12px 内边距），而 `.bld-docs-sub` 是「左 `.bld-docs-subtitle` + 右 `.bld-docs-actions`」
  的横向 flex，语言集与标题不在同一容器内，结构上就无法同行右对齐。

## 方案

**开源选型（REQ-20260909-015）**：本修复为既有页面的 HTML 结构重排与 CSS 布局调整，不涉及新能力，
无合适开源库可复用（纯仓库内既有样式体系的布局修正，自研理由：无库可引）。

落位定稿（结构对齐条目 ui-demo.html「期望修复」示意）：

1. **HTML（build.js `renderDocsPane`）**：`.bld-docs-sub` 内新增标题行容器
   `.bld-docs-titlebar`：左侧 `<strong>文档编写 · 三阶段</strong>`，右侧放整个
   `langsField`（语言集 label + input + 保存中 chip + 行内错误 + 辅助说明），说明文字与六按钮行
   依次排在标题行下方；`langsField` 不再拼在 `.bld-docs-sub` 之后。
   - 输入框 id / `data-pf-langs` / title / 禁用口径（`langsBusy`、`phase !== 'ready'`）全部原样保留，
     事件绑定与草稿保持逻辑不动（选择器未变）。
2. **CSS（style.css）**：
   - `.bld-docs-sub` 改纵向布局（`flex-direction: column` + `gap`），承载 标题行 → 说明 → 六按钮行；
   - 新增 `.bld-docs-titlebar { display:flex; align-items:center; justify-content:space-between;
     flex-wrap:wrap; }`（标题左、语言集右，同行对齐；窄屏自动换行不溢出）；
   - `.bld-docs-langset` 去掉独立行的 `padding: 8px 12px 2px`，改右侧内联簇
     （`justify-content:flex-end; flex-wrap:wrap`）；辅助说明加 `.bld-docs-langset-hint`
     （`flex-basis:100%; text-align:right`，换行到输入框下方右对齐）；
   - 行内错误 `.bld-docs-langset-err` 同口径右对齐（随语言集簇内换行），去掉旧独立行 padding。
3. **文案**：全部词条原样保留（语言集 / 辅助说明 / 保存中… / 校验错误），i18n 词典无需增删，
   中英文同步基线（BUG-20260912-001）不受影响。

## 风险与边界

- 纯布局重排：不动数据层、服务端与事件绑定（`data-pf-langs` 选择器不变），交互回归由
  `bug-20260921-012.test.mjs` 断言（busy 禁用、失败态禁用、行内错误、title、hint）。
- `.bld-docs-subtitle` 语义保留（标题行 + 说明文字），仅 `strong` 的字号样式迁至
  `.bld-docs-titlebar strong`。
- 窄屏 ≤640px：titlebar `flex-wrap:wrap`，语言集簇换行到标题下方仍右对齐，输入框定宽 190px
  不产生横向溢出（沿用既有响应式口径）。
- 既有测试（req-20260921-010 L4 / req-20260921-008 / req-20260921-012）断言的元素与文案均不变，
  仅新增结构断言。
