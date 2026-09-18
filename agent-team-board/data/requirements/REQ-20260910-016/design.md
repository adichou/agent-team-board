# 设计 — REQ-20260910-016 排序菜单放到搜索框左侧，因为都是用于定位单号的

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

需求模块的排序下拉 `#reqSort` 原位于列表头工具栏 `#reqCaption`，而模块搜索框在第三行
`#pageHead`（REQ-20260910-009 常显范围标签 + 显式清除按钮）。按时间/单号浏览与输入关键词
定位同属「找单」动作却分居两处。本设计仅迁移已有排序控件的位置与显隐，不改排序语义、
搜索行为与批量操作。

## 方案

（技术选型、接口设计、影响面）

**结构（index.html）**：第三行新增定位控件组 `<div id="locateGroup" class="locate-group">`，
内含 `#reqSort`（在前）与既有 `.global-search.module-search`（在后）——DOM 顺序即 Tab 顺序
（排序 → 搜索），中间不插入批量操作。`#reqCaption` 工具栏移除排序 `<select>` 与其注释，
其余控件（reqCount / 全选 / 全不选 / 右组 / 快捷入口）原位保留，不留占位。

**显隐（app.js）**：新增 `syncReqSortVisibility()`——`#reqSort` 仅当
`state.view === 'status' && state.board?.initialized` 时可见；HTML 初始带 `hidden`。
接入点两处：`setView()`（切模块隐藏 / 回需求恢复）与 `renderBoard()`（初始化早退前，
未初始化 / 无项目隐藏；初始化状态随轮询变化即时同步）。`clearProjectState()` 走
renderBoard/setView，天然覆盖。排序 change 绑定、`atb.req.sort` 偏好记忆、五选项、
稳定排序与已完成档截断管线全部不动。

**样式（style.css）**：`.page-head .locate-group` 为 flex 行（`align-items:center`、
`flex-wrap:wrap`、`gap:6px`、`min-width:0`、`margin-left:auto`）——宽屏副标题左、
整组靠右；靠右职责从 `.page-head .module-search` 移交定位组（排序隐藏时搜索仍随组靠右，
视觉与迁移前一致）。≤720px 媒体查询改为定位组 `flex:1 1 100%; margin-left:0` 独占整行，
组内 `.module-search` `flex:1 1 auto; min-width:0` 可伸缩——375px 下排序仍在搜索左侧同行，
极窄宽度组内换行兜底，不裁切、无横向滚动。`.sort-select` 原样式沿用。

**开源选型（REQ-20260909-015）**：自研，理由——本需求是既有自研 Web 界面内的 DOM 位置
迁移与显隐同步（纯 HTML/CSS/原生 JS），无合适第三方库可复用；不引入新依赖、不复制
开源源码，不创建 licenses.md。

## 风险与边界

- 存量契约随迁：`selection-bar-merge` / `caption-two-row-20260909-009` /
  `caption-toolbar-20260910-008`（工具栏含排序）与 `search-module-20260910-009`（窄屏
  搜索独占整行）四组断言改为新口径（排序不在工具栏 / 定位组承载），行为断言全部保留。
- 行为回归面：排序 change（记忆 + 重排）、搜索范围标签 / 清除 / Esc / `/`、状态筛选、
  已完成档截断、全选批量操作均不动，由新旧测试共同锚定。
- 其他模块（讨论/任务/文件）不新增排序能力（README 待确认项维持不扩展）。
