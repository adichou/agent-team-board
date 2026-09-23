# 设计 — BUG-20260923-002 文档编写的审查界面预览不支持图片和 mermaid 或 plantuml，需要补齐

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260921-011（预览态富文本容器 `.bld-review-preview` 与 `renderMd` 引入，当时仅覆盖标准 Markdown 语法子集；编号经 `atb list` 核验真实存在）

## 根因分析

三个独立缺口，均落在「预览态只做标准 Markdown → HTML，没有富媒体增强层」：

1. **仓库内相对路径图片 404**：`renderMd` 输出的 `<img src="image/README/….png">` 按 SPA 页面 URL（恒为 `/`）解析到 `http://127.0.0.1:8888/image/…`；而 server.mjs `serveFile` 只静态服务前端资源目录 `webRoot = scripts/web`（server.mjs:65、417-430），被管理项目根下的业务图片不在静态目录 → 404 裂图。看板已有 `/api/fs/raw?path=…` 图片白名单端点（server.mjs:507-511：图片 MIME 白名单 + 8MB 上限 + 收敛 CSP），但预览渲染层不感知、不做相对路径改写（对比先例：app.js `linkupDocImages` 对条目文档 `attachments/` 截图、File Board `openFile` 对图片文件本身均做了端点接管）。
2. **图片宽度无约束**：`.md`（style.css:745 起）与 `.bld-review-preview`（style.css:3889 起）均无 `img` 规则（对比 File Board `.file-md img` 有 `max-width:100%`，style.css:1434），外链大图撑破栏布局。
3. **图表不渲染**：前端零图表渲染库（`scripts/web/` 仅有 marked / highlight.js / gitgraph / wunderbaum），```` ```mermaid ```` / ```` ```plantuml ```` 围栏经 marked 只输出 `<pre><code class="language-mermaid">` 源码块。

外链 `http(s)` 图片经查无阻拦（主页面响应无 CSP 头——server.mjs `serveFile` 只设 Content-Type / Cache-Control；`sanitizeHtml` 只剥 `<script>` 与 `on*`，不剥 `img`），可正常加载，README 待确认 3 就此落定；仅失败时需给占位提示。

## 方案

### 总体思路：渲染后增强层（renderMd 零改动）

`renderMd` / `sanitizeHtml` 四处逐字同口径实现**保持不动**（消毒口径、既有 REQ-20260921-011 测试契约零回归），图片改写与图表渲染做成**DOM 渲染后增强**——与仓库既有先例 `linkupDocImages`（REQ-20260909-009，DOM 后置接管条目文档截图）同构。新增共享前端模块 `scripts/web/md-rich.js`（浏览器挂 `window.ATBMdRich`，Node 可 ESM 导入供测试，模式对齐 i18n.js），提供：

- `enhance(container, opts)`：对渲染完成的富文本容器做一遍增强：
  - **图片**：遍历 `img`——相对 src（无协议、不以 `/` `#` 开头）且调用方给了 `opts.imgBase(raw) → url` 时改写 `src`（`loading=lazy`）；所有增强图片挂 `error` 处理，加载失败就地替换为可见占位（含原路径 / URL 与原因提示），不渲染裸裂图。已处理节点打 `data-md-rich` 标记幂等。
  - **mermaid**：`pre > code.language-mermaid`（大小写不敏感）→ 替换为待渲染容器（含「正在渲染」占位），懒加载 vendored mermaid 后 `mermaid.render` 出 SVG 插入；图容器 `data-i18n-skip`（图表文字是文档本体，不进界面词典）；主题随 `prefers-color-scheme` 深浅色（dark/default），系统外观切换时对已渲染图重绘。渲染失败（语法错误）或库加载失败 → 回退源码块 + 可见错误提示条（对齐 `renderMd` 现有异常回退口径：不白屏不崩溃）。
  - **plantuml**：`pre > code.language-plantuml` → **明确降级提示 + 源码块**（非裸源码）：本地渲染需 Java 或非官方 WASM 移植，与「本地优先 · 无外部依赖」原则冲突的 plantuml.com 在线渲染 README 已要求单独确认、本单不接——按 README 待确认 2 列出的可选项「首期仅支持 mermaid、plantuml 给明确降级提示」落定；后续如确认在线方案再另行条目扩展。
  - **幂等与缓存回填**：`.md-mermaid[data-pending]` 待渲染容器在再次 enhance 时重跑（覆盖 app.js 条目文档 docCache 回填缓存了「渲染中」占位的场景）；回退源码块 `pre` 打 `data-md-keep` 不再被二次包裹；已渲染完成的 SVG 不动。
- `relFrom(base, raw)`：相对路径拼接纯函数（`./` 归一、空基直传、`../` 原样交给端点拒绝），供各宿主计算图片锚点，测试直测。

mermaid **懒加载**：首遇图表才动态注入 `<script src="/mermaid.min.js">`（主页面无 CSP，动态同源脚本可行），页面常规加载不背 3.5MB 库；注入失败 / 超时按「库加载失败」降级为源码 + 提示。

### 四处 renderMd 宿主统一接入（README 待确认 1 按「建议一并」落定，锚点语义各宿主明确）

| 宿主 | 接入点 | 图片改写锚点 |
| ---- | ---- | ---- |
| build.js 审查对话框（本单主诉求） | `bindCommon` 内 `bindReviewSyncScroll(reviewWrap)` 后，对每个 `.bld-review-preview.md` enhance | 发布文档位于被管理项目根 → `/api/fs/raw?path=<相对路径>&project=<当前项目>`（白名单 + 8MB + CSP 口径原样） |
| app.js File Board md 渲染视图（`openFile`） | `div.innerHTML = renderMd(...)` 后 enhance | 相对当前 md 文件所在目录解析（`relFrom(dirname(key), raw)` → `/api/fs/raw`） |
| app.js 条目文档抽屉（`loadDoc` + 页签缓存回填） | 渲染 / 回填后 enhance | `attachments/` 截图仍走既有 `linkupDocImages`（灯箱放大保留）；其余相对路径无端点语义、不改写，失败给占位 |
| req-disc.js（阅读器富文本块 + 纪要）、oncall.js（讨论详情） | innerHTML 后 enhance | AI 生成文本无仓库锚点，不改写；mermaid 渲染 + 图片失败占位同口径 |

### 界面细节

- CSS：`.md img, .rd-rich img, .bld-review-preview img { max-width:100%; border-radius:8px; }`（对齐 `.file-md img` 先例）；`.md-mermaid`（横向滚动兜底 + SVG `max-width:100%`）、`.md-diagram-fallback`（提示条 + 源码块）、`.md-img-fallback`（图片失败占位）样式，颜色走 CSS 变量深浅色自适配。
- i18n（BUG-20260912-001 基线）：新增提示文案中英同步——图片失败占位（仓库内 / 外链两条动态插值）、mermaid 渲染中 / 渲染失败 / 库加载失败、plantuml 降级说明。增强层插入文案时经 `ATBI18N.t()` 现算（审查对话框富文本容器整体 `data-i18n-skip`，MutationObserver 不会接住其内部新增节点，须插入时自译）。
- 服务端**零改动**：不放宽 `/api/fs/raw` 白名单 / 8MB / CSP，不新增任意文件读取入口；越权（`../`）、白名单外格式、超限、不存在一律由端点拒绝 → 前端占位提示（README 待确认 4 就此落定为单一占位文案口径）。

**开源选型（REQ-20260909-015）**：图表渲染选用 [mermaid](https://github.com/mermaid-js/mermaid) v11.17.2（MIT，白名单内），vendor 官方 npm 包 `dist/mermaid.min.js` IIFE 构建产物（3,572,661 字节，全局暴露 `globalThis.mermaid`）到 `scripts/web/mermaid.min.js`——vendor 例外理由与 REQ-20260921-002 gitgraph 相同：本产品 Web 前端为零构建链（无 npm 打包，第三方库以 vendor UMD/IIFE bundle 放 `scripts/web/` 直接引用为既有先例：marked、highlight.js、gitgraph），无法以 npm 依赖方式引入该浏览器渲染库；仅复制官方构建产物单文件，不复制源码。详见本条目 [licenses.md](./licenses.md)。plantuml 无满足「本地优先 + License 白名单 + 有包分发」的本地渲染库（官方为 Java 实现），首期不引入（自研理由：无合适库）。

## 风险与边界

- **mermaid 体积**（3.5MB vendor）：懒加载隔离——不打开任何含图表的预览则零成本；本地服务无网络往返，首次渲染加载可接受。
- **安全**：mermaid `securityLevel:'strict'`（转义标签文字）+ 输入本身已经过 `sanitizeHtml`；SVG 容器 `data-i18n-skip` 防界面词典误改图表文字；`/api/fs/raw` 端点口径不变。mermaid 自身依赖（cytoscape/dagre-d3 等）已随官方 bundle 打包且均为 MIT 系许可（bundle 尾部许可注释保留）。
- **同步滚动**：图片 / 图表插入改变栏内容高度，`bindReviewSyncScroll` 按比例算法天然适配（滚动主体仍是 `.bld-review-preview` 容器）。
- **重渲染**：审查对话框每次 render 全量重建 DOM → enhance 重跑，图片重新请求（`/api/fs/raw` 为 no-store）；仅数据变化才重渲染（summaryPoll 无变化即返回），本地回环开销可接受。
- **回归面**：renderMd / sanitizeHtml / 审查对话框交互（页签 / 编辑预览切换 / 保存回退 / 通过审核 / 空文档占位 / data-i18n-skip 口径）不动；四宿主接入点均为渲染后追加调用，`window.ATBMdRich?.enhance` 可选链——模块缺失时静默跳过（对齐 gitgraph 加载失败降级先例）。
