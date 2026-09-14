# 设计 — BUG-20260910-004 全局模块入口放在右上角管理项目右边

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260910-003（增加一个全局看板，可以看到当前在工作的批量任务；编号已经 `atb list` 核验真实存在，状态 in-progress）

归因依据：全局入口最初由 REQ-20260910-003 引入——`scripts/web/index.html` 第二行模块导航中的
`<button class="view-tab" data-view="global">全局</button>` 与 `scripts/web/app.js` 的
`VIEWS`（含 `'global'`）、`setView`、`#globalView` 主视图容器均带 REQ-20260910-003 标记；
本 Bug 反馈的正是该入口层级（与项目模块并排）与数据范围（跨项目）不一致的问题。

## 根因分析

REQ-20260910-003 实施时把跨项目的全局任务总览做成了与「讨论 / 需求 / 任务 / 文件」并列的主视图页签：

1. 入口层级错位：全局数据不属于任何单一项目，放在项目模块导航里暗示「当前项目的一个模块」，
   与顶栏项目选择器语义冲突（切换项目后入口仍在，内容却不变，用户无法从入口位置理解这一点）。
2. 呈现容器错位：`setView('global')` 替换主工作区，把「看一眼跨项目总览」变成「离开当前模块」，
   丢失当前模块的搜索 / 筛选 / 浏览上下文（虽然模块快照能部分恢复，但交互语义仍是切换）。

## 方案

只调整入口与展示容器，聚合接口（`/api/batch/global`）、过滤口径、任务状态、跳转语义全部不变：

1. `scripts/web/index.html`：顶栏 `.top-actions` 中「管理项目」紧右侧新增 `#btnGlobal`
   （`class="btn"`，`aria-haspopup="dialog"` + `aria-expanded` + `aria-controls`，非 view-tab，
   保持「顶栏无视图切换」既有契约）；第二行模块导航移除 `data-view="global"` 页签；
   原 `#globalView` 主视图容器替换为常驻右侧面板 `#globalPanel`（role=dialog）：
   头部 =「全局任务」标题 + 跨项目范围说明 + `#globalPanelClose` 关闭按钮；工具区 = 独立搜索
   `#globalSearchInput`；内容区 `#globalPanelBody` 动态渲染。头部与搜索为静态节点，
   加载 / 失败状态不重渲染它们 → 关闭永远可用。
2. `scripts/web/app.js`：
   - `VIEWS` 收敛为五模块（去 `global`）；`setView('global')` 收敛为 `openGlobalPanel()` 后返回，
     不改 `state.view` → 打开面板不切换当前项目模块，关闭回到打开前上下文；
   - 新增 `openGlobalPanel`（幂等守卫防重复叠加；同步 `aria-expanded`；焦点进面板关闭按钮）/
     `closeGlobalPanel`（焦点返回入口）/ `bindGlobalPanelOnce`（面板独立搜索：词存
     `state.global.q`，防抖复用 `SEARCH_DEBOUNCE_MS`，Esc 只清空不冒泡；不写第三行 `state.search`，
     不污染底层工作区搜索条件）；
   - `refreshGlobal` / 主轮询守卫由 `state.view === 'global'` 改为 `state.global.open`；
     `renderGlobalView` 渲染进 `#globalPanelBody`（骨架 / 无项目引导 / 已收尾 / 无匹配 / 首载失败 /
     刷新失败保留数据 / 单项目失败行等状态反馈全部保留）；
   - `gotoProjectTask` 跳转前 `closeGlobalPanel({ focus:false })`（跳转即关面板，目标与被点行一致）；
   - Escape 链插入全局面板一层：项目管理弹窗 → 新建弹窗 → 全局面板 → 详情抽屉（一次只关一层）；
   - 快照：`globalStatus` / `globalKind` 筛选档保留并新增 `globalQ` 面板搜索词；
     打开/关闭本身不进快照（见「风险与边界」第 3 条）。
3. `scripts/web/style.css`：`.global-panel` 右侧固定面板（`top/right/bottom:0`，`z-index:25`
   ——高于抽屉 20、低于弹窗 30）；头部 / 工具区 `flex:none` 不被压缩；内容区
   `overflow-y:auto` 滚动；≤640px 窄屏面板全宽、头部可换行，关闭按钮不被遮挡；
   `.global-group` / `.global-task` 等分组行样式沿用。

**开源选型（REQ-20260909-015）**：未引入开源库。本修复为既有 Web 看板内的入口位置与容器调整
（原生 HTML/CSS/JS + 既有样式变量即可完整实现），无合适的需以依赖方式引入的成熟库，
引入成本高于自研，故自研。

## 风险与边界

1. **旧 `view=global` 深链兼容（README 待确认项，已按最小兼容实现）**：boot 深链解析、popstate
   回放、旧快照 `view:'global'` 三处入口均收敛为「打开面板 + 保持 status 之外的打开前模块」；
   打开面板后 `syncProjectUrl` 规范化 URL（面板状态不写地址栏，刷新 / 分享不自动重开面板）。
2. **弹层互斥（README 待确认项）**：面板为非模态侧边面板（不加遮罩，底层工作区保持可见可操作，
   符合「关闭后保留原上下文」的期望）；关闭途径 = 关闭按钮 / Esc（链中一层）；帮助面板与
   新建 / 项目管理弹窗仍按既有优先级在最上层。
3. **刷新后恢复（README 待确认项）**：面板为临时层，刷新后不自动打开（与帮助面板一致；
   筛选档与面板搜索词随快照记忆，重开即恢复）；如后续确认需要恢复，可扩展快照 `globalOpen` 键。
4. **既有契约测试更新**：本 Bug 有意改变布局契约，同步更新了 workbench-layout W2、
   revert-ci-board T2、global-board-20260910-003 G6、shortcuts-20260910-007（隐藏容器清单）、
   search-module-20260910-009 S1/S9、detail-close-btn T3（Esc 链字面窗口放宽，行为不变）
   六处被取代的断言，并新增 `scripts/tests/global-entry-panel-20260910-004.test.mjs`（B1–B12）。
5. 浏览器内焦点流转、连续点击、窄屏视觉等按验收标准人工核对（静态契约已覆盖结构与绑定）。
