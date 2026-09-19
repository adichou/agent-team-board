# 设计 — REQ-20260919-002 需求开发中遇到需人工决策的时候，决策界面需要优化布局

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现状两处决策界面（`#holdArea` 聚合区 + `#holdPanel` 侧拉面板）由 REQ-20260911-007 交付，
功能闭环完整，但布局平铺、主次不分、面板缺常驻进度指示（痛点见 README）。本设计为纯前端
布局层重构，不改 hold 状态机、CLI 与 API 契约。

## 方案

（技术选型、接口设计、影响面）

**开源选型（REQ-20260909-015）**：本条为既有界面的布局样式与渲染调整，全部用项目现有
原生 HTML / CSS / JS 能力实现（flex 分组、语义色 pill、textarea 高度自适应），不引入任何
新依赖（无合适开源库能替代几行布局 CSS；引入成本高于自研）。不创建 licenses.md。

### README「待确认」项的 design 决策

1. **聚合区可见性增强手段**：不改 DOM 位置（README 明确不强制改位置，避免牵动列表布局与
   既有测试锚点），采用「整区面板化 + 区头强调 + 计数徽标」——`#holdArea` 有内容时整区
   加面板底色 / 边界描边 / 圆角，区头改为「⚠ 待人工确认」强调文本 + 独立计数徽标
   （`.hold-count`，描边胶囊，语义色与卡片旗标一致）。长列表场景下聚合区因边界描边与
   计数徽标更易被扫到；列表行 `⚠ 等人工决策` 角标（既有引导文案）保留不动。
2. **答复框自适应高度**：做。textarea 加最小 2 行（min-height 对齐 2 行）、随内容增高的
   `data-hold-grow` 自动生长（input 事件重算 scrollHeight，上限 12 行后内部滚动），
   纯 JS + CSS，失败降级为固定 2 行（resize: vertical 仍可手动拉伸）。
3. **聚合区加载中专门视图**：不做。refreshHolds 失败才显示错误条（保留上次数据），
   空态整体隐藏；轮询频率下加 loading 视图会造成每次刷新闪动，与「空态不占版面」口径
   冲突。维持现状（README 允许维持）。

### 聚合区（index.html / app.js / style.css）

- 区头：`<header class="hold-area-head">` 内 `⚠ 待人工确认` 文本 + `<span class="hold-count">N</span>`
  徽标；副行说明文案不变。
- 卡片四层（`holdCardHtml` 重构，类名对齐 ui-demo.html）：
  1. `.card-top` 元信息行：单号（itemIdHtml）+ `⚠ 等人工决策` 旗标 + 等待时长
     （`.hold-wait`，`margin-left: auto` 靠右弱化）；
  2. `.card-title` 标题行（不变）；
  3. `.hold-q-summary`：`未答 x/y` 计数徽标（`.unanswered-count` 描边胶囊）+ 问题列表
     **未答置前**（`.hold-qs li.open` 加粗），已答收起为 `<button data-hold-fold>`
     「已答 n 项」（`aria-expanded`，箭头独立 span），点击展开/收起（`state.holds.answeredOpen`
     Map 记录，纳入轮询签名剪枝，重绘不丢折叠态）；全未答时不渲染折叠按钮；
  4. `.hold-acts` 操作区：`justify-content: space-between` 分两组——`.acts-primary`
     （`补决策` primary + `复工` accent，未答 > 0 禁用 + tooltip 口径不变）、
     `.acts-secondary`（`查看进展记录` + `确认完成` 弱化 `.btn.ghost`，左侧虚线分隔）。
- 展开记录区（时间线）逻辑不变，仍由 `data-hold-toggle` 控制，默认折叠。

### 侧拉面板（index.html / app.js / style.css）

- 结构调整：`#holdPanel` 在头部与内容区之间加常驻进度条 `#holdProgress`
  （`.sp-progress`，flex: none）；消息行 + 关闭/保存决策按钮移出 `#holdForm`，改为
  面板底部常驻 `<footer class="sp-foot">`（flex: none，保存按钮用 `form="holdForm"`
  关联提交，既有 submit 监听不变）；`.side-panel-body` 仅保留读取中 / 错误 / 表单三态，
  问题多时该区独立滚动，头部 / 进度条 / 底部不压缩。
- 进度指示：`renderHoldProgress(unanswered, total)` 渲染 `未答 x/y` 徽标 pill
  （未答 > 0 橙色 / 齐备绿色 `.done`）+ 提示文本（「待答 N 项，填写后保存草稿」/
  「决策已齐备，可复工」）；`loadHoldQuestions` 渲染表单后更新，`saveHoldAnswers`
  保存成功后随 `refreshHolds()` 同步更新，与卡片 `未答 x/y` 同源。
- 焦点可达：打开面板后聚焦**首个未答**问题的 textarea（全已答时聚焦第一个）。
- meta 行（声明时间 / 声明人 / 受阻原因 / 未答 x/y）保留在表单顶部。

### i18n（scripts/web/i18n.js）

- 新增静态词条：`⚠ 待人工确认`、`展开 / 收起已答问题`；动态词条（EN_DYNAMIC）：
  `已答 ◇ 项`、`未答 ◇/◇`、`待答 ◇ 项，填写后保存草稿`。
- 旧区头整串动态键 `⚠ 待人工确认（◇）` 随渲染结构调整不再使用，按「文案改动集中
  i18n.js 双语同步」口径同步移除（UI 已不产生该字符串，避免词典死键）。

### 影响面与不回退清单

- 不改：`lib/hold-states.mjs`、`lib/hold-store.mjs`、`server.mjs` 的 `/api/holds*` 路由、
  `atb hold *` CLI、state-guard 拦截面。
- 交互口径零回退：草稿保存、未答 > 0 复工禁用 + tooltip、确认完成二次确认（force）、
  Esc/✕/关闭 + 焦点回归、保存中不可关闭、轮询签名剪枝（签名扩展纳入折叠态，仍不丢
  输入与展开态）、面板三态、聚合区错误条 + 重试 + 空态隐藏。
- 深浅色：新样式全部走既有 CSS 变量（--panel/--border/--inprogress/--done/--muted）。
- 窄屏 ≤640px：面板全屏沿用 `.side-panel` 断点；`.acts-secondary` 分隔线取消、
  `.hold-acts` 允许换行，卡片无横向滚动。

## 风险与边界

- `#holdProgress` / `.sp-foot` 为 holdPanel 专属结构，不影响复用 `.side-panel` 几何的
  其他面板（新建 / 编辑 / 项目管理 / 挂起确认）——新增样式全部挂在 hold 专属类或
  `#holdPanel` 作用域下。
- `holdCardHtml` 渲染测试用 VM 提取函数隔离验证（与 commit-ui 测试同套路），
  不依赖真实 DOM。
- 若人工批注推翻上述「待确认」决策，仅需调整对应样式/结构，不影响数据与契约层。
