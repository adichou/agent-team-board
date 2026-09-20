# 设计 — BUG-20260910-015 全局任务中的副标题精简，同时将搜索框和副标题放在同一行

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260910-004（经 `atb list` 核验存在：`全局模块入口放在右上角管理项目右边`）
- 归因依据：全局任务由 REQ-20260910-003 创建，但在该需求的模块视图阶段副标题尚未形成当前形态；
  BUG-20260910-004 将全局自主视图改为顶栏入口 + 右侧面板时，在 `#globalPanel` 落成了当前头部结构——
  `index.html` 165–178 行注释明确标注 BUG-20260910-004，长副标题「跨项目：全部注册项目的批量任务，
  不随顶栏项目选择变化」位于 `.global-panel-title`，搜索框独占 `.global-panel-tools` 工具行
  （`style.css` 2025–2030 行：独立 `padding: 10px 16px` + `border-bottom`，与头部 `border-bottom` 叠成两条分隔）。
  该代码尚在工作区未提交（`git log -S` 无命中、`git status` 显示 `scripts/web/index.html` 为修改态），
  与 BUG-20260910-004 条目状态（in-progress 待人工确认）一致。

## 根因分析

- 副标题为完整说明句（「跨项目：全部注册项目的批量任务，不随顶栏项目选择变化」，26 字），在
  `min(560px, 92vw)` 面板内占据近整行宽度，信息密度低。
- 搜索框放在独立的 `.global-panel-tools` 块中独占一行，该块自带 `padding: 10px 16px` 与
  `border-bottom`，与头部（`padding: 14px 16px` + `border-bottom`）叠出两层纵向留白与两条分隔线，
  挤占 `#globalPanelBody` 列表的可见空间。
- 根因归类：BUG-20260910-004 实施时把「说明」与「工具」按块状分区堆叠（各占一行），未做同排紧凑布局；
  属布局实施缺口，不涉及数据 / 交互逻辑缺陷。

## 方案

**开源选型（REQ-20260909-015）**：自研，未引入开源库。理由：本单为纯 CSS 布局调整（一处 HTML 结构微移 +
既有类名的样式重定义），原生 flexbox 足以覆盖（同排 + 窄屏折行 + 伸缩），无合适的第三方库承担该职责，
引入成本高于自研；未使用开源库，不创建 licenses.md。

### 1. HTML（`scripts/web/index.html` #globalPanel）

- 首行不变：`.global-panel-head` 内 `.global-panel-title > h2「全局任务」` + 右上 `#globalPanelClose`。
- 副标题自 `.global-panel-title` 移入 `.global-panel-tools`，与搜索框同块同排；
  文案精简为「跨项目批量任务」（保留跨项目 + 批量任务两层含义），原「不随顶栏项目选择变化」语义
  以 `title` 辅助说明保留在该 `<p>` 上（悬停可见，不占版面）。
- 搜索输入 `#globalSearchInput` 的 id / placeholder / aria-label / type=search / enterkeyhint / autocomplete
  全部保持不变（app.js 按 id 引用、既有契约测试断言不受影响）。

### 2. CSS（`scripts/web/style.css` .global-panel-* 规则）

- `.global-panel-head`：去掉 `border-bottom`（分隔统一由工具行承担），`padding` 改 `14px 16px 6px`
  （次行与之视觉同组）；首行只剩标题 + 关闭按钮，`align-items` 收敛为 `center`。
- `.global-panel-tools`：由块状工具行改为同排工具行——`display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap; padding: 0 16px 12px; border-bottom: 1px solid var(--border)`。
  两条分隔线合并为一条、两层纵向留白合并为一层节奏（消重复留白及分隔）。
- `.global-panel-scope`：`margin: 0; flex: none`（不再需要标题下间距）。
- `.global-panel-tools .search-input`：由 `width: 100%` 改 `flex: 1 1 170px; min-width: 150px;
  max-width: 280px; margin-left: auto`——默认 560px 面板内与副标题同排且靠右；窄屏空间不足时
  依赖 `min-width` + `flex-wrap` 在行内自然折为两行，无横向溢出。
- ≤640px 媒体查询同步改为密排（head `12px 12px 4px`、tools `0 12px 10px`），折行能力由基础规则承担；
  head 保留 `flex-wrap: wrap` 防御极窄窗口标题与关闭按钮挤压。

### 3. 不改动（边界）

- app.js 零改动：开合 / 焦点 / Esc 链 / 防抖搜索 / 快照恢复均按 id 查找节点，布局调整不影响行为；
  搜索仍为常驻节点，轮询刷新只重渲染 `#globalPanelBody`，输入值与焦点不丢失。
- 列表聚合、筛选 chips、跳转、深链收敛、可访问名称均不变；不新增业务操作。

## 风险与边界

- **视觉回归**：`.global-panel-tools .search-input` 由全宽改伸缩宽度，输入区域变窄（≤280px）；
  占位符文案约 170px 可完整容纳，属预期紧凑化。若后续文案加长，可在验收时调 max-width（单变量）。
- **极窄窗口**：断点不新增媒体查询，折行由 flex-wrap + min-width 自然触发（README「具体断点待开发验证」
  以行为保证代替固定断点）；关闭按钮经 head 的 flex-wrap 仍可达。
- **既有测试兼容**：`global-entry-panel-20260910-004.test.mjs` B3/B11 断言 `跨项目`、`.global-panel-head`、
  `.global-panel-tools` 存在——类名与跨项目文案均保留，不破坏契约；`search-module-20260910-009.test.mjs`
  断言搜索输入 aria-label 不变。全量回归相关 web 测试。
