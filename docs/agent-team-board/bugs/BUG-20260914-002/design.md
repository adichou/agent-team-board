# 设计 — BUG-20260914-002 版本计划中关联条目与 commit 无法全选，新建版本计划中也无法全选

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260913-001**（已 `atb list` 核验存在，done）。
  构建模块前端 `scripts/web/build.js` 选单工具行实现时引入：`#bldPickAll` 点击处理写法为
  「有跳过条目时只弹 toast、否则才 render()」，`#bldPickNone` 点击处理调用 `pickAll(key, false)`
  后完全没有 `render()`；`pickAll()` 自身只更新 `state.*Panel.picked` 不渲染。对照组 `pickItem()`
  （单条复选框）内部有 `render()`，故单点勾选正常，缺陷仅在「存在无提交候选时的全选」与
  「任意构成下的全不选」两条路径触发。

## 根因分析

- `pickAll()`（`scripts/web/build.js`）：更新内部勾选集合后直接返回跳过数，不触发 `render()`——
  状态与视图从此刻起错位。
- `#bldPickAll` 点击处理：`const skipped = pickAll(key, true); if (skipped) toast(…) else render();`
  ——把「有无跳过」与「是否渲染」错误耦合：`skipped > 0` 时用提示替代了渲染，界面复选框 /
  「已选 N 项」计数 / commit 下拉禁用态全部保持旧值；随后直接提交会用内部已更新的集合（界面看似
  未勾选却提交成功），或手动点任一复选框触发 `pickItem` 的 `render()` 使真实状态突然显形（全部勾上）。
- `#bldPickNone` 点击处理：调用后无任何 `render()`，任何候选构成下界面都不更新；勾选残留时提交
  报「请至少勾选一个条目」，与所见矛盾（此刻被别的渲染顺带清掉）。
- 现有测试（`build-ui.test.mjs` N7b 等）只断言 `selectableCandidates` 纯函数口径，未覆盖点击
  按钮后的 DOM 同步，故未拦截。

## 方案

**开源选型（REQ-20260909-015）**：未引入开源库——本修复是对本项目自有前端（零依赖原生 DOM、
字符串模板渲染）一处状态-视图同步缺陷的最小修正，无「全选按钮」类独立库诉求；引入库成本高于
自研且违背项目零依赖前端现状（自研理由：无合适库 / 引入成本高于自研）。

修复口径（README 期望行为落定）：**统一在 `pickAll()` 内 `render()`**，与单条勾选 `pickItem()`
同口径，两处点击处理退化为「调用 + 按需补 toast」：

1. `pickAll(panelKey, on)`：更新 `picked` 集合后调用 `render()` 再返回跳过数（面板 /
   候选缺失的早退路径不渲染，行为不变）。
2. `#bldPickAll` 点击处理：改为 `const skipped = pickAll(key, true); if (skipped) toast(…)`——
   跳过提示与界面更新**同时生效**，提示不再替代渲染；删除原 `else render()`。
3. `#bldPickNone` 点击处理：保持 `pickAll(key, false)`，渲染由 `pickAll` 内部保证。

效果：全选 / 全不选点击后复选框勾选、「已选 N 项」计数、行内 commit 下拉解禁态立即同步；
新建版本与添加条目两个面板共用该路径一并修复；「偶发正常」（全部候选有提交）路径行为不变
（原本就走 `render()`）；单条勾选 / commit 换选 / 面板各加载态不经过该函数，零影响。

测试：新增 `scripts/tests/bug-build-pick-all-render-20260914-002.test.mjs`（F1~F5，vm + DOM 模拟，
点击按钮监听器后断言 innerHTML）：F1 含无提交候选时全选的 DOM 即时同步 + 跳过 toast 并存；
F2 全不选即时清空（混合构成）；F3 对照组（全部有提交）不回归且全不选生效；F4 添加条目面板
同口径；F5 提交内容与界面显示一致（全选后提交 items=所见；全不选后提交拦截且无勾选残留）。

## 风险与边界

- `render()` 重建整个 `#buildView` 并重绑事件：与用户每点一个复选框（`pickItem`）的既有行为
  完全一致，无新增性能 / 状态丢失风险；面板内版本名称输入框由 `state.createPanel.name` 回填，
  重渲染不丢值。
- `render()` 触发的 `syncModalDrafts` 仅作用于 AI 完善弹窗（`state.answer`），与选单面板互斥，
  不受影响。
- 全选口径本身（仅纳入有 commit 候选的 done 条目，REQ-20260913-001 / BUG-20260913-001）不变，
  仅补渲染；`selectableCandidates` / `doneCandidates` 纯函数未动，既有测试全量回归保障。
