# 设计 — REQ-20260910-025 排序下拉组件要和搜索框平齐

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260910-016 把排序下拉 `#reqSort` 迁入第三行定位组后，`.sort-select` 基础样式仍是
`height: 24px`，而搜索组 `.global-search.module-search` 由内容撑起实际渲染高约 31-32px——
同行时下拉矮一截；空间不足时 `.locate-group` 的 `flex-wrap: wrap` 让两控件上下堆叠（用户
截图现象）。本需求只做「等高平齐」的纯视觉调整：排序、搜索的功能行为、显隐口径与
REQ-20260910-016 的布局契约全部沿用。

## 方案

（技术选型、接口设计、影响面）

**样式（style.css，唯一实现点）**：在 `.page-head .module-search` 规则后新增定位组作用域
的等高规则——`.page-head .locate-group .sort-select` 与 `.page-head .locate-group
.module-search` 由**同一声明块**给定显式 `height: 32px`（项目全局 `* { box-sizing:
border-box }`，含 1px 边框仍严格等高、上下边缘对齐；垂直居中沿用组容器既有的
`align-items: center`）；另为加高后的排序下拉补 `.page-head .locate-group .sort-select
{ padding: 0 8px }` 保持可读。目标值 32px 与条目 ui-demo.html「平齐后」对照态一致。

**作用域隔离（复用不破坏）**：等高只写在 `.page-head .locate-group` 作用域，不改基础
`.sort-select`（讨论筛选条行末 `.oncall-filters .sort-select` 维持 24px 原状）、不写进基础
`.global-search` / `.search-input`（全局面板搜索 `.global-panel-tools .search-input` 的
字号与内边距口径不变，搜索组内容高度来源不动）。

**布局与行为零改动**：`.locate-group` 的 flex / 居中 / 可换行 / 靠右、≤720px 窄屏分行与
搜索伸缩、`#reqSort` 五选项与 `syncReqSortVisibility` 显隐口径、搜索全部交互均沿用现状；
index.html 仅补一行条目溯源注释。

**开源选型（REQ-20260909-015）**：自研，理由——本需求是既有自研 Web 界面内两条 CSS
作用域规则的等高声明（纯 CSS），无合适第三方库可复用；不引入新依赖、不复制开源源码，
不创建 licenses.md。

## 风险与边界

- REQ-20260910-016 契约测试（`sort-locate-group-20260910-016`）必须零回退：组容器五项
  声明、窄屏分行 / 伸缩、显隐接线、Tab 顺序均不动。
- 复用位置回归面：讨论筛选条行末排序、全局面板搜索的尺寸口径由 A3 用例锚定。
- 「所有宽度恒不换行」为 README 待确认项，本次不做（沿用 016 允许极窄分行 / 伸缩的口径）。
- ui-demo.html 为需求阶段产出的离线演示，已含「现状 / 平齐后」对照，由 A6 用例守护，
  不随生产实现改动。
