# 测试用例 — REQ-20260906-005 需求单详细页面的关闭按钮要固定在单号右侧。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 详情头部模板：`#drawerClose` 渲染在 `.card-top` 单号行内、紧随 `.cid` 之后（「待确认」flag 之前） | P0 | ✅ 通过（detail-close-btn.test.mjs） |
| T2 | 旧布局移除：头部模板不再有 `justify-content:space-between` 包装层，`.drawer-head` CSS 改为纵向排布、标题独占一行 | P0 | ✅ 通过（detail-close-btn.test.mjs） |
| T3 | 关闭交互保留：`#drawerClose` click 绑定 `closeDrawer`，Escape 兜底关闭仍在 | P0 | ✅ 通过（detail-close-btn.test.mjs） |
| T4 | 样式：`.card-top` 行内 `✕` 不被压缩（flex:none）且尺寸适配单号行 | P1 | ✅ 通过（detail-close-btn.test.mjs） |
| B1 | 浏览器实测：打开详情抽屉后 `✕` 位于单号右侧同一行，标题独占下一行；关闭行为可用 | P1 | ✅ 通过（实测记录见 design.md 实施记录） |
