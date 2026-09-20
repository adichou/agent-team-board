# 设计 — REQ-20260908-017 创建完单后直接返回列表即可

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260906-016 引入「创建完单后自动导航到对应单」：弹窗路径 `submitNew()` 成功后 `openDrawer(新单)`（需求/Bug）或 `reveal`（讨论单）；CLI 路径靠 2 秒轮询 `detectNewItem()` 检测新单后 toast「已定位新建条目」并 `openDrawer`。实际使用中自动跳转打断浏览上下文，本需求修订为创建后仅返回列表。

## 方案

纯前端（`scripts/web/app.js`、`scripts/web/oncall.js`），不动任何服务端接口：

1. `submitNew()` 需求/Bug 分支：保留 `closeModal` → toast → `setView('status')` → `await poll()`（刷新列表），删除 `state.knownIds?.add(st.id)` 兜底与 `openDrawer(st.id)` 自动导航。此前手动打开的详情由 poll 内常规 `refreshDrawer()` 维持，不切换不关闭。
2. `submitNew()` 讨论单分支：保留 `closeModal` → toast → `setView('oncall')` → `await window.ATBOncall?.poll(project, true)`（刷新讨论列表），删除 `reveal(t.id)`。
3. `poll()`：仍调用 `detectNewItem(b)` 登记 id 基线（README 要求保留，防自动导航回归），删除「已定位新建条目」toast 与 `openDrawer` 跳转分支；`state.drawer.id` 存在时照常 `refreshDrawer()`。
4. `detectNewItem()` 收敛为纯基线登记（首轮播种 + 逐轮补登），不再筛选最新新单、不再检查弹窗护栏（无跳转后两者失去意义）。
5. `oncall.js` 删除仅剩这一处调用方的 `reveal()` 及其导出（死代码清理）；oncall 内部 `openDrawer` 保留用于手动点击列表行。
6. `switchProject` / `btnInit` 的 `knownIds = null` 基线重置保留不变。

筛选/排序/搜索/勾选不受影响：`setView` 不触碰 `reqFilter`/`reqSort`/`search`/勾选集合，列表由既有 `renderBoard()` 增量渲染刷新。

## 风险与边界

- 自动导航属旧行为有意移除：`new-item-nav.test.mjs`（REQ-20260906-016）同步改写为新契约；`oncall-question-optional.test.mjs` U2、`workbench-layout.test.mjs` W7 的 reveal 断言同步修订。
- 旧测试静态切片标记（`// 列结构与拖拽监听`、`批量实施抽屉`）已随后续重构改名而失效（切片吞到文件尾、断言空转），本次改为按函数体提取，恢复真实约束力。
- `knownIds` 基线机制保留，仅不再驱动跳转；后续若恢复自动导航可直接复用。
- 浏览器人工验收项（宽窄屏抽屉不滑出、CLI 路径 2 秒出新单）见 test-cases.md M1/M2。
