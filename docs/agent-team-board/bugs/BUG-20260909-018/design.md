# 设计 — BUG-20260909-018 单详情也太矮了，请优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。（本文件由本单 worker 于 2026-09-10 实施前补齐定稿）

## 引入来源（源单）

- 引入来源：REQ-20260909-009（README 内联截图「等宽缩略、点击放大」交付口径，落地为
  `.doc-shot` 的 `max-width: min(420px, 100%); max-height: 260px`）；缩略形态沿自讨论单
  `figure.oncall-fig`（REQ-20260907-001）。编号已登记于 README 并经 `atb list` 核验存在。

## 根因分析

两个独立的 CSS 约束叠加，均只涉及展示层（`scripts/web/style.css`），JS 接线无缺陷：

1. **截图被压小**：`.doc-shot` 固定 `max-height: 260px`（REQ-20260909-009 交付时的缩略口径）。
   1194×1402 竖版截图按比例缩至约 221×260（原图约 18.5%），界面截图内文字不可辨认。
   宽度上限 420px 在宽屏分栏（右栏轨道 460px，内容宽约 388px）本就不生效，但对横版图
   在窄屏覆盖抽屉（内容宽约 500px）仍是实际约束。
2. **内容区下方空白**：`.drawer` 为纵向 flex 容器（头部 → 页签行 → `.drawer-body`），但
   `.drawer-body` 只有 `padding + overflow-y: auto`、无 `flex: 1`，高度按内容自然收缩——
   抽屉本身撑满工作区高度，README 渲染结束后其下的抽屉面板就整段露白。文档框 `#docView.md`
   亦无拉伸约束，随内容自然高度结束。

## 方案

纯 CSS 修复（不动 app.js 接线；点击放大 / 失败占位 / lazy / 8MB 等交互与创建口径全部保持）：

1. **放宽 `.doc-shot` 默认展示**（`scripts/web/style.css`）：
   - `max-height: 260px` → `min(58vh, 640px)`：以视口高度为基准的动态上限（对齐条目
     ui-demo.html「期望示意」取值），竖版高分辨率截图在详情抽屉可用高度内尽量放大；
     短窗口（如 58vh < 260px 的极矮窗口）不会溢出，多图 README 由 `.drawer-body` 滚动消化。
   - `max-width: min(420px, 100%)` → `min(640px, 100%)`：横版截图在窄屏覆盖抽屉
     ~500px 内容宽内不再被 420px 卡住；宽屏分栏右栏内容宽 ~388px，实际仍由 100% 兜底。
   - 边框 / 圆角 / `object-fit: contain` / `cursor: zoom-in` / `background: var(--bg)`
     原样保留（深浅色外观与放大交互不回退）。
2. **内容区高度利用**（同文件，仅作用于条目详情抽屉 `#drawer`）：
   - `#drawer > .drawer-body` 增 `flex: 1; min-height: 0; display: flex; flex-direction: column`：
     body 撑满抽屉剩余高度；`overflow-y: auto` 口径不变（内容超一屏照常滚动）。
   - `.drawer-pane[data-pane="doc"]` 增 `flex: 1; display: flex; flex-direction: column`，
     其子 `.md` 增 `flex: 1`：说明 / 设计 / 测试用例等文档页签的 markdown 框拉伸填满可用
     高度，内容不足一屏时文档框底边贴齐 body 底部，不再露出大段空白面板。
   - 基本信息（info）/ 讨论纪要（disc）页签与讨论模块抽屉（`.oncall-drawer .drawer-body`
     已自有 flex 口径）不受影响，维持自然高度堆叠。
3. **豁免裁定——讨论模块 `.oncall-fig img`（260px 上限）本批不调整**：
   讨论单截图是问答轮次卡片内的行内插图，一屏内多轮纵向堆叠，放宽默认尺寸会显著拉长
   每轮卡片、破坏轮次浏览节奏，且本单现象 / 复现 / 验收全部针对条目详情抽屉；讨论侧
   放大通道（`#oncallLightbox`）已可用。如需同样优化应另立需求单评估。

### 测试设计（TDD）

新增静态契约测试 `scripts/tests/doc-shot-size-20260909-018.test.mjs`（方式对齐
drawer-height.test.mjs 的 CSS 规则提取）：

- G1 `.doc-shot` 尺寸放宽：高度上限不再是固定 260px，为 `min(<vh>, <px>)` 形态且像素上限
  ≥ 480（显著大于 260）；宽度上限 > 420；边框 / 圆角 / object-fit / zoom-in / var(--bg) 保留。
- G2 内容区拉伸：`#drawer > .drawer-body` 含 `flex: 1` + `min-height: 0` + 纵向 flex，
  `overflow-y: auto` 保留；`.drawer-pane[data-pane="doc"]` 及其 `> .md` 拉伸口径存在。
- G3 交互接线不回退：app.js 仍含 `doc-shot` 类添加、`loading = 'lazy'`、`#oncallLightbox`
  接线与「无法加载」占位文案。
- G4 豁免回归：`.oncall-fig img` 维持 `max-height: 260px`（讨论侧不动）。
- 全量回归：`node scripts/tests/run-all.mjs`（含 drawer-height.test.mjs D1–D5、
  item-shot-ui.test.mjs U1–U8、discussion-ui.test.mjs）。

## 风险与边界

- **REQ-20260908-005 口径**：本修复只动 `.drawer-body` 及文档页签内容的展示尺寸 / 拉伸，
  不触碰 `.req-split > .drawer` 的宽屏 static / 窄屏 absolute 定位与高度边界；
  drawer-height.test.mjs D1–D5 必须保持通过。
- **flex 化 `.drawer-body` 的副作用**：仅作用于 `#drawer`；info / disc 页签作为 flex item
  高度仍为自然高度（无 flex-grow），内部子元素仍是常规块布局，间距不变。文档页签内容
  超高时依赖 flex item 的 automatic minimum size（不塌缩）+ `overflow-y: auto` 滚动。
- **截图默认放大后的阅读影响**：多图 README 纵向变长由 body 滚动消化；点击放大（lightbox）
  仍是全尺寸查看出口，二者互补。
- **深浅色外观**：仅尺寸 / 拉伸变化，颜色全部沿用既有 CSS 变量，无新增配色。
