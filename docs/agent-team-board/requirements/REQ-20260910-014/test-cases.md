# 测试用例 — REQ-20260910-014 管理项目和新建按钮采用和全局按钮一样的侧拉面板

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/side-entry-panel-20260910-014.test.mjs`（零依赖静态契约断言，
> 沿用 global-entry-panel-20260910-004.test.mjs 契约风格；浏览器焦点 / 连续点击 / 窄屏按验收标准人工核对）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| V1 | 入口语义：顶栏「管理项目」与「＋ 新建」均为 `type="button"`、`aria-haspopup="dialog"`、初始 `aria-expanded="false"`，并分别经 `aria-controls` 指向 `#projModalWrap` / `#modalWrap`（对齐全局按钮既有写法） | P0 | 通过 |
| V2 | 新建面板结构：`#modalWrap` 不再是 `.modal-wrap` 全屏遮罩，改为右侧面板（`role="dialog"`、hidden 初始隐藏）；头部常驻（标题「新建条目」+ 一句说明 + ✕ 关闭按钮在内容区之前）；表单字段与顺序不变（类型 / 标题 / 描述 / 截图区块 / 取消·创建 `.modal-foot`） | P0 | 通过 |
| V3 | 管理项目面板结构：`#projModalWrap` 同为右侧面板；头部常驻（标题「项目管理」+ 说明 + ✕）；内容区依次含操作表单（projMode / projPath / projTarget / projSubmit）、projNotice、检测栏（projScanSummary / projScanBtn / projRemoveMissingBtn）、projList、批量与单项移出确认区，分区与顺序不变 | P0 | 通过 |
| V4 | 样式形态：`.side-panel` 贴屏幕右缘通高（`top/right/bottom:0`）、`width: min(560px,92vw)`、`z-index:25`、左侧描边 + 向左投影、纵向弹性布局；头部 `flex:none` 不被压缩、内容区 `flex:1` + `min-height:0` + `overflow-y:auto` 独立滚动；窄屏（≤640px）宽 `100vw` 且无左描边（与全局面板同一断点） | P0 | 通过 |
| V5 | 开合行为：`openModal` / `openProjPanel` 重复打开幂等守卫（不叠加面板）；打开移除 `hidden` 并同步入口 `aria-expanded="true"`，焦点进入面板（新建 → `#fTitle`、管理项目 → `#projPath`）；`closeModal` / `closeProjPanel` 恢复 `hidden`、同步 `aria-expanded="false"` 并把焦点返回各自入口（管理项目记录 opener，入口已移除时回落 `#btnProjManage`） | P0 | 通过 |
| V6 | Esc 关闭链顺序不变：管理项目面板 → 新建面板 → 全局面板 → 详情抽屉（一次只关一层）；两面板纳入 `anyModalOpen` 弹窗让位判定 | P0 | 通过 |
| V7 | 遮罩形态取消：`#modalWrap` 不再挂「点击遮罩空白关闭」监听（对齐全局面板：仅 ✕ / Esc / 取消关闭）；`.modal-wrap` 全屏遮罩样式不再用于这两个入口（保留给快捷键帮助等仍居中的弹窗） | P1 | 通过 |
| V8 | 表单功能保留：新建的 `#fType` / `#fTitle` / `#fDesc` / `#fShotRow`（pick / file / list / count / empty / error）与 `#modalCancel` / `#fSubmit` 全部保留；`#btnOpenProjManage`（空态卡入口）仍指向 `openProjPanel`；顶栏 `#btnNew` / `#btnProjManage` 接线不变 | P0 | 通过 |
| V9 | 深浅色：面板背景 / 描边全部走 CSS 变量（`var(--bg)` / `var(--border)` 等），无硬编码色值 | P1 | 通过 |
