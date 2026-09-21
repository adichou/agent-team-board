# 测试报告 — BUG-20260921-011 刷新时顶栏项目选择器空数据塌缩、模块页签跳动（run-20260921-333）

- 日期：2026-09-21　执行：BUG-20260921-011（批次 batch-20260921-061，TDD 先红后绿）
- 新增测试：`scripts/tests/bug-20260921-011.test.mjs`（14 例 T1~T14；实现前提取
  setProjectList / onProjectSelChange 即失败跑红，实现后 14/14 跑绿；输出见
  `docs/agent-team-board/dispatch/runs/run-20260921-333/test-output.log`）
  - T1/T2 加载占位：未知项目显示「加载项目中…」、已知项目显示「项目名（加载中…）」，
    均禁用且不隐藏（不塌缩），title 指向全路径；
  - T3 加载成功：列表与选中项正确、恢复可交互、title 为当前项目全路径（长名截断可悬浮看全路径）；
  - T4 空态：「暂无项目」占位可见不隐藏、禁用，title 指引管理项目入口；
  - T5/T6/T7 失败态与重试：「加载失败，点此重试」与空态严格区分、可交互；change 触发
    refreshHealth 重拉，仍失败回到失败态且不切换项目 / 不触发 switchProject；重试成功恢复
    ok 列表渲染；
  - T8 refreshHealth 状态机：成功非空→ok、成功空→empty、失败→error，全程选择器不隐藏；
  - T9 setProjectList 统一入口：非空→ok、空→empty；app.js 中 `state.projects =` 裸赋值仅存
    于 setProjectList 内（局部路径不再残留旧状态）；
  - T10 boot 首帧时序：health await 之前已置 loading 并 renderProjectSel；catch 置 error；
    成功走 setProjectList 区分 ok/empty；
  - T11 静态首帧：index.html #projectSel 内置「加载项目中…」option 且初始 disabled；
  - T12 样式：.project-sel 固定 width:200px（原 max-width 移除）、ellipsis 截断保留；
    ≤640px 竖屏 width:auto + min-width:120px 最小占位；
  - T13 i18n：新增词条（加载项目中… / 正在加载项目列表… / 加载失败，点此重试 /
    项目列表加载失败，点击本选择器重试 / 动态「◇（加载中…）」）双语齐备；
  - T14 回归：常态 change 直切 switchProject；营销未保存守卫链路（REQ-20260910-019）不变。

## 实现范围

- `scripts/web/app.js`：state 增 projectsState 状态机；setProjectList 统一入口；
  renderProjectSel 四态渲染（loading/ok/empty/error，任何状态不隐藏）；refreshHealth
  带状态机重拉；onProjectSelChange 命名入口（error 态重试 + 常态守卫切换）；boot()
  health 等待前首帧渲染占位、数据一到即渲染；clearProjectState 空态收敛。
- `scripts/web/index.html`：#projectSel 静态首帧占位 option + 初始 disabled。
- `scripts/web/style.css`：.project-sel 固定 200px 宽；≤640px 自适应 + min-width:120px。
- `scripts/web/i18n.js`：EN 静态 4 词条 + EN_DYNAMIC「◇（加载中…）」。

## 回归验证（同 log 文件）

- i18n 五套（coverage 1141 条全命中卡点 / dict / runtime / wiring / lang）全部通过；
- multi-project（M1~M8，项目切换静态契约与深链优先级不变）全部通过；
- view-tabs-right（T1~T5，顶栏页签布局回归）全部通过；
- 全量 `npm test`（314 文件）：除 2 个与本次无关的既有失败外全部通过——
  `req-20260918-002.test.mjs` D1 与 `req-doc-entry-20260916-003.test.mjs` B1a/B2a/B4，
  均断言根 README.md 旧结构（语言切换行 / 章节映射 / 目录树），失败源于工作区已存在的
  未提交 README.md / AGENTS.md 重写（本运行预留快照即含 `M README.md`、`M AGENTS.md`，
  属在途发布文档工作，如 BLD-20260920-001 / REQ-20260921-005 范畴），本次未触碰这些
  文件，待该项收口后自然恢复或需人工核对。

## 引入来源归因

- REQ-20260830-001（`atb list` 核验存在，done）：多项目选择器自始为「数据到达后渲染 +
  空即隐藏 + 无稳定宽度」；REQ-20260910-012（存在，done）页签并入顶栏为放大因素。
  详见条目 design.md。
