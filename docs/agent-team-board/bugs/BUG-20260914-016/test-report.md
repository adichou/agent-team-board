# 测试报告 — BUG-20260914-016 分支浏览的搜索框要往上移到和分支名在同一行

- 时间：2026-09-14T12:22:14.344Z
- 执行者：zcode-batch-049-1
- 测试框架：node:assert/strict + vm 桩 DOM（项目自研测试口径）
- 覆盖率：未统计

## 总结

分支浏览提交记录面板搜索控件上移与分支名同一头部行：build.js searchRow 注入 bld-log-head（分支名→搜索→刷新同行、未选分支无搜索控件口径不变）；style.css 头部行去 space-between 加 flex-wrap、搜索容器改 flex:1 1 160px 吃剩余宽度（窄屏放不下先收缩再折行不溢出）；搜索/分页/禁用/草稿回写行为零回归。build-ui N7g 增同行断言、N7i 增静态契约，先红(2败)后绿(17/17)，全量 235 文件 0 失败。归因 REQ-20260914-002。

## 明细

### 变更清单

- `scripts/web/build.js` `renderBranchesPane()`：
  - `searchRow` 模板（`.bld-log-search` 容器，`#bldLogSearchInput` / `#bldLogSearchGo` / `data-log-search-clear` 不变）改注入 `.bld-log-head` 内 `<strong>` 之后、`#bldLogRefresh` 之前——分支名 + 搜索输入框 +「搜索」（+生效关键词时「清除」）+「刷新」同一行；不再在头部行下方独占一行。
  - 未选分支仍只渲染 `<strong>提交记录</strong>`，无搜索控件（口径不变）；注释补 BUG-20260914-016 出处。
- `scripts/web/style.css`：
  - `.bld-log-head`：去掉 `justify-content: space-between`，新增 `flex-wrap: wrap`；新增 `.bld-log-head > strong { flex: none; }`。
  - `.bld-log-search`：去掉独立行的 `margin-bottom: 8px`，改 `flex: 1 1 160px; min-width: 0`（沿用既有弹性口径）吃掉行内剩余宽度；容器保留 `flex-wrap: wrap`。
  - 深浅色沿用既有 CSS 变量；无文案改动（i18n 不动）。
- `scripts/tests/build-ui.test.mjs`：
  - N7g 用例名与断言口径同步（「搜索行」→「搜索控件」），新增同行断言：`.bld-log-search` 容器唯一（无独立搜索行）、`bld-log-head` 内依次为 分支名 `<strong>dev</strong>` → 搜索容器 → 输入框 → 刷新按钮。
  - N7i 静态契约新增：build.js 模板 `searchRow` 注入头部行；style.css 头部行无 `space-between`、有 `flex-wrap: wrap`、搜索容器 `flex: 1 1 160px`。
- 条目 `design.md`：归因 REQ-20260914-002（其 design.md 落定独立一行形态，本单为形态修正）；落定 README 待确认的窄屏换行策略（先收缩后折行）；开源选型说明（无合适库，零依赖原生 JS 自研布局微调）。

### TDD 过程

1. 跑红（新增断言先行）：`node scripts/tests/build-ui.test.mjs` → 17 个用例失败 2（N7g 同行断言、N7i 模板注入静态契约；其余为既有内容基线通过）。日志：`docs/agent-team-board/dispatch/runs/run-20260914-242/red.log`。
2. 实现后跑绿：同命令 → 17 个用例全部通过。日志：`docs/agent-team-board/dispatch/runs/run-20260914-242/green.log`。
3. 回归全量：`node scripts/tests/run-all.mjs` → 共 235 个测试文件，失败 0。日志：`docs/agent-team-board/dispatch/runs/run-20260914-242/run-all.log`。

### 验收对照（README 验收说明）

1. 同一行：N7g 断言分支名 → 搜索输入框/按钮 → 刷新 依次同在 `bld-log-head` 内，`.bld-log-search` 容器唯一（不再独立一行）。✓
2. 搜索行为回归：N7g 原有断言全保留（q 透传、命中计数「共 N 条匹配」、高亮、无命中空态与「该分支暂无提交」区分、清除恢复、翻页带 q）。✓
3. 状态反馈回归：N7g 断言执行中输入框/按钮禁用、按钮「搜索中…」、重复触发不发新请求、「刷新」保持关键词（草稿回写链路不动）。✓
4. 出现时机：N7g 断言未选分支无 `bld-log-search`。✓
5. 窄屏不破版：`.bld-log-head` flex-wrap + 输入框 `min-width: 0` 先收缩再折行，静态契约断言覆盖（策略已在 design.md 落定）。✓
6. 主题：无新增颜色，全部沿用既有 CSS 变量。✓
7. 测试同步：N7g/N7i 按结构调整更新并新增断言；run-all 全量通过。✓
8. 范围外不回归：左侧分支列表 / 同步 / 推送 / 远端空态 / 非 git 仓库引导无改动，全量测试佐证。✓
