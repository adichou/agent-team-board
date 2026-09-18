# 设计 — REQ-20260910-001 app 场景点击 Cmd+R 刷新后，需要回到刷新前的界面

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

Electron 壳（REQ-20260905-001）未拦截 Cmd+R，默认菜单触发整页重载；页面重走 `boot()` 后
`state` 全部复位，用户被抛回「需求模块 · 待接受档 · 抽屉空态」。现状仅项目（`?project=` +
localStorage）、模块（`?view=`）、需求排序（localStorage `atb.req.sort`）能挺过刷新
（BUG-20260907-002 / REQ-20260907-004 / REQ-20260908-002 建立的基线）。

## 方案

**通道选型（README「待确认」结论）：sessionStorage，键按项目隔离。**

- 键：`atb.viewstate:<项目根绝对路径>`，值为 JSON 快照（带 `v: 1` 版本号，解析失败按无快照处理）。
- 选 sessionStorage 而非 URL / localStorage 的理由：
  - 「刷新回到刷新前」是**会话级**诉求——sessionStorage 生命周期与标签页一致，天然满足
    「新开窗口 / 新标签回到默认初始界面」（README 默认口径），无须额外清理；
  - URL 深链扩展会让地址栏参数随每次交互变长（筛选档、页签、文件路径、搜索词叠加），
    且分享 URL 时会把瞬时浏览状态一并带走，违背「项目 + 模块」深链的既有语义；
  - localStorage 会跨窗口/跨重启记忆，超出本单口径（跨重启记忆如需要另立需求）。
- 既有 `?project=` / `?view=` 深链**优先级高于快照**：显式深链是用户意图，深链能力不回归
  （验收标准明确要求）。因 `syncProjectUrl()` 持续把非 status 模块写回 `?view=`，非 status
  模块的「模块级」恢复实际由 URL 承载，快照只承载模块内浏览状态——两级通道互补，无冲突。

**快照内容与写入点（单一写者：app.js `saveViewSnapshot()`）**

| 域 | 字段 | 写入时机 |
| -- | ---- | -------- |
| 模块 | `view` | `setView()`（含恢复路径自身，幂等） |
| 需求 | `reqFilter`、`drawer:{id,tab}｜null` | 筛选 chip 点击（`#filterBar` 委托）、`openDrawer` / `closeDrawer` / `activateDrawerTab` |
| 任务 | `batchMode`、`batchPane`、`refinePane` | 一级页签（`data-bmode`）与二级页签（`activateTaskPane`）切换 |
| 搜索 | `searchQ` | `runSearch()` / `clearSearch()`（状态落定后写） |
| 讨论 | `oncall:{filter,selectedId,tab}｜null` | oncall.js 状态变化派发自定义事件 `atb:oncall-state`，app.js 监听后统一落盘（同 `atb:open-req` 先例，避免暴露全局 state） |
| 文件 | `files:{layers,activeFile,mdSource}｜null` | `openDirLayer` / 面包屑截断 / `openFile`（wrap 开关随 openFile） |

不进快照（README「明确不恢复」边界）：勾选集合（acceptance/impl/plan/reject）、toast、
表单草稿、列表滚动位置（讨论 `listScrollTop` 与需求列表滚动，按「待确认」默认结论不纳入）。

**恢复时机与流程（boot() 内，首轮数据到达后一次性应用）**

```
boot():
  解析项目 → 读取该项目的快照（无/解析失败/项目空 → 跳过）
  await poll()                       # 看板数据到位（失效回落判定的依据）
  applyViewSnapshot(snap):           # 纯 state 前置 + 委托恢复
    reqFilter / searchQ / batchMode / batchPane / refinePane / oncall / files(暂存层栈)
    drawer: 条目仍在 state.board.items → openDrawer(id) 后 activateDrawerTab(tab)（同条目）
  setView(viewParam ?? snap.view)    # URL 深链优先；setView 按恢复后的 state 渲染
```

- 需求抽屉：`openDrawer` 前先核验条目存活（board items 含该 id），删除则静默不打开（避免
  `refreshDrawer` 的 toast 报错）；页签经既有 `drawerTabValid` 回落「基本信息」。
- 讨论模块：oncall.js 新增 `restoreView(snap)` 导出——校验 filter/tab 落位 `state`，详情经
  `refreshDetail({restore:true})` 拉取；`restore` 路径下详情 404 **静默 `closeDetail()`**
  （不走 toast），满足「失效回落无报错」。`snapshot()` 导出供落盘读取当前态。
- 文件模块：快照层栈暂存于 `state.banner.restoredLayers / restoredFile`，`initFileBoard()`
  首次初始化时优先展开恢复层栈（逐层 `openDirLayer`，任一层失败即停在已展开前缀 = 回落），
  再按父层目录条目核验 `activeFile` 存活后 `openFile(key, {source: mdSource})`（md 渲染/源码
  态随快照恢复；文件被删则回默认引导文案，不显示报错）。无暂存层栈时走既有 DEFAULT_PATH
  展开路径，行为不变。
- 项目切换（`switchProject`）：保持既有「按项目重置」先例，不中途恢复；但重置完成后立即
  `saveViewSnapshot()` 用「重置后的默认态」覆盖新项目的快照，保证「切换项目后立刻刷新」
  恢复出来的正是刷新前所见（默认初始界面），不残留该项目更早的旧浏览态。

**失效回落汇总**（恢复目标在刷新间隙已不存在）：条目被删 → 抽屉空态（不打开、无 toast）；
文档页签被删 → 回落「基本信息」（既有 `drawerTabValid`）；讨论被删 → 静默回列表（restore
路径不 toast）；文件被删 → 默认引导文案；目录层失效 → 停在最后有效层（极端回项目根）；
快照损坏/版本不符 → 视为无快照，按现状初始界面。所有回落静默完成，不阻塞后续操作。

**影响面**：`scripts/web/app.js`（快照模块 + boot/setView/各交互挂点 + initFileBoard 恢复
分支）、`scripts/web/oncall.js`（`snapshot`/`restoreView` 导出 + 状态变化事件 + restore 静默
回落）。`electron/` 零改动（Cmd+R 仍整页重载，恢复由页面完成）；服务端零改动（纯前端态，
全部复用既有 GET 接口）。

**开源选型（REQ-20260909-015）**：自研。理由——无合适库：本需求是「把本项目 state 结构
序列化到 sessionStorage 并在 boot 后按项目隔离恢复」，与本项目 `state`/`boot()`/各模块
回落先例（`drawerTabValid`、`taskPaneOf`、banner 层栈）强耦合，通用状态持久化库（如
zustack persist 类）反而要求改造状态管理结构，引入成本高于自研；未引入任何开源依赖，
不创建 licenses.md。

## 风险与边界

- **快照写入频率**：搜索输入防抖后每 250ms 落一次、其余交互各落一次；sessionStorage 同步
  写入为微秒级，且 JSON 体积极小（几百字节），无性能顾虑。
- **恢复与轮询竞态**：恢复只发生在 `boot()` 首轮（poll 之后、setView 之前），此后 2 秒轮询
  行为与现状完全一致；`openDrawer` / `refreshDetail` 内部已有过期响应丢弃防护。
- **多标签同项目**：sessionStorage 按标签隔离，两标签各自维护快照互不覆盖（localStorage
  则会串写，这也是弃用它的原因之一）。
- **深链优先**：URL 带 `?view=` 时不采纳快照的 `view`（模块级以深链为准），模块内状态仍按
  快照恢复——深链进入某模块后看到的仍是该项目上次的模块内浏览态，符合「回到刷新前」直觉。
- **不恢复清单**：表单草稿、勾选集合、toast、滚动位置、深浅色（README 边界，维持现状）。

## 实施记录

- 2026-09-10（zcode-batch-029-1）：
  - `scripts/web/app.js`：新增「刷新状态快照（REQ-20260910-001）」模块——
    `saveViewSnapshot()` / `applyViewSnapshot()` / `readViewSnapshot()`，键
    `atb.viewstate:<项目根>`；boot() 在首轮 poll 后应用快照，URL `?view=` 深链优先；
    setView / 筛选 chip / openDrawer / closeDrawer / activateDrawerTab / activateTaskPane /
    一级 bmode / runSearch / clearSearch / openDirLayer / openFile / 面包屑截断 /
    switchProject（重置后覆盖默认态）挂写入点；`atb:oncall-state` 事件监听落盘。
  - `scripts/web/app.js` `initFileBoard()`：首次初始化优先展开 `restoredLayers`、核验并
    重开 `restoredFile`（md 渲染/源码态随快照）；失效逐层/逐文件回落，无暂存走原默认路径。
  - `scripts/web/oncall.js`：新增导出 `snapshot()` / `restoreView(snap)`；filter 切换、
    openItem、closeDetail、详情页签切换、归档等状态变化派发 `atb:oncall-state`；
    `refreshDetail({restore:true})` 详情拉取失败静默 `closeDetail()`（不 toast）。
  - `electron/` 零改动；服务端零改动；`scripts/web/index.html` 零改动。
