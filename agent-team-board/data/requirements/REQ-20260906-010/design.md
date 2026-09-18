# 设计 — REQ-20260906-010 文件栏支持 md、图片的渲染展示。并支持复制目录和行号到剪贴板以便在讨论对话框中讨论

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

文件视图（REQ-20260906-007 横幅布局）的 `openFile` 把一切文件按文本源码展示：
md 无渲染、图片被 `/api/fs/file` 的二进制检测拒绝、且没有复制「路径:行号」的
入口。抽屉已有 `renderMd`（marked + sanitizeHtml）与 `.md` 排版可直接复用。

## 方案

### 服务端：新增只读原始字节端点 `/api/fs/raw`（scripts/server.mjs）

- 复用 `resolveSafeFsPath`（防穿越、排除 node_modules/.git、点开头路径）。
- 仅放行图片后缀白名单：png/jpg/jpeg/gif/webp/svg/ico/bmp/avif，其余 400
  （该端点只为图片预览服务，不做通用文件下载）。
- 独立大小上限 `FS_RAW_MAX_BYTES = 8MB`（区别于文本预览的 1MB，截图常见超 1MB）。
- 响应头：`Content-Type` 按 MIME 映射（补齐 jpg/jpeg/gif/webp/bmp/avif）、
  `X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`
  （svg 直接在地址栏打开也不执行脚本）、`Cache-Control: no-store`（与静态资源一致）。

### 前端：openFile 分流（scripts/web/app.js）

- `IMAGE_EXT` 集合（同服务端白名单）→ 渲染 `<img class="file-image">`，
  `src` 走 `apiUrl('/api/fs/raw?path=…')`（带 project 参数），加载失败替换为错误提示。
- md（`md`/`markdown`）→ 默认渲染视图：`renderMd(content)` 装入 `.md` 容器
  （复用抽屉排版）；`state.banner.mdSource` 记录当前文件态，工具条按钮切换
  「源码 / 渲染」后按需重取内容重渲（同一 openFile 流程）。
- 其余文本 → 维持 hljs 源码视图，改为「行号槽 + pre」结构：
  `.file-code`（flex 容器）内左侧 `.code-lns`（每行一个 `<button class="ln" data-line>`），
  右侧原 `pre>code`；两栏显式同一 font-size/line-height、`white-space: pre`
  不换行，保证 1:1 对齐。
- 查看器工具条 `.file-viewer-bar`：相对路径文本 + 「复制路径」按钮；
  md 文件追加「源码 / 渲染」切换按钮。
- 复制行为：抽公共 `copyPlain(text)`（navigator.clipboard → execCommand 降级，
  与 copyId 同策略）；行号点击（#fileViewer 事件委托，绑定一次）复制
  `相对路径:行号`，成功后 toast「已复制 path:line」。

### 影响面

- `scripts/server.mjs`：`handleFsApi` 增一分支；MIME 表补图片类型。
- `scripts/web/app.js`：`openFile` 重构 + 新增 IMAGE_EXT/MD_EXT/copyPlain/委托绑定；
  既有 `initFileBoard`、横幅交互、hljs 高亮不动。
- `scripts/web/index.html`：查看器占位文案更新（提及图片/行号复制）。
- `scripts/web/style.css`：新增 `.file-viewer-bar` / `.code-lns` / `.ln` /
  `.file-image` 样式，均取主题变量。

## 风险与边界

- **XSS**：md 渲染沿用抽屉已上线的 sanitizeHtml 兜底；图片端点收 CSP + nosniff，
  且 svg 经 `<img>` 嵌入本就不执行脚本。
- **行号对齐**：源码视图强制不换行（水平滚动），行号与内容恒等行；行数特大时
  行号槽自身纵向滚动同步由同一滚动容器保证。
- **大小**：raw 8MB 上限防止误点巨型素材拖垮本地服务；超限仅提示不预览。
- 不改动 `/api/fs`、`/api/fs/file` 的既有契约（F1–F6 用例回归保护）。

## 实施记录（TDD）

- 测试先行：`scripts/tests/file-board.test.mjs` 新增 R1–R8（见 test-cases.md），
  首轮 R1–R5/R7/R8 跑红（raw 端点 404 / 结构契约缺失），实现后全绿。
- `scripts/server.mjs`：MIME 表补 jpg/jpeg/gif/webp/bmp/avif；`handleFsApi` 新增
  `/api/fs/raw` 分支（resolveSafeFsPath → 图片白名单 FS_RAW_IMAGE_MIME → 8MB 上限 →
  流式回写 + nosniff + `CSP: default-src 'none'` + no-store）。
- `scripts/web/app.js`：新增 IMAGE_EXT/MD_EXT、viewerBarHtml、buildCodeView、
  fileLineRef、copyPlain（clipboard → execCommand 降级）、bindFileViewerOnce
  （#fileViewer 委托：行号复制 `路径:行号`、复制路径、md 源码/渲染切换）；
  openFile 分流图片（img src=/api/fs/raw）→ md（默认 renderMd）→ 源码
  （行号槽 + hljs），并加 activeFile 竞态守卫；newBannerState 增 mdSource。
- `scripts/web/index.html`：查看器占位文案更新；`scripts/web/style.css`：新增
  .file-viewer-bar/.file-md/.file-image(-wrap)/.file-code/.code-lns/.ln 样式
  （行号与代码两栏显式同字体行高 12px/1.6，行号槽 sticky 随横向滚动保持可见）。
- 回归：`npm test` 43 个测试文件失败 0（含 file-board F1–F6/B 系列/R 系列）。

