# 测试报告 — BUG-20260921-009 命令模块「最近执行」不显示修复（run-20260921-326）

- 日期：2026-09-21　执行：zcode-batch-059-11
- 新增测试：`scripts/tests/bug-20260921-009.test.mjs`（TDD 先红后绿，4 例：T1 进入模块渲染空态提示 /
  T2 页签切往返后最近执行条目保留 / T3 离开再进入模块条目保留 / T4 控制用例零回归；修复前 3 红 1 绿，
  修复后 4 绿）
- 全量回归：`npm test` → **307 个测试文件，失败 0**（输出见同目录 test-output.log）
- 覆盖框架：Node 内建 `node:assert/strict` + `vm` 装载真实 `scripts/web/commands.js` 的自研 runner
  （fake DOM 以「容器 innerHTML 赋值 = 销毁重建子树」语义模拟浏览器，与仓库既有测试同构）

## 根因（引入来源 REQ-20260920-004，编号经 atb list 核验；commit 12ac4ae 引入 commands.js）

`scripts/web/commands.js` 的 `render()` 以 `#commandsView.innerHTML = ...` 整体重建模块 DOM
（含「最近执行」列表容器），但只调用 renderList / renderDetail / renderOutput / renderHistory，
**漏调 `renderRecent()`**（其此前仅由点选命令 bindCmdPick 与执行收敛 withDone 触发）。因此：

1. 进入命令模块（默认即「最近执行」页签）：列表容器为空节点，空态引导提示不显示；
2. 成功执行后条目短暂出现（withDone 调用 renderRecent），但 `switchTab`（页签往返）或再次
   `enter`（离开再进入）经 `render()` 重建 DOM 后最近列表被清空且不重渲染——条目消失。

`state.recents` 数据未丢（会话内留存），纯渲染遗漏。

## 修复

`render()` 中补调 `renderRecent()`（renderList 之后一行），任何经 `render()` 的 DOM 重建都会
重渲染「最近执行」（空态提示或去重条目）。无文案改动（复用 i18n.js 既有词条）、无交互与数据
口径变化（去重 10 条、仅成功计入、点击回填不变）。

## 交付文件

1. `scripts/web/commands.js`：`render()` 补调 `renderRecent()`（带 BUG 编号注释）。
2. `scripts/tests/bug-20260921-009.test.mjs`（新增 4 例，vm 行为测试）。
3. 条目 `README.md`：现象 / 复现步骤 / 期望行为 / 修复记录补全。
4. 条目 `design.md`：引入来源归因（REQ-20260920-004）+ 根因分析 + 方案 + 风险边界
   （未引入开源依赖，不创建 licenses.md）。
