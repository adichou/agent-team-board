# 设计 — REQ-20260906-004 File Board 文件详情栏过窄：支持拖拽分隔条调宽并记忆

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`scripts/web` 的文件视图（`#fileView`）是左右两栏：`#fileTree` 固定 `width:300px`，`#fileViewer` `flex:1`，中间 `gap:14px` 不可调。窗口不够宽时详情栏过窄，长行代码折行/横向滚动。

## 方案

### 结构（三文件分工）

- **`web/splitter.js`（新增，纯逻辑 + 装配器）**：UMD 双通道模块——浏览器里挂 `window.ATBSplitter`（classic script，在 app.js 之前加载）；Node 测试里走 `module.exports` 直接 `require` 单测。不含任何对 `$`/state 的依赖。
  - 常量：`TREE_MIN=180`、`TREE_DEFAULT=300`、`TREE_MAX_RATIO=0.5`、`VIEWER_MIN=280`（详情栏保底可读宽）、`FILE_VIEW_GUTTER=130`（分栏容器左右留白+间距+分隔条的保守预算，取窄屏竖栏侧的更大值）、`STORAGE_KEY='atb.fileTreeWidth'`。
  - `treeMaxWidth(vw)`：`max(TREE_MIN, min(vw*ratio, vw - TREE_MIN - VIEWER_MIN - GUTTER))`——50% 上限与「详情栏保底」双约束取小者。
  - `clampTreeWidth(w, vw)`：夹到 `[TREE_MIN, treeMaxWidth(vw)]`。
  - `parseStoredWidth(raw, vw)`：解析 localStorage 值，非法/缺失返回 `null`（保持 CSS 默认 300），合法值夹取后返回。
  - `attach({splitter, getTreeWidth, getViewportWidth, onChange, onCommit, onReset})`：Pointer Events 拖拽装配——`pointerdown` 记起点并 `setPointerCapture`、加 `.dragging`/`body.splitting`；`pointermove` 实时 `onChange(clamp(起点宽+dx))`；`pointerup/pointercancel` 收尾并 `onCommit(最终宽)` 一次；`dblclick` 触发 `onReset`。
- **`web/app.js`（接线）**：`initFileBoard()` 首行调用 `initFileSplitter()`（幂等，dataset 防重复绑定）：
  - `applyTreeWidth(px)`：写 `#fileTree.style.width` 并同步 `aria-valuenow`；
  - `loadTreeWidth()`：`parseStoredWidth(localStorage…)` 非空才应用（无记录保持 300）；
  - `onCommit` → 写 localStorage；`onReset` → 应用 300 并写 localStorage；
  - `window resize` 时对已有内联宽度重夹取（窗口变窄后仍守约束）。
- **`web/index.html`**：`#fileTree` 与 `#fileViewer` 之间插入 `<div id="fileSplitter" role="separator" aria-orientation="vertical">`，并在 app.js 之前引 `splitter.js`。
- **`web/style.css`**：`.file-view` 的 `gap:14px → 4px`（4+6+4=14，视觉间距不变）；新增 `.file-splitter`（`width:6px; flex:none; cursor:col-resize; background:var(--border)`，hover `var(--viewrail-accent-soft)` 高亮，`.dragging` 用 `var(--viewrail-accent)` 加深），`body.splitting { user-select:none; cursor:col-resize }`。全部取主题变量，深浅色自动一致。

### 记忆策略

拖拽结束（pointerup）写一次 localStorage；双击重置为 300 时也写入（重置即记忆默认值）。Electron 壳与浏览器均走同一 localStorage，刷新/重开保持。

## 风险与边界

- **GUTTER 为保守常量**而非实时测量：桌面实际占用约 50px、窄屏竖栏侧约 94px，取 130 只会让详情保底更宽，不会溢出。
- **双击与两次提交的顺序**：dblclick 在第二次 pointerup 之后触发，重置覆盖提交值，最终为 300。
- **点击不拖**（无 move）：pointerup 提交的是原宽，写回同值无副作用。
- 既有 `rowHeightPx`、`openFile`、空态文案、F7/F11 契约均不触碰；`file-board.test.mjs` 做回归兜底。

## 实施记录（2026-09-06，Agent）

- 落地文件：`scripts/web/splitter.js`（新增，UMD：浏览器挂 `window.ATBSplitter`、Node 走 `module.exports` 供单测）；`index.html`（插 `#fileSplitter` + 先于 app.js 引入）；`style.css`（gap 14→4px、`.file-splitter`/hover/`.dragging`/`body.splitting`，全主题变量）；`app.js`（接线段 + `initFileBoard()` 首行幂等初始化 + resize 重夹取）。测试 `scripts/tests/file-splitter.test.mjs`（新增，S1–S7）。
- TDD：测试先跑红（MODULE_NOT_FOUND）→ 实现后 S1–S7 全绿 → 全量 `npm test` 22 个测试文件 0 失败。
- 相对方案的细节修正：
  - 拖拽位移按「起点宽 + 绝对位移」计算而非增量累计，避免逐帧取整漂移；
  - `attach` 的 `body` 由调用方显式传入（app.js 传 `document.body`），Node 端无 document 也可仿真拖拽；
  - 分隔条默认底色 `var(--border)` 常显可发现，hover `--viewrail-accent-soft`、拖拽中 `--viewrail-accent` 逐级加深；
  - `resize` 重夹取仅在文件视图激活且树宽已是内联值时执行。
- 内置浏览器实测（IAB，视口 1280×720，深色主题）：6px/col-resize/separator 语义 ✓；拖拽 300→440 实时生效、`aria-valuenow` 同步 ✓；刷新后保持 440 ✓；双击回 300 且写入 ✓；拖到 x=680 被夹在 640（=视口 50%）✓；hover 背景 rgba(129,140,248,.16)=深色 `--viewrail-accent-soft` ✓；空态文案保留 ✓。浅色主题视觉复核留人工（M1）。

### 追加修复（2026-09-06，用户反馈「文件树层级缩进太多」）

- 现象：Wunderbaum 每级缩进占位 `i.wb-indent` 与图标同宽（vendor 变量 `--wb-icon-outer-width: 20px`），深层文件名可读宽度被挤压。
- 修复（仅 style.css，不动 vendor）：以更高特异性选择器把 `i.wb-indent` 压到 **12px/级**；叶节点把 expander 兼作缩进占位（`i.wb-expander.wb-indent`），单独回补为图标宽，保证同级文件与目录标题对齐。
- 测试：`file-board.test.mjs` 新增 F13（先红后绿）；实测 20px→12px 后第 4 级标题 x 从 167→143（省 24px），叶/目录对齐 ✓，全量 npm test 22 文件 0 失败。
- 归属说明：该问题为 File Board 既有观感问题（非本需求引入），经用户确认后随当前仍开放的 REQ-20260906-004 一并修复并计入 S8/F13。
