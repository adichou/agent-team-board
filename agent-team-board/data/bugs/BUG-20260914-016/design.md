# 设计 — BUG-20260914-016 分支浏览的搜索框要往上移到和分支名在同一行

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260914-002**（分支浏览中支持在当前分支中搜索提交记录，编号经 `atb list` 核验存在）。
  其 design.md 落定「`bld-log-head` 下方新增 `.bld-log-search` 行」的独立一行形态；本单为用户对该落定形态的修正意见（搜索控件上移与分支名同一行），属纯布局调整，搜索能力口径（REQ-20260914-002）与分页口径（BUG-20260914-009）不变。

## 根因分析

非功能性缺陷，是布局形态修正：REQ-20260914-002 实施时在 `renderBranchesPane()` 中把搜索控件渲染为头部行（`.bld-log-head`，`justify-content: space-between` 两端对齐：分支名 + 刷新）**下方**的独立一行 `.bld-log-search`，导致右栏首屏多占一行纵向空间、头部行右侧大量留白。

## 方案

纯前端布局调整（`scripts/web/build.js` 模板 + `scripts/web/style.css`），DOM 节点 id、事件绑定、文案全部不动：

1. `scripts/web/build.js` `renderBranchesPane()`：`searchRow` 模板（`.bld-log-search` 容器，`#bldLogSearchInput` / `#bldLogSearchGo` / `data-log-search-clear` 绑定口径不变）改注入 `.bld-log-head` 内 `<strong>` 之后、`#bldLogRefresh` 之前——分支名 + 搜索输入框 +「搜索」（+「清除」，仅已有生效关键词时）+「刷新」同一行；未选分支时头部仍只渲染 `<strong>提交记录</strong>`，无搜索控件。
2. `scripts/web/style.css`：
   - `.bld-log-head` 去掉 `justify-content: space-between`（改由搜索容器弹性占满剩余宽度），新增 `flex-wrap: wrap`；新增 `.bld-log-head > strong { flex: none; }` 防分支名被压缩。
   - `.bld-log-search` 去掉独立行的 `margin-bottom: 8px`，改 `flex: 1 1 160px; min-width: 0`（沿用 README 既有弹性口径）吃掉行内剩余宽度；容器自身保留 `flex-wrap: wrap`。
   - 深浅色沿用既有 CSS 变量，无新增颜色、无媒体查询。
3. README「期望行为」中**待确认**的窄屏/长名换行策略落定：头部行允许 `flex-wrap: wrap`——宽度不足时输入框先收缩（`min-width: 0`），仍放不下则按序折行（搜索控件/刷新换到下一行），不横向溢出、不遮挡；≤960px 单栏布局同样适用，无需额外断点。
4. 行为零回归：输入草稿 `input` 回写、回车/按钮提交、空白等同清除、`loading` 禁用（按钮「搜索中…」）、无命中空态、命中计数与高亮、分页条、i18n 词典全部不动；左侧分支列表、同步/推送、远端空态（BUG-20260914-006）、非 git 仓库引导等范围外口径不动。

**开源选型（REQ-20260909-015）**：无合适库的原因——本单是把一个 flex 容器节点移入另一行并调整 3 条 CSS 规则的布局微调，项目 Web 端为零依赖原生 JS，引入任何 UI/布局库的成本与体积远高于自研；未引入开源库，不创建 licenses.md。

## 风险与边界

- 极窄宽度下头部行折回两行（分支名行 + 搜索控件行），视觉接近旧形态但保证不溢出不遮挡（README 已授权折行策略）。
- `bindCommon` 均经 id / 属性选择器绑定，与容器层级无关，无绑定回归风险（N7g 行为测试 + N7i 静态契约覆盖）。
- 测试同步：`scripts/tests/build-ui.test.mjs` N7g 新增「搜索控件在 `bld-log-head` 头部行内（分支名 → 搜索 → 刷新顺序、容器唯一）」断言，N7i 新增「模板注入头部行、头部行 flex-wrap、搜索容器 flex 弹性、去掉 space-between」静态契约。
