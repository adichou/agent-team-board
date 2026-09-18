# 设计 — REQ-20260909-013 隐藏文件模块

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

「讨论」「文件」两个模块需要**暂态隐藏**（不是功能删除）：仅让相关入口在界面上不可见、不可达；数据、服务端能力与既有 JS 机制全部保留，且以低成本可恢复的方式实现。隐藏范围限定为产品界面与路由入口；文档预览（条目文档页签 loadDoc）、附件查看、条目内 ui-demo.html 链接与文件读取接口（/api/fs）不受影响。「营销」「发布」等其他模块不在隐藏范围。

## 方案

**单一开关集中门控**：`scripts/web/app.js` 顶部（VIEWS 常量之后）定义
`const HIDDEN_VIEWS = new Set(['oncall', 'files']);`，所有收敛点读取该开关做「门控」而非「删除」：

| 收敛点 | 位置 | 行为 |
| ---- | ---- | ---- |
| 顶栏模块导航 | index.html `.module-nav` | 移除「讨论」「文件」两个 `<button>`（收敛为 需求/任务/营销/发布/设置；无空占位） |
| 统一新建类型 | index.html `#fType` | 移除 `<option value="ask">`（仅剩 需求/Bug；`submitNew` 的 ask 分支与服务端 `/api/discussion` 保留待恢复） |
| 旧深链 / 快照 / 残余跨模块入口 | app.js `setView` | `HIDDEN_VIEWS.has(v)` 兜底回落 `status` + 一次性 toast；URL 经 `syncProjectUrl` 按回落模块重写（view 参数清理、project 等保留），无空白视图 |
| 刷新快照恢复 | app.js `applyViewSnapshot` | 隐藏态跳过 oncall `restoreView` 委托与 files 层栈暂存（不发起隐藏模块内部请求） |
| 详情「讨论纪要」页签 / 分区 | app.js `renderDrawer` | 页签按钮与 disc 分区模板门控为不渲染；`bindReqDiscussions`（关联讨论刷新）不调用 |
| 「来源讨论」meta 行 | app.js `renderDrawer` | 整行不渲染（`it.sourceDiscussion` 底层数据字段保留） |
| 文档讨论区块挂载 | app.js `renderDrawer` | 隐藏态不 `ATBReqDisc.mount` |
| 主轮询讨论请求 | app.js `poll` | 隐藏态不发起 `/api/oncall/tickets` 与 `/api/req-disc` |
| 页签失效回落 | app.js `drawerTabValid` | `'disc'` 在隐藏态返回 false（快照 / 会话内残留激活态经既有机制回落「基本信息」，REQ-20260909-006 不回归） |
| 搜索跨模块入口 | app.js `renderDocHits` | 「文件 N · 在文件查看」按钮（`data-goto-view="files"`）不渲染；`renderFileHits` 的返回需求入口模板保留 |
| 隐藏模块 UI 文案 | app.js `MODULE_SUB` / `SEARCH_PLACEHOLDER` / `SEARCH_SCOPE` | oncall / files 键移出（视图经 setView 兜底不可达，属死配置） |

**零改动面**：`scripts/server.mjs`、`oncall.js`、`req-disc.js`、`marketing.js`、`release.js`、`docs/agent-team-board/discussions|oncall` 数据目录、全部 status.json 均不触碰；不写任何 status.json。

### 待确认项裁定（开发阶段，供人工复核）

1. **讨论模块及详情「讨论纪要」**：按既有验收正文目标执行——顶栏入口与详情讨论侧入口一并隐藏（演示目标态一致）。
2. **新建类型「讨论（ASK）」**：按验收第 3 条裁定为**移除**（下拉仅剩需求 / Bug 两项）；`submitNew` ask 分支、`/api/discussion` 服务端与 `openModal(type)` 的 ask 兼容参数保留，恢复 = 加回 `<option>` 即生效，无「跳转已隐藏模块」的可达落点问题。
3. **「来源讨论」行**：裁定为**整行隐藏**（不保留不可点击的来源文字）；`sourceDiscussion` 底层关联字段与服务端数据不动。
4. **恢复入口的实现方式 / 默认值 / 历史视图选择**：不做运行时开关 UI（暂态要求低成本，不做产品化配置项）；恢复走代码级步骤（见下）；隐藏期间旧快照 / 深链回落需求模块，恢复后历史视图选择（sessionStorage 快照）随下一次正常浏览自然重建，不刻意保留隐藏前的模块态。

### 恢复步骤（暂态可逆）

1. `scripts/web/app.js`：`const HIDDEN_VIEWS = new Set(['oncall', 'files']);` → `new Set([])`（或直接删键）。
2. `scripts/web/index.html`：`.module-nav` 内加回两个按钮（讨论在需求前、文件在任务后，均 `class="view-tab"`）；
   `#fType` 加回 `<option value="ask">讨论（ASK）</option>`。
3. `scripts/web/app.js`：`MODULE_SUB` / `SEARCH_PLACEHOLDER` / `SEARCH_SCOPE` 加回 oncall / files 键
   （副标题：`oncall: '开放式讨论，看板沉淀成果'`、`files: '项目资料与源码，专注阅读'`；
   占位符：`oncall: '搜讨论标题 / 编号…'`、`files: '搜文件…'`；范围：`oncall: '讨论'`、`files: '文件'`）。
4. 既有测试中被更新口径的断言（workbench-layout W2/W6/W8/W9/W13 等）需按 git 历史还原口径，`hide-modules-20260909-013.test.mjs` 同步反转。

其余机制（disc 页签模板、关联讨论刷新、req-doc-disc 挂载、`data-goto-view` 绑定、文件横幅初始化、oncall.js 全部逻辑）均未删除，开关一开即恢复。

## 风险与边界

- **风险：开关外散落入口漏收敛**。已按「README 验收」逐条核对：顶栏 / 深链 / 快照 / 搜索跨模块入口 / 来源讨论 / 讨论纪要 / poll 请求，并在 `hide-modules-20260909-013.test.mjs` 以行为测试锁定（H2/H3/H5/H6/H7/H8）；残余未知入口即便触发 `setView('oncall'|'files')` 也会被兜底回落（防御纵深）。
- **风险：旧会话快照含隐藏模块态**。`setView` 兜底 + `applyViewSnapshot` 跳过隐藏模块落位，双保险；不报错、不空白。
- **边界：`atb:oncall-state` 事件与 `ATBOncall.snapshot()` 落盘接缝保留**（保存 oncall 浏览态无害，不发请求）；`saveViewSnapshot` 未门控属有意保留（恢复后即接续）。
- **边界：不引入运行时配置 / localStorage 开关**——避免半恢复的中间态（导航回来了但详情页签仍隐藏之类），恢复以一次代码变更为单位整体生效。
- **人工核对清单**（自动化未覆盖的验收项）：深浅色两种外观下导航行、详情页签行、新建弹窗无残留样式与空占位；浏览器实测 `?view=oncall` / `?view=files` 回落与提示；网络面板确认详情打开无讨论请求。
