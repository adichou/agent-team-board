# BUG-20260830-002 File Board 文件树与深色主题割裂且缺图标/展开箭头

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260830-002
- 创建：2026-08-30T05:05:14.984Z

## 现象

File Board（文件视图）左侧文件树（Wunderbaum 渲染）与整体界面割裂，具体表现：

1. **亮色树 + 深色应用**：树面板是白底深字（Wunderbaum 默认主题只适配浅色），深色模式下像贴了一块白补丁；
2. **图标全部缺失**：`iconMap` 默认 `bootstrap`，但 Bootstrap 图标字体从未加载——文件夹/文件图标（`bi-folder` / `bi-file-earmark`）与展开箭头（`bi-chevron-right` / `bi-chevron-down`）全部不渲染，折叠的目录无法一眼分辨是不是目录；
3. **行高松散**（默认 22px 无内边距节奏）、**选中态对比弱**（默认浅蓝底在深色下突兀，且带竖向 focus 边条）；
4. 长文件名无省略号截断。

## 复现步骤

1. 打开 Status Board 文件视图（`http://127.0.0.1:7736/?view=files`，系统外观为深色）；
2. 观察左侧树：白底、无图标、无箭头；点击行选中后高亮突兀。

## 期望行为（验收标准）

- [x] 树面板跟随应用深/浅主题（文字、背景、悬停、选中全部取自全局 CSS 变量）
- [x] 展开箭头与文件夹/文件图标可见（文件夹琥珀色、文件灰色），不引入图标字体或新依赖
- [x] 行高 26px、行圆角、长文件名省略号截断
- [x] 选中态为主题蓝半透明（明暗主题均协调），去掉默认竖向 focus 边条
- [x] 点击文件夹切换展开、点击文件打开并高亮（顺带补上 REQ-20260830-002 遗留的 F9 末段目验）
- [x] 深色 / 浅色模式下均正常

## 根因分析

1. Wunderbaum 主题完全由 `--wb-*` CSS 变量驱动且只有亮色一组值；`wunderbaum.css` 直接 vendor 后未做任何覆盖（REQ-20260830-002 引入时只接了功能没做主题适配）；
2. `iconMap` 默认值 `"bootstrap"` 依赖 Bootstrap Icons 字体，vendor 模式下没人加载该字体 → 图标类名（`bi-*`）无字形可渲染；
3. 本版 Wunderbaum 以 `node.type === 'folder'` 标识目录，`node.folder` 属性不保证存在——activate 处理器误用 `n.folder` 导致点击目录走了「打开文件」分支（次要缺陷，一并修复）。

修复方式（`scripts/web/style.css` + `app.js`，零新依赖）：

- 覆盖 `--wb-*` 变量映射到全局双主题变量（含 hover/active/斑马纹禁用/focus 边条透明）；
- 用 CSS `mask` + `background-color` 渲染箭头与图标（chevron/folder/file 三个内联 SVG，随主题变色；展开态旋转 90°）；
- `--wb-row-outer-height: 26px` 且 JS `rowHeightPx: 26` 同步（虚拟行定位依赖）；
- `.wb-title` 省略号；目录判断改 `n.type === 'folder'`。
- 契约测试：`file-board.test.mjs` 新增 F10/F11（主题变量覆盖、mask 图标、rowHeightPx 同步、type 判断）。

## 关联

- 引入来源：REQ-20260830-002（File Board 引入 Wunderbaum 文件树时未做主题适配、未加载图标字体）
- 相关：BUG-20260830-001（同为 REQ-20260830-002 引入的视觉缺陷，已修复待确认）

## 修订记录

- **2026-08-30 人工反馈「文件夹图标还是奇怪」**：首版 mask 只覆盖了 `bi-folder`/`bi-folder-symlink`，
  而本版 Wunderbaum iconMap 实际使用 **`bi-folder2`（折叠）/ `bi-folder2-open`（展开）**——展开目录落到
  通用 `.wb-icon` 规则只剩背景色，渲染成灰色方块。已补 `bi-folder2`（闭合文件夹）与 `bi-folder2-open`
  （开口文件夹）两个 mask，展开/折叠态图标形状可区分；F11 断言同步收紧。已浏览器实测确认无灰色方块残留。
