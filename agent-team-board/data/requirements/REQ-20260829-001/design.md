# 设计 — REQ-20260829-001 看板页面自适应布局，铺满整个窗口

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板是纯静态前端（`scripts/web/index.html` + `style.css` + `app.js`），在 ZCode 内置浏览器面板里以任意面板尺寸渲染。当前 `.board` 是 `align-items: start` + `overflow: auto`：列高随内容收缩（min-height 200px），整页纵向滚动，视口下方留大片空白；窗口宽度变化时也没有降级策略。

## 方案

纯 CSS + 少量 DOM 结构调整，不引入依赖、不改数据与 API：

1. **铺满视口**：`body` 加 `overflow: hidden`（取消页面级滚动）；`.board` 改 `grid-template-rows: minmax(0, 1fr)` + `align-items: stretch`，让唯一一行四列整体拉伸到看板区高度（视口 − 顶栏）。
2. **列内滚动**：`.col` 改为 `flex column`，新增 `.col-cards` 卡片容器（`flex: 1; min-height: 0; overflow-y: auto`），列头固定可见；`app.js` 渲染时把卡片挂进该容器（拖拽事件仍绑在 `.col` 上，事件冒泡不受影响）；卡片间距由容器 `gap` 提供。
3. **宽度自适应 / 降级**：列宽 `minmax(220px, 1fr)`（4×220 + 3×14 gap + 2×18 padding ≈ 962px，满足"≥980px 四列无横向溢出"）；≤1020px 降为 2 列（`grid-auto-rows` + 容器纵向滚动），≤640px 降为 1 列。顶栏不换行（路径超长省略），抽屉 `min(560px, 92vw)`、弹窗 `min(480px, 92vw)` 原样保留。
4. **测试**：项目零依赖，无浏览器测试框架；用 `node:assert` 对 HTML/CSS 做**布局契约测试**（`scripts/tests/layout.test.mjs`：视口 meta、铺满与滚动模型、列内滚动结构、断点降级、弹层 vw 上限等静态断言），再以内置浏览器多尺寸（1280/900/480 宽）截图人工核验。

## 影响面

`scripts/web/style.css`（主要）、`scripts/web/index.html`（无改动，已带 viewport meta）、`scripts/web/app.js`（仅 renderBoard 增加 `.col-cards` 容器）；server 与数据层不动。

## 风险与边界

- CSS 静态断言只能约束"写下的规则"，真实渲染表现靠浏览器多尺寸截图核验兜底。
- 窄窗口 2 列模式允许看板区纵向滚动（验收允许降级）；1 列模式同理。
- 旧版已安装的插件缓存不会自动更新，需在 Plugin Management 里更新后 `/board` 才用上新布局。
