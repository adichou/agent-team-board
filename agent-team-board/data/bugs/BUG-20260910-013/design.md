# 设计 — BUG-20260910-013 新建条目中的讨论应该改为讨论（ASK）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：BUG-20260910-006（经 `atb list` 核验存在，in-progress「讨论（开放式）要修改」）。
  排查过程：仓库唯一提交 `0f84698`（初始化）中该选项原文为「讨论（开放式）」；
  BUG-20260910-006 的 design.md 明确将 `<option value="ask">` 文案统一为「讨论」
  （去掉后缀时未按需求（REQ）/Bug（BUG）同构口径补 ASK 前缀），即当前缺陷的直接来源。

## 根因分析

- `scripts/web/index.html` 的 `#fType` 中 `<option value="ask">` 文案为「讨论」，
  与同一下拉内「需求（REQ）」「Bug（BUG）」的类型名 + 编号前缀同构口径不一致。
- 文案演变链：初始化提交「讨论（开放式）」→（BUG-20260910-006，工作区未提交）「讨论」，
  两次均未携带编号前缀；`syncNewFormFields`、`/api/discussion` 提交分支只依赖 `value="ask"`，
  纯展示文案缺陷，不影响数据与流程。
- 旧断言 `workbench-layout.test.mjs` W6/W9 精确匹配「讨论」锁定了旧文案，需随本项同步更新。

## 方案

**开源选型（REQ-20260909-015）**：未引入任何开源库。理由：单点静态文案修改
（一个 `<option>` 文本 + 两处测试断言），无第三方库可复用，引入成本高于自研（无自研量）。

1. `scripts/web/index.html`：`<option value="ask">讨论</option>` → `<option value="ask">讨论（ASK）</option>`
   （中文全角括号、英文大写 ASK；`value="ask"` 与讨论创建语义不变）。
2. 测试先行：`workbench-layout.test.mjs` W6/W9 两处精确断言更新为 `<option value="ask">讨论（ASK）</option>`
   并引用本 BUG 编号；W6 既有 `<option value="ask">` 断言继续锁定类型值仍为 `ask`。
3. 其余不动：`app.js` 的 `syncNewFormFields`（背景（可选）/截图隐藏/创建并接受隐藏）、
   `/api/discussion` 提交、防重与失败保留输入均为行为回归验证，不在本项改动范围。

## 风险与边界

- 展开选项与收起选中值同源同一 `<option>` 文本，天然一致；键盘选择读到的 option 名称即含 ASK。
- 全角括号与「讨论（开放式）」旧词不同，不触发 W9 的 `doesNotMatch(讨论（开放式）)` 守卫。
- 范围仅新建面板类型选项；其他讨论入口（模块页签「讨论」等）按 README 明示不纳入本项。
- 工作区存在其他条目未提交改动，本次仅做单行文案与对应断言的增量编辑，不触碰其余改动。
