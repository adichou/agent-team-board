# 测试用例 — REQ-20260829-001 看板页面自适应布局，铺满整个窗口

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> T1–T9 由 `scripts/tests/layout.test.mjs`（node:assert 静态契约）覆盖；T10 为内置浏览器多尺寸人工核验。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | index.html 含 viewport meta（自适应前提） | P0 | ✓ |
| T2 | `html, body` 高度 100%（纵向铺满基础） | P0 | ✓ |
| T3 | body `overflow: hidden`：任何尺寸无页面级滚动条 | P0 | ✓ |
| T4 | `.board` 为 stretch + 单行 `minmax(0,1fr)`：四列背景拉伸铺满看板区 | P0 | ✓ |
| T5 | `.col` flex column；存在 `.col-cards`（flex:1、min-height:0、overflow-y:auto）实现列内滚动、列头常驻 | P0 | ✓ |
| T6 | 列宽 `minmax(220px, 1fr)`：四列最小占宽 ≈962px < 980px | P0 | ✓ |
| T7 | ≤1020px 断点降为 2 列；≤640px 断点降为 1 列（行数重置，四行均分） | P1 | ✓ |
| T8 | 顶栏不换行且路径超长省略（.path nowrap+ellipsis） | P1 | ✓ |
| T9 | 抽屉/弹窗宽度带 vw 上限（min(560px,92vw) / min(480px,92vw)），窄窗不溢出 | P1 | ✓ |
| T10 | 浏览器实测：1280×800 四列铺满无页面滚动；900×700 两列两行铺满（实测行高 290×2、无滚动条）；480×700 单列四行、抽屉 441px 不溢出、点击/弹窗可用 | P0 | ✓ |

## 执行记录（2026-08-30）

- T1–T9：`node scripts/tests/layout.test.mjs` 全绿（先红后绿，红 6 项）。
- T10：内置浏览器实测通过；过程中发现并修复两个缺陷：
  1. 轮询变更检测包含每次变化的 `generatedAt`，导致每 2 秒全量重渲染、点击随机失效（app.js poll 排除易变字段）；
  2. 640px 单列断点未重置行数，第 3/4 状态列被 `overflow: hidden` 裁剪不可见不可点（补 `grid-template-rows: none; grid-auto-rows: minmax(0,1fr)`，T7 断言同步加强）。
- 另：server 静态资源增加 `Cache-Control: no-store`，避免浏览器缓存旧样式造成"改了不生效"。
