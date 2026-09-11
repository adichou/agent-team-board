# 设计 — BUG-20260909-009 已接受列表的选择区域布局拥挤，需要优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260909-002**（经 `atb list` 核验存在：「列表头与批量操作条合并为单行：去清空选择、文案精简」，in-progress）
- 次要背景：REQ-20260909-007（左组新增常驻「开始完善」，已接受档成为最挤一行的直接增量）。两者叠加把 9 个控件压进受 460px 抽屉挤压的单行，是拥挤的直接来源；REQ-20260909-002 落地时只做了「合并 + 允许换行」，未对换行粒度（逐项散落）与右组显隐引起的高度跳变做约束。

## 根因分析

1. **单行承载全部控件且宽度被挤压**：`.req-caption` 单行 flex 内并排左组 5 个 + 右组 4 个元素（勾选后 9 个），列表栏宽度 = 窗口 − 边距 − 抽屉 460px（`.req-split` 双栏，>1020px 生效），1280px 窗口下列表内容宽仅约 740px。
2. **换行粒度为逐项**：`.caption-left` / `.sel-group` 各自 `flex-wrap: wrap`，宽度不足时控件一个一个掉行，换行点随拖动跳动。
3. **分隔线可悬挂**：`.caption-divider` 是 `.sel-group` 的首个子元素，右组整组掉行时 1px 竖线悬挂在新行行首。
4. **右组显隐引发高度跳变**：`#selGroup` 零勾选整体隐藏、有勾选整体出现，单行结构下勾选首项瞬间新增 4 元素导致整行重新换行、表头高度突变。
5. **选择区被隔断**：与勾选直接相关的控件分居两端（全选/全不选在左组、已选计数/批量动作在右组），中间隔着排序与快捷入口。

## 方案

**固定两行结构（与条目 ui-demo.html「期望（优化示意）」一致）——行 1 常驻信息，行 2 连续选择区；作用范围：六档统一**（六档共用同一静态列表头，逐档差异布局会造成结构不一致；已计划档 8 控件次拥挤，非选择三档在 BUG-20260909-008 后选择控件整体隐藏、自然收敛为单行）：

```html
<div id="reqCaption" class="req-caption">
  <div class="caption-row caption-info"><!-- 行1：#reqCount · #reqSort · #laneQuickEntry -->
  <div id="selectRow" class="caption-row caption-select"><!-- 行2：#selectOperable · #selectNone · #selGroup（#selCount + 按档批量按钮） -->
</div>
```

- `scripts/web/index.html`：`.caption-left` 改为 `.caption-row.caption-info`（计数 / 排序 / 快捷入口）；新增 `.caption-row.caption-select`（id=`selectRow`）承载全选 / 全不选与 `#selGroup`；删除 `.caption-divider` 节点。
- `scripts/web/style.css`：
  - `.req-caption` 改 `flex-direction: column` + 行间距 6px（固定两行，不再单行逐项散落）；
  - `.caption-row` 行内 flex、允许 wrap（兜底按组整体换行：行 2 的换行边界只落在 全选/全不选 与 `#selGroup` 之间，按钮自身不换行）；
  - `.sel-group` 删除 `margin-left: auto`（与全选 / 全不选相邻构成连续选择区）；删除 `.caption-divider` 规则（两行结构下无需行内分隔，根除悬挂可能）。
- `scripts/web/app.js` `syncAcceptance`：新增一行 `#selectRow` 按档 `classList.toggle('hidden', !laneSelectable)`（非选择三档整行隐藏、无空占位；选择档恒可见——勾选首项右组出现 / 消失时行 2 高度稳定，全选 / 全不选常驻）。其余逻辑零改动。
- `scripts/web/oncall.js`：讨论视图列表头内联的 `caption-left` 类名同步改为 `caption-info`（纯类名跟随，无行为变化）。

**对既有呈现契约的调整说明（README 允许，须在此说明理由与替代口径）**：

- REQ-20260909-002「合并为单行」→ 改为「合并为紧凑固定两行」：合并的意图（去独立操作条、去清空选择、零勾选无空占位、结果区在表头外）全部保留；单行在已接受档需容纳 9 控件（约 700px+），在 740px 内容宽下无鲁棒余量，是本 Bug 的直接根因，故以两行结构替代。
- REQ-20260909-007「快捷入口常驻左组、零勾选可见」→「常驻信息行（行 1 末尾）、零勾选可见」：常驻与仅导航意图不变，位次由「#selectNone 之后」调整为「#reqSort 之后（行 1 末尾）」，与选择控件解耦后不再参与选择区排布。

**受影响测试清单**（TDD：先跑红后跑绿）：

- 新增 `scripts/tests/caption-two-row-20260909-009.test.mjs`（C1 静态两行结构 / C2 CSS 契约（column、行 wrap、sel-group 无 margin-left auto、无 divider）/ C3 行按档显隐与勾选零跳变 / C4 契约归位抽查）。
- `scripts/tests/selection-bar-merge.test.mjs` M1：合并行结构断言改为两行结构（reqCaption 含两行、行内 wrap、右组不再 margin-left:auto）。
- `scripts/tests/lane-quick-entry-20260909-007.test.mjs` Q1：位次契约改为「#laneQuickEntry 在 .caption-info 内、#reqSort 之后」；CSS 断言类名跟随。
- `scripts/tests/selection-lane-scope.test.mjs` S13：位次断言同步改为信息行口径。
- 未受影响复核：`impl-entry-ui.test.mjs` / `batch-ui.test.mjs` / `accept-ui.test.mjs` / `refine-ui.test.mjs`（仅断言 `#selGroup` 等节点存在与显隐行为，不断言位次 / 类名）。

## 风险与边界

- 极窄宽度（≤1020px 窄屏）行 2 可能按组换为两行（全选/全不选 与 `#selGroup` 之间）：组内不拆散、无横向滚动，底线保持；`#selGroup` 内部按钮在极窄下仍可换行（原窄屏口径保留）。
- 非选择三档 `#selectRow` 整行隐藏后表头为单行，切档时表头行数变化属预期（切档是显式导航，非本 Bug 约束的「勾选首项」场景）。
- `#selectRow` 初始不 hidden：默认档（待接受）为选择档，首帧即应有选择行；其他档由 `syncAcceptance` 首轮同步收敛。
- 深浅色：无新增颜色，沿用现有 CSS 变量；控件仍为原生 button/select，Tab / 回车可达性不变。
- 不动 BUG-20260909-006 / BUG-20260909-008 已定口径（批量入口收敛任务模块、非选择档选择控件按档隐藏）。
