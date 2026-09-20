# 设计 — BUG-20260910-010 待测试界面为什么会有这个紫蓝色边框？

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：未定位（排查过程：`git log -S "picked" -- scripts/web/style.css scripts/web/app.js`
  仅命中仓库初始化提交 `0f84698`，`picked` 行标记与 `--viewrail-accent` 样式早于看板条目化
  （docs/agent-team-board REQ/BUG 体系）就已存在，无对应 REQ-/BUG- 单可归因。）

## 根因分析

`reqRowEl()`（scripts/web/app.js）给抽屉当前展示的行附加 `picked` class，
`style.css` 的 `.req-row.picked` 用 `border-color: var(--primary)`（主题蓝）+
`box-shadow: inset 3px 0 var(--viewrail-accent)`（视图切换栏专属强调色，REQ-20260906-001）
渲染「蓝边 + 左缘靛条」：

1. 标记含义在界面内零解释——行 `title` 只有 `LANE_HINT` 档位说明。
2. `--viewrail-accent` 被复用为列表行选中标记，色彩语义冲突；深色下 #818cf8 与
   「待测试」档紫 #a78bfa 极易混淆，用户把「详情打开行」误读成状态/待测试标识。
3. 视图快照（REQ-20260910-001）刷新后恢复抽屉，边框「无操作也出现」，强化无来由感。

## 方案

取 README「期望行为」方向 1（保留标记 + 含义可见 + 中性样式），不引入开源库。

改动两处：

1. **悬停提示补充含义**（scripts/web/app.js `reqRowEl()`）：
   picked 行的 `title` 在 `LANE_HINT` 档位说明之后追加
   「详情打开中（右侧抽屉正展示此条目）」；非 picked 行 title 不变。
   档位说明保留在前，键盘导航与既有提示不受影响。
2. **标记改中性样式**（scripts/web/style.css `.req-row.picked`）：
   边框与左缘条改用 `var(--text)`（浅色近黑 #1b2434 / 深色近白 #e5eaf3 的中性前景色），
   不再引用 `var(--primary)` 与 `var(--viewrail-accent)`。黑白中性色不携带状态语义，
   与六档状态色（灰/蓝/青/橙/紫/绿）及视图栏靛紫强调色均可区分，
   深浅色下都不会被读成「待测试」相关；标记形式（边框 + 左缘 3px 条）保持不变。

「关闭抽屉即消失、刷新后与抽屉恢复一致」无需新逻辑：列表重渲染签名 `listSig`
已含 `state.drawer.id`，`openDrawer`/`closeDrawer` 均重置 `state.listSig = ''` 强制重算，
picked 恒与抽屉状态同步（现有机制，测试加静态断言防回归）。

**开源选型（REQ-20260909-015）**：本修复为两处既有代码的样式与提示文案调整
（CSS 变量替换 + title 拼接），无合适开源库可复用，自研成本低于引入任何依赖；
未引入开源库，不创建 licenses.md。

## 风险与边界

- `--text` 高对比，picked 行比原主题蓝更醒目——这是有意的：中性色明示「非状态语义的
  选中标记」；若后续觉得过重，可再降饱和（属样式微调，不影响本 Bug 验收口径）。
- 不改六档状态色、`--viewrail-accent` 本身的任何用法（视图栏 / 筛选条等维持原样）。
- 不改 REQ-20260908-027 口径：勾选行仍无主题蓝边框（选择反馈仅复选框打勾态）。
- 抽屉关闭路径（✕ / Esc / 遮罩）均收敛到 `closeDrawer()`，picked 消失随既有重渲染机制。
