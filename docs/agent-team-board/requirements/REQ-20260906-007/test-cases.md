# 测试用例 — REQ-20260906-007 文件看板的目录树要改成横幅呈现，参考 codex 的文件右侧面板

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | banner.js 层栈状态机：openLayer 追加新层；重复打开已在栈中的目录时截断到该层（含）；truncateTo 面包屑回跳截断 | 高 | 通过 |
| B2 | banner.js 面包屑派生：crumbOf 从层栈产出逐段路径，首段为根（path=''）；DEFAULT_PATH 为 docs/agent-team-board | 高 | 通过 |
| B3 | 结构契约：index.html 含 #fileBanner/#fileCrumb/#bannerStack/#fileViewer，不含 #fileTree/#fileSplitter，不再加载 wunderbaum.umd.min.js/wunderbaum.css/splitter.js，banner.js 先于 app.js | 高 | 通过 |
| B4 | 退役守卫：app.js 不再实例化 Wunderbaum（无 mar10.Wunderbaum），不再引用 fileTree/fileSplitter/ATBSplitter/initFileSplitter | 高 | 通过 |
| B5 | 接线契约：app.js 用 ATBBanner 状态机渲染横幅（openLayer/truncateTo/crumbOf/DEFAULT_PATH），chip 点击经事件委托分发目录/文件两类动作，新层 scrollIntoView 滚入视野 | 高 | 通过 |
| B6 | CSS 契约：.file-view 纵向布局；.banner-row 横向滚动（overflow-x:auto）；.banner-stack 限高纵向滚动；.fchip 配色取主题变量且 .active 取主题色半透明；chip 图标为 mask 矢量 | 中 | 通过 |
| B7 | a11y 契约：面包屑为 nav 且带 aria-label；chip 为 button 元素带可读名称；条带容器有可读标签 | 中 | 通过（并入 B3/B5 断言：nav[aria-label]、button.fchip[aria-label]、.banner-row[role=group][aria-label]） |
| B8 | 回归：F1–F6、F12（滚动条主题）等文件看板既有用例不回退；file-splitter S1–S4（splitter.js 纯函数）保留通过、S5–S7 改退役守卫；全量 npm test 通过 | 高 | 通过（43 个测试文件失败 0） |

补充说明（随本需求的测试演进）：

- file-board.test.mjs：F7 改写为横幅结构契约（并入 B3/B4）；F10/F11/F13 为旧树
  专属 CSS 契约，随树退役删除；F1–F6（/api/fs 服务行为）、F12（滚动条主题）不受影响。
- file-splitter.test.mjs：S1–S4 测 splitter.js 纯函数（文件保留），继续有效；
  S5–S7 原「树/分隔条接线」契约改写为退役守卫（不再被 index.html/app.js 引用）。
