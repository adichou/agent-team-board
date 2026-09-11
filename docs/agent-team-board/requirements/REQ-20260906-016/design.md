# 设计 — REQ-20260906-016 创建完需求和 bug 单后，要自动导航到对应单

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

需求 / Bug 有两条创建路径：

1. 网页「＋ 新建」弹窗（`POST /api/new`）；
2. 终端 `/req`、`/bug` 斜杠命令（Agent 执行 `atb new req|bug` 写入事实源）。

两条路径创建完成后，看板都只是被动等 2 秒轮询刷新出卡片，人必须自己在四列里找到新单才能查看详情、点「接受」。本需求要求：创建完需求或 Bug 单后，看板自动导航到该单（打开其详情抽屉）。

## 方案

纯前端实现（app.js），不改 server / atb CLI / 状态机。

**1. 新建弹窗路径（`submitNew`）**

`POST /api/new` 成功后：关闭弹窗 → toast → `await poll()` → `openDrawer(st.id)`，直接落到新单详情。原有 toast「✓ 已创建 …（待接受）」保留。

**2. CLI 路径（轮询检测新条目）**

新增 `state.knownIds`（Set|null，当前项目已见条目 id 基线）与纯检测函数 `detectNewItem(b)`：

- `knownIds === null` 视为基线未建立：首轮 poll（页面加载、切换项目、点初始化后）只播种全部 id，不导航——不能一打开页面就跳到最新单。
- 基线已建立后，poll 拿到的新响应里出现未见过的 id 即「新建条目」；全部登记进基线，并取 `createdAt` 最新者（并列取 id 较大者）作为导航目标，由 poll 调 `openDrawer(target.id)` 并 toast 提示「已定位新建条目 <id>」。一次出现多条新单时只导航最新一条，其余仅登记。
- 导航护栏：新建弹窗或批量实施抽屉打开时不导航（弹窗在建设中、批量抽屉是更高层覆盖，弹窗路径由 `submitNew` 自己导航），但 id 照常登记，避免关闭弹窗后补跳。
- 详情抽屉已打开时允许被替换跳转——「创建完自动导航到对应单」优先于停留在旧单（创建是低频且明确的动作）。

**3. 基线重置点**

- `switchProject`：`knownIds = null`，新项目首轮 poll 重新播种（切换项目不等于创建了新单）；
- `#btnInit` 初始化成功后：`knownIds = null`（未初始化 → 已初始化是目录状态变化，既有条目不算新建）。

## 影响面

- `scripts/web/app.js`：`state.knownIds`、`detectNewItem()`、`poll()` 接线、`submitNew()` 导航、`switchProject()` 与 `#btnInit` 重置。
- 不改 index.html / style.css / server.mjs / atb.mjs / hooks；不触碰状态机与数据格式。

## 风险与边界

- 批量实施中 Agent 按 /bug 登记新 Bug 时，打开的看板会跳到该 Bug——与需求「创建完要自动导航」一致；若后续反馈干扰，可在护栏里收紧（如仅在抽屉关闭时跳）。
- 轮询粒度 2 秒：CLI 创建后至多 2 秒 + 一次往返内完成导航，无需服务端推送。
- 页面停留在文件视图时同样可跳转（`#drawer` 是顶层元素，与视图无关）。

## 实施记录（2026-09-07，zcode-batch-003-2）

- 前端 `scripts/web/app.js`：新增 `state.knownIds`（null = 待播种）与 `detectNewItem(b)`（基线播种 / 新 id 登记 / 弹窗+批量抽屉护栏 / createdAt 最新者选取，并列按 id 降序）；`poll()` 在看板签名变化时先检测再渲染，有导航目标则 toast「已定位新建条目 <id>」并 `await openDrawer(nav.id)`，否则保留原「已有抽屉常规刷新」路径；`submitNew()` 成功后 `await poll()` → `state.knownIds?.add(st.id)` 兜底登记 → `state.drawer.id !== st.id` 时显式 `openDrawer(st.id)`（避免与轮询检测重复打开）；`switchProject()` 与 `#btnInit` 各自 `state.knownIds = null` 重播种。
- 测试：新增 `scripts/tests/new-item-nav.test.mjs`（N1–N8，vm 加载实际 app.js 行为测试 + 接线静态契约），TDD 先红（8/8 失败）后绿（8/8 通过）；全量 `npm test` 46 个测试文件 0 失败。M1/M2 浏览器人工验收待人工。
