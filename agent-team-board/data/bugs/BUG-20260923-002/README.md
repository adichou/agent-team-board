# BUG-20260923-002 文档编写的审查界面预览不支持图片和 mermaid 或 plantuml，需要补齐

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260921-011（预览态 Markdown 富文本渲染 `renderMd`，ID 经 atb list 核验）
- 创建：2026-09-23T11:04:29.702Z

## 现象

「文档编写」步「审查」对话框（`scripts/web/build.js` `renderReviewModal`，约 3331 行起）各文档栏默认「预览」态，由 `renderMd`（build.js:3316-3322）渲染：`sanitizeHtml(window.marked.parse(md))`——vendored marked v12.0.2（`scripts/web/marked.min.js`，`scripts/web/index.html:508` 全局加载）只做标准 Markdown → HTML。对照代码逐项核对，当前 dev 分支行为如下：

1. **仓库内相对路径图片裂图（404）**：如项目自身 `README.md:37` 的 `![1790092127929](image/README/1790092127929.png)`（文件真实存在于 `image/README/`）。marked 会把它渲染为 `<img src="image/README/….png">`，但看板是 SPA（页面路径恒为 `/`），相对 src 按页面 URL 解析为 `http://127.0.0.1:8888/image/README/….png`；而 server.mjs 静态服务 `serveFile` 只映射前端资源目录 `webRoot = scripts/web`（server.mjs:65、417-430），被管理项目根下的业务图片不在静态目录 → 404，预览中呈裂图（仅显示 alt 文本）。看板 File Board 已有 `/api/fs/raw?path=…` 图片白名单端点（server.mjs:507-511 图片 MIME 白名单、8MB 上限、收紧 CSP；app.js:1675 文件预览即用此端点），但 `renderMd` 不做相对路径改写。
2. **图片尺寸不受约束**：`.md`（style.css:745-765）与 `.bld-review-preview`（style.css:3889-3897）均没有 `img` 规则（对比：File Board `.file-md img` 有 `max-width:100%`，style.css:1434），外链大图会横向撑破栏布局、拉出横向滚动。外链 `http(s)` 图片本身无 CSP 阻拦、`sanitizeHtml`（build.js:3310-3314，只剥 `<script>` 与 `on*` 内联事件）不剥 `img` 标签，可以加载——此项未实测，待确认。
3. **mermaid / plantuml 不渲染**：```` ```mermaid ````、```` ```plantuml ```` 围栏经 marked 仅输出普通 `<pre><code class="language-mermaid">` 代码块，显示为源码文本；前端资源里没有任何图表渲染库（`scripts/web/` 仅有 marked / highlight.js / gitgraph（仅 git 提交图）/ wunderbaum），全仓检索 mermaid / plantuml 零命中。README / 设计文档中惯用的流程图、时序图在预览态全部退化为代码文本。

简言之：审查预览等于"纯文本级 Markdown"，凡带仓库图片或 mermaid / plantuml 图表的发布文档，预览所见与 GitHub / IDE 渲染效果严重不符，人工审查「产品界面」截图与架构图时只能切编辑态看源码或另开工具。

## 复现步骤

前置：dev 分支；任一项目已有版本计划并进入「文档编写」步（本项目自身即可——其 README.md 含相对路径图片）。

1. 启动看板：项目根执行 `node scripts/server.mjs`（或 `bin/atb serve`），浏览器打开 `http://127.0.0.1:8888`。
2. 进入「构建」模块 → 选择版本计划 → 右侧详情切到「文档编写」步。
3. 点击「审查」打开审查对话框（build.js `openReview`，2061 行起），README 页签默认即预览态。
4. 在 `README.md`（中文）栏滚动到「产品界面」一节的 `![1790092127929](image/README/1790092127929.png)`：
   - 实际：裂图占位（404），图片不显示；开发者工具 Network 可见对 `http://127.0.0.1:8888/image/README/1790092127929.png` 的请求返回 404。
   - 预期（本单诉求）：图片正常显示。
5. 切「编辑」态，在文档中临时插入一段 mermaid 围栏（如 ```` ```mermaid ```` + `graph TD` + `A[总结]-->B[翻译]` + ```` ``` ````）与一段 plantuml 围栏，点「保存」后切回「预览」：
   - 实际：两段均显示为等宽源码代码块，不渲染图形。
   - 预期：渲染为流程图 / 时序图等图形。
6. 对照：同一份 README.md 在 GitHub 或 IDE Markdown 预览中相对图片与 mermaid 图均正常显示。

## 期望行为

1. **图片**：
   - 仓库内相对路径图片在预览态正常显示——沿用既有 `/api/fs/raw?path=…` 白名单图片端点按当前项目根解析（图片 MIME 白名单与 8MB 上限口径不放宽；越权 / 超限 / 不存在的路径给明确占位提示，不呈裸裂图）。
   - 外链 `http(s)` 图片正常显示。
   - 图片宽度受约束（如 `max-width:100%`），不撑破栏布局、不拉出横向滚动。
2. **mermaid / plantuml**：预览态将 ```` ```mermaid ````、```` ```plantuml ```` 围栏渲染为图形。具体库选型与 plantuml 的本地渲染方式在 design 阶段按 REQ-20260909-015 开源选型评估（注意项目原则「本地优先 · 无外部依赖」，index.html 页脚自述——接入在线渲染服务（如 plantuml.com）的方案需单独确认）；渲染失败（语法错误 / 库加载失败）时回退显示源码块并给出可见提示，不白屏不崩溃（与 `renderMd` 现有异常回退 `<pre>` 口径一致）。
3. **不回归**：审查对话框既有行为全部保持——编辑 / 预览切换、各栏同步滚动（bindReviewSyncScroll）、保存回退待审核、通过审核、空文档占位、`sanitizeHtml` 消毒口径（剥 `<script>` 与 `on*`）、预览展示即将提交的原文（data-i18n-skip）、深浅色适配。

## 验收说明

- [ ] 按复现步骤 4：README 预览「产品界面」的仓库内图片正常显示（走 `/api/fs/raw` 白名单端点，Network 可见 200）；不再出现 404 裂图。
- [ ] 按复现步骤 5：mermaid 围栏渲染为图形；plantuml 围栏渲染为图形或按落定方案给出明确降级提示（落定前不得裸显源码且无任何提示）。
- [ ] 构造坏图（不存在的相对路径）：预览显示失败占位（含文件路径提示），不白屏、控制台无未捕获异常；构造坏语法（非法 mermaid）：回退源码块 + 可见错误提示。
- [ ] 超宽图片不撑破栏布局（`max-width:100%` 生效）；深浅色下图片 / 图表显示正常。
- [ ] 安全口径不放宽：`/api/fs/raw` 仍仅图片 MIME 白名单 + 8MB 上限 + 收敛 CSP；`sanitizeHtml` 剥 `<script>` / `on*` 行为保持；不新增任意文件读取入口。
- [ ] 回归：审查对话框页签切换、编辑 / 预览切换、同步滚动、保存与回退、通过审核、整体审查完结、提交门禁不受影响；其余三处同口径 `renderMd`（app.js:377 / req-disc.js:55 / oncall.js:85）如同步修改，各宿主界面（条目详情 / 讨论板 / 值班问答）预览不回归；涉及界面改动的新增 / 变更文案中英文同步（`scripts/web/i18n.js`，BUG-20260912-001 基线）。

## 待确认

1. **渲染范围**：图片与图表支持的修改范围是仅审查对话框（build.js `renderMd`），还是四处同口径 `renderMd`（条目详情 / 讨论板 / 值班问答）一并补齐（建议一并，口径统一；涉及相对路径改写时各宿主的「项目根」语义一致）。
2. **plantuml 渲染方式**：本地渲染（WASM / 内嵌引擎）还是在线服务（plantuml.com）——后者与「本地优先 · 无外部依赖」原则冲突，需人工确认；或首期仅支持 mermaid、plantuml 给明确降级提示。
3. **外链图片行为**：外链 `http(s)` 图片在当前实现下应可加载（无 CSP、sanitize 不剥 img），未实测；若实际另有阻拦，修复时一并放开并在验收 4 中覆盖。
4. **相对路径改写锚点**：`/api/fs/raw` 按当前项目根解析，而发布文档（README 等）位于被管理项目根——两处一致；但文档内若引用越出项目根（`../`）或白名单外格式（如 `.tiff`）的素材，占位提示文案口径需落定。

## 界面展示

- **布局**：审查对话框——头部（标题「审查发布文档（版本 id）」+ 关闭）→ 文档类型页签行（README / CHANGELOG / FEATURES / AGENTS / LICENSE / 自定义，含审核计数）→ 页签内各语言栏并排（栏头：文件名 + 七态 chip + 「编辑 / 预览」切换 + 保存 + 通过审核；栏体：预览态富文本 / 编辑态 textarea）→ 底栏（全部 x/N 已审核 · 本页签 a/b · 同步滚动说明）。修复点集中在预览态栏体：仓库相对路径图片、mermaid / plantuml 图形、图片宽度约束。
- **交互**：页签切换、每栏独立「编辑 / 预览」切换；「缺陷现状 / 期望修复后」对照开关——缺陷态展示裂图（404 占位）与源码化图表，修复态展示正常图片、渲染后的 mermaid 流程图与 plantuml 图；超宽图在缺陷态撑破栏布局、修复态按栏宽收敛。
- **状态反馈**：覆盖正常（图片 + 图表渲染成功）、空态（空文档占位「（空文档）」）、加载（「正在读取文档内容…」）、失败（图片不存在占位提示、mermaid 语法错误回退源码 + 错误提示条）等状态切换；深浅色可切换。
- **可交互演示**：[./ui-demo.html](./ui-demo.html)（单文件 HTML，浏览器直接打开；内置「缺陷现状 / 期望修复后」对照开关、状态模拟与深浅色切换；演示中的图片为内联 SVG 占位、流程图为演示级渲染，非真实 mermaid 引擎）。

## 关联

- 引入来源：REQ-20260921-011（预览态富文本容器 `.bld-review-preview` 与 `renderMd` 引入，当时仅覆盖标准 Markdown 语法子集）。
- 现有实现位置（修复阶段参考）：`scripts/web/build.js`（`renderReviewModal` / `renderMd` / `sanitizeHtml` / `openReview` / `loadReviewPair`）、`scripts/web/app.js:377`、`scripts/web/req-disc.js:55`、`scripts/web/oncall.js:85`（同口径 `renderMd`）、`scripts/server.mjs`（`serveFile` + `webRoot`、`/api/fs/raw` 图片端点 507-511 / 580-598）、`scripts/web/style.css`（`.md` 745 起、`.bld-review-preview` 3889 起，均缺 img 规则）、`scripts/web/marked.min.js`（vendored marked v12.0.2）。
- 前置：REQ-20260921-008（审查对话框与三段式流水线）、REQ-20260921-012（三阶段流程）。
- 选型与文案基线：REQ-20260909-015（开源选型）、BUG-20260912-001（i18n 中英同步）。
