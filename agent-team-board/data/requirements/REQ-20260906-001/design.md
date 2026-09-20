# 设计 — REQ-20260906-001 需求和文件的切换栏要换个样式和颜色，以便和下方的需求分类切换栏区分

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

≤1020px 窄屏下，左缘工具栏自上而下是「需求/文件」视图切换组（`.view-tabs`）与
状态分类快速切换条（`.board-tabs`）。现状两组成员按钮样式完全一致：
26px 宽、面板底、灰边、9px 圆角、竖排文字，激活态均为 `var(--primary)` 主题蓝填充
（见 style.css 中 `@media (max-width: 1020px)` 的 `.view-tabs .view-tab` 与 `.board-tab`）。
用户无法一眼分辨哪组是视图切换、哪组是状态分类。
桌面端（>1020px）视图切换栏是分段控件（灰槽 + 白色激活胶囊），分类条隐藏，但也一并换色保持一致的组件识别。

## 方案

只改 `scripts/web/style.css` 的颜色与圆角/描边，**不动任何类名、DOM 结构、JS 与布局规则**：

1. 新增主题变量（`:root` 与深色 `@media (prefers-color-scheme: dark)` 各一份）：
   - `--viewrail-accent`：视图切换栏专属强调色，取现有 REQ 徽章靛蓝色系
     （浅色 `#4f46e5`、深色 `#818cf8`），与分类栏的 `--primary` 蓝形成色相区分；
   - `--viewrail-accent-soft`：淡靛蓝底色（浅色 `rgba(79,70,229,0.10)`、深色 `rgba(129,140,248,0.16)`），
     仅桌面分段控件底槽使用。
   用独立变量而非直接引用 `--chip-req`，避免语义耦合、便于日后单独调整。
2. 桌面端 `.view-tabs` / `.view-tab` / `.view-tab.active`：底槽 `var(--viewrail-accent-soft)`、
   胶囊圆角 99px、未激活项靛蓝字、激活项 `var(--viewrail-accent)` 填充白字（原为白胶囊）。
3. 窄屏（≤1020px）`.view-tabs .view-tab`：改为透明底 + 靛蓝描边 + 靛蓝字 + 99px 胶囊圆角；
   `.view-tabs .view-tab.active`：`var(--viewrail-accent)` 填充白字（原 `var(--primary)`）。
4. `.board-tabs` / `.board-tab` 规则零改动，分类栏保持主题蓝与 9px 圆角矩形。
5. 既有测试契约修订：`scripts/tests/portrait-board.test.mjs` P8 原断言
   「激活态与列 tab 一致（`background: var(--primary)`）」与本需求方向相反，
   随本需求改为断言激活态用 `--viewrail-accent`（与列 tab 区分）。

深浅色一致性：两组新变量与 `--chip-req` 同源取值（该色已用于 REQ 徽章，白字对比度与现状一致），
深色模式用提亮版靛蓝，两主题下均与既有蓝/灰体系协调；不引入新依赖、不改布局尺寸。

## 风险与边界

- **不影响其他视图**：改动仅限 `.view-tabs/.view-tab` 及两条新变量；抽屉文档 tabs（`.tab`）、
  文件树（wunderbaum）激活色不受影响；`topbar-overflow` 用例依赖的 `flex: none` 保留。
- **不破坏布局契约**：`position:fixed/top:100%/width:48px/writing-mode` 等布局声明全部保留，
  portrait-board、layout 等既有用例应继续通过。
- **风险点**：胶囊全圆角在窄屏竖排按钮上为纯观感变化，无点击热区变化（按钮外框尺寸不变）；
  靛蓝与主题蓝同框时色差可辨但同属冷色系，若人工验收认为区分度不足，只需调 `--viewrail-accent`
  取值（单点变量），无需改结构。

## 实施记录（TDD 完成后回填）

- 新增 `scripts/tests/view-tabs-style.test.mjs`（V1–V6 静态契约），实现前跑红（V1–V4 失败、V5/V6 守护项通过），实现后跑绿；
- style.css 新增 `--viewrail-accent`（浅 #4f46e5 / 深 #818cf8）与 `--viewrail-accent-soft`
  （浅 rgba(79,70,229,0.1) / 深 rgba(129,140,248,0.16)）双主题变量；
  桌面 `.view-tabs/.view-tab/.view-tab.active` 与 ≤1020px `.view-tabs .view-tab(.active)`
  改为靛蓝胶囊风格（窄屏未激活为透明底 + `color-mix` 靛蓝描边）；`.board-tabs/.board-tab` 零改动；
- portrait-board.test.mjs P8 激活态断言按新契约更新（原「激活态与列 tab 一致」与需求方向相反）；
- 回归：`npm test` 全套 21 个测试文件全部通过（改动前基线 20 个文件亦全绿）。
