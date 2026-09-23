# 测试用例 — BUG-20260923-002 文档编写的审查界面预览不支持图片和 mermaid 或 plantuml，需要补齐

测试文件：`scripts/tests/bug-20260923-002.test.mjs`（分层：L1 供应商与接线 / L2 纯函数 / L3 enhance 增强层（假 DOM + 桩 mermaid）/ L4 四宿主接入 / L5 样式 / L6 i18n）。跑法：`node scripts/tests/bug-20260923-002.test.mjs`。

## L1 供应商与静态接线

- **L1-1 mermaid vendor 产物**：`scripts/web/mermaid.min.js` 存在，含官方构建标记 `globalThis["mermaid"]` 与版本串 `version:"11.17.2"`（IIFE 全局暴露），体积 > 1MB（完整 bundle 非裁剪残片）；条目目录 `licenses.md` 含 mermaid 11.17.2 行与 MIT。
- **L1-2 懒加载而非静态引入**：`index.html` 不新增 mermaid 静态 `<script>`（页面常规加载不背 3.5MB）；`md-rich.js` 以动态注入方式引用 `/mermaid.min.js`；`index.html` 在宿主脚本前引入 `/md-rich.js`。

## L2 纯函数（relFrom 相对路径拼接）

- **L2-1**：基为空串 → `./x` / `x` 归一为 `x`；基 `docs` + `../img/a.png` → `img/a.png`（轻归一）；`../` 越出基层数时原样保留（`../x` 交给端点拒绝，不在前端吞掉）；基尾斜杠 / `./` 前缀组合正确。

## L3 enhance 增强层（假 DOM + 桩 mermaid / 桩 i18n）

- **L3-1 图片改写**：相对 src 经 `imgBase` 改写为端点 URL（`loading=lazy` + `data-md-rich` 标记）；`http(s):` / `data:` 协议、`/` 根相对、`#` 锚点一律不动；未提供 `imgBase` 时相对 src 不改写但仍挂错误占位。
- **L3-2 图片失败占位**：img 触发 `error` → 原地替换为占位 `<p>`（含原路径 / URL 文本），不残留裂图；占位文案经 `ATBI18N.t()` 现算（data-i18n-skip 子树内也可译）。
- **L3-3 mermaid 渲染**：`pre>code.language-mermaid`（含大写围栏）被替换为 `.md-mermaid` 待渲染容器（先含「正在渲染」占位、`data-pending`、`data-i18n-skip`）；桩 mermaid `render` 成功 → SVG 注入、`data-pending` 移除；`initialize` 以 `securityLevel:'strict'` + `startOnLoad:false` 调用。
- **L3-4 mermaid 失败回退**：桩 `render` 抛错 → 回退 `.md-diagram-fallback`（可见错误提示 + `<pre><code>` 源码），不抛出到调用方；`window.mermaid` 缺失（库加载失败）同口径回退。
- **L3-5 plantuml 降级**：`pre>code.language-plantuml` → 降级提示 + 源码块（有提示、非裸源码），源码完整保留。
- **L3-6 幂等与缓存回填**：已渲染 SVG 容器再次 enhance 不重跑；`data-pending` 待渲染容器再次 enhance 重跑（覆盖 docCache 回填「渲染中」占位）；回退源码块 `pre[data-md-keep]` 不被二次包裹。
- **L3-7 健壮性**：容器缺失 / `querySelectorAll` 不可用 / 普通 `pre>code.language-js` 均不报错、不影响。

## L4 四宿主接入（源码契约，regex 于各文件）

- **L4-1 build.js 审查对话框**：`bindCommon` 在 `bindReviewSyncScroll(reviewWrap)` 同区调用 `ATBMdRich` 增强 `.bld-review-preview`，图片锚点 `/api/fs/raw?path=…&project=<state.project>`（发布文档在被管理项目根）。
- **L4-2 app.js File Board**：`openFile` md 渲染视图调用增强，锚点按 md 文件所在目录解析（relFrom）。
- **L4-3 app.js 条目文档**：`loadDoc` 与页签缓存回填两处调用增强（attachments 仍走 linkupDocImages，不被替代）。
- **L4-4 req-disc.js / oncall.js**：阅读器富文本块、纪要、讨论详情渲染后调用增强（无图片锚点改写，仅图表 + 失败占位）。
- **L4-5 renderMd 零改动**：四处 `renderMd` / `sanitizeHtml` 逐字同口径保持（消毒 / 回退契约不变，REQ-20260921-011 测试仍绿）。

## L5 样式（style.css 源码契约）

- **L5-1 图片宽度约束**：`.md img, .rd-rich img, .bld-review-preview img` 有 `max-width:100%`（超宽图不撑破栏布局；`.file-md img` 先例保留）。
- **L5-2 图表容器样式**：`.md-mermaid`（SVG `max-width:100%` / 横向滚动兜底）与 `.md-diagram-fallback` 样式存在。

## L6 i18n（中英同步，BUG-20260912-001 基线）

- **L6-1**：新增静态词条（渲染中 / 库加载失败 / plantuml 降级说明）中英齐备、`t()` 往返不变形；动态词条（图片失败占位两条、渲染失败含原因）以 ◇ 插值命中 EN_DYNAMIC 并正确回译。

## 验收对照

README 验收清单 1-6 逐项由 L1-L6 覆盖：仓库图片显示（L3-1 + L4-1）、mermaid 渲染 / plantuml 明确降级（L3-3/4/5）、坏图坏语法不白屏（L3-2/4）、宽度约束（L5-1）、安全口径不放宽（服务端零改动 + L1-2 不新增静态入口）、四宿主与消毒回归（L4-* + 全量 npm test）。
