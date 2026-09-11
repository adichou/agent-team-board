# 设计 — REQ-20260903-002 看板页面重新设计，现在竖屏操作，每个类别的单只能看见一条，多的就要下拉滚动条，不友好

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`scripts/web/style.css` 的 ≤640px 断点（REQ-20260829-001 时代）把 `.board` 变成单列网格、
四行均分（`grid-template-columns: repeat(1,…)` + `grid-auto-rows: minmax(0,1fr)`），
每个状态列高度 ≈ 看板区 1/4，`.col-cards` 只能在列内滚动 —— 竖屏下每列只能看到约 1 张卡片，
即本次反馈的症状。

## 方案（v2 修订：验收反馈底部圆点不友好，改为左缘竖排 tab 条）

只动 ≤640px 断点与 app.js，桌面与 641–1020px 断点不动：

1. **style.css `@media (max-width: 640px)`**：`.board` 由单列网格改为 flex 横向滚动容器
   （`display:flex; overflow-x:auto; overflow-y:hidden; scroll-snap-type:x mandatory`）。
   `.board-tabs`（左缘竖 tab 条）是 `.board` 的**第一个子元素**且 `position: sticky; left: 0`——
   横滑时钉在可视区左缘，列从其下方滑过；tab 竖长条并立（`writing-mode: vertical-rl`
   状态名竖排 + 计数），管风琴/书脊风格。
   `.board .col` 为 `flex:0 0 calc(100% - 76px)` + `scroll-snap-align:start`；
   `.board` 设 `scroll-padding-left: 62px`（tab 条 48px + 列间距 14px），吸附位落在 tab 条右侧，
   列内容不被遮挡。`.col-cards` 原有「列内纵向滚动」原样生效，单列即可见多张卡片。
2. **app.js 竖 tab 条**：`ensureBoardTabs()` 懒创建并 `prepend` 到 `#board` 首位
   （因此随看板自动隐藏，无需单独的可见性同步）；4 个 `.board-tab` 按钮对应四列，
   含竖排状态名 `.vt-label` 与计数 `.vt-count`（随 renderBoard 刷新）。
   点击用 `scrollToCol`（target = `col.offsetLeft - scrollPaddingLeft`）平滑跳列；
   board `scroll`/`resize` 时按「列中心离可视中心最近」高亮当前 tab（`aria-current`）。
   保留 v1 的两项内核兜底：smooth 被取消→350ms 无位移则瞬时跳转；程序化滚动不派发
   scroll 事件→跳列后 350ms/900ms 主动校准高亮。
3. **契约测试**：`scripts/tests/portrait-board.test.mjs`（P1–P8，v2 更新 P2/P5/P6，v3 新增 P8）；
   `layout.test.mjs` T7 的 ≤640 断言为「横滑布局」。
4. **顶栏紧凑化 + 底部视图导航（v4，验收反馈：切换器要自适应、实时标记要显示、视图 tab 放底部）**：
   ≤640 时 `.path` 隐藏（v3 曾一并隐藏 `.poll`，v4 恢复显示）；`.project-sel` 撤销 110px 收窄，
   按内容自适应宽度（放不下时操作区整体换行右对齐）；`.view-tabs` 改 `position:fixed` 贴屏底
   （居中、`border-top`、面板底色、`env(safe-area-inset-bottom)` 适配 iOS 安全区），
   `.board`/`.file-view` 预留 68px 底部空间防遮挡。`.brand` 保持 `flex:1 1 auto` + 标题省略号兜底。
   该块必须位于文件末尾（在 `.project-sel`/`.view-tabs` 基础规则之后赢得级联）。
   这是对 BUG-20260830-001「≤640 换行降级」契约的演进；桌面顶栏契约（topbar-overflow.test.mjs）不动，
   其助手已升级为只查媒体查询外基础规则、#5 聚合所有 ≤640 块（契约内容不变）。
5. **视图 tab 文案（v3 验收反馈）**：`data-view="status"` 的视图标签由「看板」改为「需求」
   （与「文件」视图对举更贴切）；`data-view` 值与切屏逻辑不变，标题 h1 与其余「看板」措辞不动。
6. **连接指示配色（v4 验收反馈）**：`.poll` 在线态由弱化灰改为 `--done` 绿（一眼可辨「活着」），
   离线态 `.poll.off` 由红改为 `--muted` 灰（空圈 + 「服务离线」文字承担区分）；
   layout.test.mjs 新增 T10 锁定该配色契约。
7. **横滑布局扩展到 ≤1020（v5 验收反馈：拖宽窗口退回 2×2 网格属体验倒退）**：
   原 REQ-20260829-001 的 ≤1020「2×2 网格降级」废除，横滑看板（flex + scroll-snap +
   左缘竖 tab 条）适用范围扩大到 ≤1020；`.col` 增加 `max-width: 560px` 封顶——
   窄屏仍占满可视区，中宽窗口右缘露出下一列预览；底部视图导航同步扩到 ≤1020。
   顶栏紧凑化（路径隐藏等）维持 ≤640。layout.test.mjs T7、portrait-board.test.mjs
   P1–P5/P8 断言随之更新（2×2 断言改为横滑断言）。
8. **左侧统一工具栏（v6 验收反馈：视图切换放到列 tab 条上方）**：
   `.view-tabs` ≤1020 时 `position:fixed; top:100%; left:0` 竖排钉在顶栏正下方——
   顶栏加 `transform: translateZ(0)` 使其成为 fixed 后代包含块，换行变高自动跟随，无需 JS 测量；
   顶栏 `z-index:7` 护住视图组（列 tab 条 z:5，否则两组同处左缘会按 DOM 顺序互相遮挡，实测踩坑）；
   `.board-tabs` 顶部对齐（flex-start）并按 `--viewrail-h`（app.js ResizeObserver 同步视图组高度）
   让位，两组构成一条左工具栏；底部横条导航与 `.board`/`.file-view` 的 68px 底部占位取消，
   `.file-view` 改为预留左缘 62px。文件视图下状态列 tab 随看板隐藏，视图切换仍在可切回。
9. **连接指示仅保留图标（v6 验收反馈）**：在线「●」/ 离线「○」去掉文字，语义放 `title`
   悬停提示（实时连接：每 2 秒自动刷新 / 服务离线：数据停止刷新）；layout.test.mjs T10
   扩展断言图标后不得再跟文字。

拖拽：HTML5 DnD 在触摸端本就不可用，横滑布局不改变其可用性；鼠标窄窗口仍可拖拽。

## 风险与边界

- 触摸端本无拖拽换列能力，横滑不引入回归；如需触摸拖拽另立条目。
- scroll-snap 在 Chromium / Safari / Firefox 均稳定；老内核降级为自由横向滚动，不影响可用性。
- 列位置计算用 offsetLeft（board 全宽、body 无 margin、无 transform，相对偏移成立）。
- 不改任何 API / 状态机，纯表现层改动。

## 实施记录（浏览器实测发现与处置）

内嵌浏览器（IAB webview）实测发现两个环境怪癖，均已加兜底，不影响标准浏览器行为：

1. **programmatic smooth scroll 被取消**：`scrollTo({behavior:'smooth'})` 一律不产生位移
   （去掉 scroll-snap 复测相同，瞬时滚动正常）。处置：`scrollToCol` 发起 smooth 后 350ms
   检查位移，仍停在起点则 `behavior:'auto'` 瞬时兜底；真机 smooth 正常时兜底不触发。
2. **程序化滚动不派发 scroll 事件**：探针确认 scrollLeft 变化后 scroll 事件计数为 0
   （真机浏览器按规范必派发）。处置：`scrollToCol` 在 350ms 兜底点与 900ms 动画结束点
   主动调用 `markActiveDot` 校准高亮；scroll/resize 事件监听保留（scroll 事件本身已按帧
   合并，不再套 rAF——该内核 rAF 也被节流）。
