# 设计 — REQ-20260906-021 文件模块支持文件切换自动换行模式

> 由实施 worker 补充（批次 batch-20260907-003 / run-20260907-022）。

## 背景

File Board 源码视图（`scripts/web/app.js` 的 `buildCodeView`）为「行号槽 +
语法高亮 pre」两栏 flex 布局，`pre` 不换行、水平滚动、行号槽 sticky。长行
文件阅读需反复横拖；需要软换行开关，且设置跨文件保持（同 md 的
`state.banner.mdSource` 记忆模式）。

## 方案

纯前端改动（`scripts/web/app.js` + `scripts/web/style.css`），无 API/数据变更：

1. **状态**：`newBannerState()` 增加 `wrap: false`（默认不换行，与现状一致）。
   状态挂在 `state.banner` 上，随项目切换重置（既有语义），天然满足
   「切换文件后保持、切项目/刷新重置」。
2. **工具条**：`viewerBarHtml(key, { isMd, mdSource, wrap })`——仅当调用方
   传入 `wrap`（boolean；openFile 的源码视图调用点一处，同时服务非 md 文件
   与 md 源码态）时渲染「自动换行 / 不换行」按钮（`data-wrap-toggle`、
   `aria-pressed`、选中态 class）；渲染态 md 与图片分支不传该字段，按钮
   不出现。按钮文案显示目标态，与 md 切换按钮惯例一致。
3. **打开文件**：`openFile` 在两处源码视图调用点把 `state.banner.wrap`
   传入 `viewerBarHtml` 与 `buildCodeView(key, content, ext, wrap)`；
   `buildCodeView` 据此给 `.file-code` 容器加 `wrap` class。
4. **切换交互**：`bindFileViewerOnce` 的 `#fileViewer` 事件委托新增
   `data-wrap-toggle` 分支：翻转 `state.banner.wrap` 后按当前
   `activeFile` 重开文件（与 md 切换同模式，重建查看器）。
5. **CSS**（`.file-code.wrap`）：
   - `pre { white-space: pre-wrap; overflow-wrap: anywhere; }` —— anywhere
     允许超长无空格串（URL/长 JSON 键）也断行；
   - `.code-lns { display: none; }` —— 软换行下两栏行号无法保持 1:1
     对齐，开启时整体隐藏行号槽，关闭即恢复（README 已记录该取舍）。
6. **按钮选中态**：新增 `.file-viewer-acts .btn[aria-pressed="true"]`，
     取主题色（`color-mix` + `--primary`，与 `.fchip.active` 同手法）。

影响面：仅文件视图查看器；目录横幅、需求看板、抽屉不受影响。无后端与
存储改动，不涉及构建。

## 风险与边界

- **行号隐藏的取舍**：换行态失去「路径:行号」复制入口——已作为设计决策
  写入 README 验收标准；关闭换行立即恢复。
- **超长行性能**：软换行由浏览器排版，与现状（单行超宽）渲染成本同量级；
  文本仍受服务端 1MB 上限约束。
- **hljs 高亮不受影响**：换行是纯 CSS（white-space），不改动代码节点结构。
- 刷新/切项目回到默认不换行（不写 localStorage，避免与横幅状态的
  「按项目隔离、刷新重载」语义冲突）。

## 实施记录

- TDD 载体：`scripts/tests/file-board.test.mjs` 新增 W1–W4（结构/CSS 契约
  + 回归），先红后绿；详见 test-cases.md 与 test-report.md。
