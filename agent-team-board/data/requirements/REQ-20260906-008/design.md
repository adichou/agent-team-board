# 设计 — REQ-20260906-008 需求和文件切换栏移到智能体团队看板右侧，使用切换样式

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

桌面端顶栏为 `space-between` 三段布局：`.brand`（左）、`nav.view-tabs`（中，「需求 / 文件」）、
`.top-actions`（右，项目选择器 + 新建按钮）。切换栏悬在中间位置别扭，与右侧操作控件割裂；
样式自 REQ-20260906-001 起已是靛蓝分段切换控件（淡靛蓝底槽 + 胶囊 + 激活态填充白字）。
窄屏（≤1020px）按 REQ-20260903-002 v6 固定为左缘竖排工具栏（`.topbar` 加 `transform` 成为
fixed 包含块，`.view-tabs` 用 `top:100%` 钉在顶栏正下方，`--viewrail-h` 给看板列 tab 条让位）。

## 方案

**DOM（index.html）**：把 `<nav class="view-tabs">` 从 `.brand` 之后移动到 `.top-actions` 内部
首位（`#projectSel` 之前）。顶栏变为两段：左品牌、右「视图切换 + 项目选择 + 新建」组合。

**CSS（style.css）**：

- 布局复用现有规则：`.top-actions` 已是 `flex / flex: none`，嵌套进去的 `.view-tabs` 保持
  `flex: none`（topbar-overflow 契约）不被压缩，无需新增布局规则。
- 「切换样式」：保留 REQ-20260906-001 的分段控件造型，为 `.view-tab` 增加
  `transition: background-color/color .18s ease` 平滑过渡，激活态切换有视觉反馈。
- 窄屏规则（≤1020 / ≤640 的 @media 覆盖块）**零改动**：`.view-tabs` 移入 `.top-actions` 后仍是
  `.topbar` 的后代，`position: fixed` 的包含块（transform 祖先）不变，左缘竖排与
  `--viewrail-h` 让位机制照旧生效。

**JS（app.js）**：零改动。`setView` / 点击绑定 / active 同步均按类名 `.view-tab` 工作，与 DOM
位置无关。

**测试（TDD）**：新增静态契约测试 `scripts/tests/view-tabs-right.test.mjs`（参照
view-tabs-style.test.mjs 的零依赖风格）：

- T1 结构契约：`.view-tabs` 位于 `.top-actions` 内、`#projectSel` 之前（原中部位置移除）。
- T2 布局契约：`.topbar` 仍 `space-between`；`.view-tabs` 基础规则仍 `flex: none`。
- T3 切换样式契约：底槽 `--viewrail-accent-soft`、胶囊 99px、激活态靛蓝白字、tab 有 transition。
- T4 窄屏回归：≤1020 仍 `position: fixed` + `flex-direction: column`；app.js 保留 `--viewrail-h`。
- T5 交互契约：app.js 仍按 `querySelectorAll('.view-tab')` 绑定与同步 active。

## 风险与边界

- 嵌套进 `.top-actions` 后，≤640 极窄端顶栏 `flex-wrap: wrap` 时切换栏作为组内第一项随组换行，
  fixed 化后不占流内空间，无叠加风险。
- 不触碰状态机与 `status.json`；纯前端静态资源改动，服务端无感知。
