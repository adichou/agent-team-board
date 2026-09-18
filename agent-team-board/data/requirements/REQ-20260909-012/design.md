# 设计 — REQ-20260909-012 讨论详情也要支持多页签布局

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

讨论详情 `#ocDetail` 现为「头部 + 单列纵向堆叠」：meta-grid → 旧绑定需求链接 → 阶段通知条 `#ocNotice` → 提示词浮层 → 内容双页签（背景与纪要 ｜ 生成需求 / Bug）。纪要长、草稿多或带旧版历史问答时正文被一路下推，需要长滚动。任务模块（REQ-20260909-008 `TASK_PANES` / `taskPaneShell`）与需求 / Bug 详情抽屉（REQ-20260909-006 `.drawer-tabs`）均已页签化，本需求把讨论详情对齐为同样布局。

## 方案

（技术选型、接口设计、影响面）

### 结论（README「待确认」逐项定稿）

1. **页签集合与命名**：四页签 `概况 overview / 纪要 minutes / 成果 drafts / 提示词 prompt`，顺序即此。默认激活「概况」，`openItem()` 切换记录与 `closeDetail()` 关闭时重置为默认（沿用现状重置口径，缺省值由 `minutes` 改为 `overview`，与需求抽屉「基本信息」、任务模块「overview」首屏即概况的先例一致）。
2. **阶段通知条**：**常驻页签行之上**（全局阶段反馈）。`#ocNotice` 保持在 `drawer-body` 顶部、页签行 `nav.drawer-tabs` 之前，任何页签下可见；「正在读取纪要……」过渡与读取失败的「重新读取纪要」入口全局可达，`renderDetailNoticeOnly()` 只刷通知条的机制不变。
3. **提示词**：浮层形态取消，**迁入「提示词」独立页签**（分区常驻，未生成/已收起时显示空态说明，不隐藏页签）。头部「启动提示词」= 设 `state.prompt={kind:'start'}` 并跳 `prompt` 页签；「讨论完毕」生成收尾提示词后同样跳 `prompt` 页签（现状为跳 `minutes` + 插浮层，页签化后直接可见收尾提示词，可见效果等价）；新建讨论 `reveal()` 直接跳 `prompt` 页签展示启动提示词。「收起」语义 = 清除提示词展示（`state.prompt=null`）并**切回默认页签「概况」**。复制口径（剪贴板 + execCommand 双回退、失败全选提示手动复制）不变。
4. **旧版历史问答**：保留在「纪要」分区尾部（`legacyRoundsHtml()` 位置不动），**不独立页签**——仅旧单有该区块，独立页签会让新单多空页签或需动态增删页签；无历史问答时该区块本就不渲染。
5. **计数角标与 meta 字段**：「成果」页签带轻量计数 `成果 (N)`，N = 待创建候选草稿数 + 已创建成果数，N=0 不显示括号；概况 meta-grid 五字段（讨论方式 / 讨论范围 / 成果 / 创建 / 更新）维持现状。
6. **键盘操作**：不引入左右方向键漫游，与任务模块、需求抽屉口径一致——原生 `<button type="button">`，Tab 聚焦 + 回车触发，`role="tablist"/"tab"/"tabpanel"` + `aria-selected`（补齐现状讨论页签缺失的可访问性属性）。

### 实现要点（技术选型与影响面）

- 纯前端：仅 `scripts/web/oncall.js`（主）与 `scripts/web/style.css`（新增空态样式）；不新增后端 API、不改状态机、不写任何 status.json。
- DOM 结构对齐需求抽屉先例：`<header class="drawer-head">` → `<nav class="tabs drawer-tabs" role="tablist">`（复用 REQ-20260909-006 下划线式样式，窄屏 `flex-wrap` 换行）→ `<div class="drawer-body">`（常驻 `#ocNotice` + 四个 `<section class="drawer-pane disc-pane" data-pane="…" role="tabpanel">`，非当前分区加 `hidden`）。
- 四个分区**全部渲染进 DOM、按 `hidden` 切换**（同 `taskPaneShell` 口径）：`概况` = meta-grid + `#ocGotoReq` 旧绑定需求链接；`纪要` = `minutesHtml()`；`成果` = `draftsHtml()`（保留 `#ocPane` id 供 `bindDrafts()` 兼容）；`提示词` = 新增 `promptHtml()`（有展示时即原 `disc-prompt` 块迁入，无展示时空态说明）。
- 页签记忆：`state.tab` 扩展为四值，新增 `DISC_TABS` 常量与失效回落默认页签（同 `taskPaneOf` / `drawerTabValid` 先例）；`detailSig` 已含 `state.tab` 与 `state.prompt?.kind`，2 秒轮询重渲染不重置页签；`detailEditing()` 输入保护与失焦 `pendingRefresh` 补绘机制沿用，无需改动。
- 页签切换 = `state.tab` 赋值 + `renderDetail()` 重绘，纯前端不发起请求、不弹确认（沿用现状双页签切换实现，仅扩容集合）。
- 自动定位三入口：`doFinish()` 成功 → `state.tab='prompt'`；`doCreate()` 完成 → `state.tab='drafts'`（不变，展示逐项结果）；`reveal()` → `state.prompt={kind:'start'}` + `state.tab='prompt'`。
- 存量测试影响：`discussion-ui.test.mjs` U5 断言的旧双页签文案「背景与纪要」「生成需求 / Bug」随页签更名为「纪要」「成果」同步更新（功能断言不动）。

## 风险与边界

- 全分区常驻 DOM 后每次重渲染多算 `renderMd`（纪要 + 历史问答 + 背景），但重渲染由签名变化门控，2 秒轮询空转不重绘，开销可控（与任务模块四分区同口径）。
- 提示词从浮层迁入页签后，`doFinish`/`reveal` 的落点由「跳 minutes + 浮层」改为「跳 prompt 页签」，最终可见效果等价（提示词全文直接可见）；用户在「纪要」页签时不再被浮层推下正文，属预期改善。
- 不得误伤 `#ocBack` 复用的 `.drawer-back` 顶层规则（BUG-20260909-007 口径）：本次不动 `.drawer-back` 相关样式，`#ocBack` 结构不变。
- 窄屏（≤1020px）覆盖层形态：页签行依赖 `.drawer-tabs` 自带 `flex-wrap: wrap` 换行，不产生横向滚动；返回 / 遮罩 / Esc 关闭交互不动。

## 实施记录

- 2026-09-09（zcode-batch-024-1，TDD）：
  - `scripts/web/oncall.js`：新增 `DISC_TABS` / `DISC_DEFAULT_TAB` / `discTabOf()`（页签记忆 + 无效回落）；`state.tab` 缺省值由 `minutes` 改为 `overview`；`openItem()` / `closeDetail()` 重置默认页签；`renderDetail()` 重构为「头部 → `nav.tabs.drawer-tabs`（四页签，原生 button + `role=tab` + `aria-selected`）→ `drawer-body`（常驻 `#ocNotice` + 四个 `role=tabpanel` 分区按 `hidden` 切换）」；新增 `promptHtml()`（提示词由浮层迁入「提示词」分区，空态显示说明）；成果页签带计数角标 `成果 (N)`（N=待创建候选+已创建，0 不显示）；自动定位三入口落点：`doFinish`/`#ocStart`/`reveal` → `prompt`、`doCreate` → `drafts`；「收起」= 清 `state.prompt` + 切回默认页签；`#ocPane` id 保留在成果分区（`bindDrafts` 零改动）；`detailSig`/`detailEditing`/失焦补绘机制未动。
  - `scripts/web/style.css`：仅新增 `.disc-empty-prompt` 空态样式；页签行复用 REQ-20260909-006 `.drawer-tabs`（含 `flex-wrap: wrap` 窄屏换行）；`.drawer-back` 相关规则未动（BUG-20260909-007 口径不回归）。
  - 测试：新建 `scripts/tests/discussion-tabs-20260909-012.test.mjs`（T1–T10 静态契约 + vm 行为，先跑红后跑绿）；`scripts/tests/discussion-ui.test.mjs` U5 两处旧双页签文案断言随页签更名同步更新（功能断言不动）。全量 `npm test`：121 个测试文件全部通过。T11（1020px 两形态 / 深浅色 / 换行）留人工浏览器目检。
  - 与 `ui-demo.html`（完善阶段演示）核对：页签键 overview/minutes/drafts/prompt 一致。

