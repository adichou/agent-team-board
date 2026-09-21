# 设计 — BUG-20260921-009 命令模块的最近执行没有显示，请修复

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260920-004（已核验：`atb list` 在册；commit 12ac4ae 引入 scripts/web/commands.js，
  其 `render()` 自首版起即漏调 renderRecent）

## 根因分析

`scripts/web/commands.js` 的 `render()` 以 `host.innerHTML = ...` 整体重建 `#commandsView`
DOM——「最近执行」列表容器随之被销毁重建为空。但 `render()` 只调用
renderList / renderDetail / renderOutput / renderHistory，**漏调 `renderRecent()`**。
`renderRecent()` 此前仅在两处触发：点选命令（`bindCmdPick`）与执行收敛（`withDone`）。因此：

1. 进入命令模块（`enter` → `render`，默认页签 recent）：最近列表容器为空节点，空态提示不渲染。
2. 成功执行后条目短暂显示（withDone 调用 renderRecent），但 `switchTab`（切页签往返）与再次
   `enter`（离开再进入）都会经 `render()` 重建 DOM，最近列表被清空且不再重渲染——条目消失。

state.recents 数据本身未丢（会话内留存），纯渲染遗漏。

## 方案

在 `render()` 中补调 `renderRecent()`（置于 renderList 之后），与 renderDetail / renderOutput /
renderHistory 同口径：任何经 render() 的 DOM 重建都会重渲染「最近执行」列表（空态提示或条目）。
无交互与数据口径变化（去重 10 条、仅成功计入、点击回填等逻辑不变）。

**开源选型（REQ-20260909-015）**：无合适库——本修复为前端一处渲染调用遗漏的补齐（单行调用），
引入任何库的成本与风险均高于自研；未引入开源依赖，不创建 licenses.md。

## 风险与边界

- renderRecent 幂等重渲染：render() 期间 `#commandsView .cmd-list[aria-label^="最近执行列表"]`
  容器必然存在（render 骨架先建后渲染各分区），loading / error 阶段 renderRecent 正常显示空态，
  不与 renderList 的加载态冲突。
- 无文案改动：空态提示与条目模板均为既有字符串（i18n.js 已收录），不涉及中英同步新增。
- 回归面：命令模块其余分区（列表 / 详情 / 输出 / 历史）渲染路径未动；req-20260920-004 契约测试保持通过。
