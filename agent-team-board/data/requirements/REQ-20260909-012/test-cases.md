# 测试用例 — REQ-20260909-012 讨论详情也要支持多页签布局

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/discussion-tabs-20260909-012.test.mjs`（静态契约 + vm 行为；
> 1020px 两形态、深浅色与换行效果为人工浏览器实测，沿用 REQ-20260909-006 目检口径）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 页签行结构：drawer-head 之后、drawer-body 之前有 `nav.tabs.drawer-tabs[role=tablist]`，四页签顺序 概况→纪要→成果→提示词（data-tab=overview/minutes/drafts/prompt），页签均为原生 button 且带 `role="tab"` + `aria-selected`（补齐现状缺失） | P0 | 通过 |
| T2 | 分区呈现：drawer-body 内四个 `role="tabpanel"` 分区（data-pane 对应），非当前分区带 `hidden`，当前分区无；常驻 `#ocNotice` 在页签行之上（nav 之前），读取失败时含「重新读取纪要」入口 | P0 | 通过 |
| T3 | 概况分区：meta-grid 五字段与旧绑定需求链接 `#ocGotoReq` 归入 data-pane="overview"，跳转事件保留 | P0 | 通过 |
| T4 | 纪要分区：讨论背景 + 纪要 + 旧版历史问答（`legacyRoundsHtml`）在 data-pane="minutes" 尾部；历史问答不独立页签（无 legacy 页签） | P0 | 通过 |
| T5 | 成果分区：`draftsHtml`（已创建成果跳转 + 候选草稿勾选/编辑/批量创建 `#ocCreate` + 失败重试）归入 data-pane="drafts"，`#ocPane` id 保留供 `bindDrafts` 兼容；页签带计数角标 `成果 (N)`（N=待创建草稿+已创建，N=0 不显示） | P0 | 通过 |
| T6 | 提示词分区：`disc-prompt` 块迁入 data-pane="prompt"（textarea readonly + 复制 + 收起）；未生成/已收起时空态说明不隐藏页签；「收起」= 清 `state.prompt` 并切回默认页签概况；复制双回退（clipboard + execCommand + 全选手动复制）保留 | P0 | 通过 |
| T7 | 页签记忆与重置：`openItem` 切换记录、`closeDetail` 关闭均重置默认页签 `overview`；`detailSig` 含 `state.tab` 与 `state.prompt?.kind`（轮询重渲染不重置）；无效页签值回落默认 | P0 | 通过 |
| T8 | 自动定位等价：`doFinish` 成功后 `state.tab='prompt'`（收尾提示词直接可见）；`doCreate` 完成后 `state.tab='drafts'`（逐项结果）；`reveal` 后启动提示词 + `state.tab='prompt'` | P0 | 通过 |
| T9 | vm 行为：加载实际 oncall.js + fetch stub，openItem 后 `#ocDetail` innerHTML 含 tablist/四页签/四分区；页签切换处理器纯前端（不含 api 调用） | P1 | 通过 |
| T10 | 样式与回归契约：复用 `.drawer-tabs`（含 flex-wrap 窄屏换行）不新写重复页签样式；`.disc-pane` 内容布局保留；`#ocBack` 仍复用 `.drawer-back`（BUG-20260909-007 口径不回归）；旧双页签文案「背景与纪要」「生成需求 / Bug」不再作为页签，功能断言（discussion-ui.test.mjs U5）同步改为新页签文案 | P1 | 通过 |
| T11 | 人工目检（不在自动化内）：宽屏右栏与窄屏 ≤1020px 覆盖层两形态页签行换行、深浅色 CSS 变量、归档后全分区回看 | P1 | 待人工 |
