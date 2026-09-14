# 设计 — REQ-20260908-005 详情页面高度不要超过列表，要低于状态筛选行

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260907-004 布局重构后，需求模块宽屏（>1020px）为「列表 + 详情并排」：`.req-split` 网格
`align-items: stretch`，列表栏与详情栏等高，详情不会超过列表。窄屏（≤1020px）详情退化为覆盖式
抽屉：`@media (max-width: 1020px)` 内 `.req-split > .drawer` 为 `position: fixed;
top: 0; right: 0; bottom: 0`，即全视口高度——比工作区（列表区）高，盖住第一行顶栏、第二行模块
导航、第三行副标题/搜索、第四行需求状态筛选条；配套遮罩 `#mask` 同为 fixed 全视口，状态筛选行
被压暗且点击被拦截。桌面端内置浏览器面板宽度通常 ≤1020px，是该形态的主要使用场景。

## 方案

页面骨架是 `body { height: 100%; overflow: hidden; flex column }`，四行头部均为 `flex: none`，
`#reqView`（`.req-view`）`flex: 1; min-height: 0` 恰好是「状态筛选行之下的列表工作区」。
因此把窄屏覆盖层的定位基准从视口换成工作区即可，一行 JS 都不用改：

1. `.req-view` 增加 `position: relative`，作为窄屏覆盖层的定位基准。
2. `@media (max-width: 1020px)` 内 `.req-split > .drawer` 由 `fixed` 改为 `absolute`
   （`top/right/bottom: 0` 保留，宽度 `min(560px, 92vw)` 保留）：顶边 = 工作区顶
   = 状态筛选行下沿，底边 = 工作区底 = 视口底，高度与列表区一致，不再超过列表。
   `.req-view` 的 `overflow: hidden` 同时裁掉 `translateX(100%)` 收起时的溢出。
3. 遮罩同域：`index.html` 把 `<div id="mask">` 从 body 级移入 `<main id="reqView">` 内
   （该遮罩仅服务需求详情抽屉，`#oncallMask` 不动），窄屏媒体块内 `#mask` 改
   `position: absolute; inset: 0`——状态筛选行及其以上保持原亮度且可点击（点击筛选 chip
   切档，详情不关）；点击工作区内抽屉外的露出的窄条仍关闭详情。
4. 宽屏不受影响：`.req-split > .drawer` 仍是 `position: static` 常驻右栏，遮罩在宽屏本就
   `hidden`（`drawerOverlayMode()` 为 false）。

- 影响面：`scripts/web/style.css`（`.req-view`、≤1020px 媒体块、新增 `#mask` 覆盖）、
  `scripts/web/index.html`（`#mask` 移位）；`app.js` 零改动（`drawerOverlayMode` /
  `has-item` 滑入 / 返回按钮逻辑均不动）。
- 契约测试：新增 `scripts/tests/drawer-height.test.mjs`（静态断言 html/css，模式同
  workbench-layout / drawer-actions-row 测试）。

## 风险与边界

- 讨论（oncall）模块的详情抽屉 `#oncallDrawer` 仍是 fixed 全视口覆盖——它是「讨论单详情」，
  与本条「详情页面」（需求详情，同 REQ-20260908-006 指向）不同；如需同样规则应另行登记。
- `#mask` 依赖 `#reqView` 可见（切走模块时 `setView` 会先 `closeDrawer()` 收起遮罩），
  现有 Esc / 点遮罩关闭路径不受影响。
- 视觉多尺寸核验按 test-cases.md 人工用例执行（与既有布局类需求一致）。

## 实施记录

- 2026-09-08（zcode-batch-013-1）：按上述方案实施；新增 drawer-height.test.mjs（D1–D5）。
