# 设计 — REQ-20260909-006 需求 bug 单详情页布局优化，使用页签式布局

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`renderDrawer()` 把抽屉 `drawer-body` 自上而下单列堆叠全部区块，条目关联信息越多文档正文与讨论被挤到底部。需求要求改为固定五页签：基本信息 / 说明 / 设计 / 测试用例 / 讨论纪要，`test-report.md` 保留为「测试用例」之后的附加页签。

## 方案

纯前端重组 `scripts/web/app.js` 的 `renderDrawer()` 与文档加载路径，不改任何数据来源与操作语义。

### 结构

- 抽屉 DOM 改为 `drawer-head` → `nav.tabs.drawer-tabs`（页签栏，`role="tablist"`，页签为 `<button type="button" role="tab" aria-selected>`，沿用 `.tabs` / `.tab` 胶囊视觉）→ `drawer-body`（内容区，独立滚动）。
- 页签 key：`info`（基本信息）、`README.md` / `design.md` / `test-cases.md`（三份固定文档页签，缺失仍显示、内容区给空态「尚未创建，开发阶段补充」）、`disc`（讨论纪要）；`test-report.md` 存在时追加在 `test-cases.md` 之后（`drawerDocTabs()` 口径）。
- 内容区三个 `section.drawer-pane[role="tabpanel"]`：`info`、`doc`（三/四份文档页签共用一个 `#docView`）、`disc`；按 `state.drawer.tab` 切换 `hidden`。

### 状态

- `state.drawer` 增加 `tab`（默认 `'info'`）与 `docCache`（文档名 → 已渲染 HTML，防再次激活重复请求）。`openDrawer()` / `closeDrawer()` / 初始 state 同步重置——切换条目回基本信息、旧条目缓存不串显。
- `activateDrawerTab(tab)`：校验（`drawerTabValid`，失效回落 `info`）→ 更新页签 active / aria-selected / pane 显隐 → 文档页签按「已在展示（早退）→ 命中缓存回填（不请求）→ 缺失文件空态（不请求、不置 `doc`）→ 首次激活加载态 + `loadDoc`」处理。
- `renderDrawer()` 起始按 `state.drawer.tab` 恢复页签与 pane 显隐：轮询触发的整抽屉重渲染（`itemJson` 变化）不重置当前页签；文档内容仍由 `refreshDrawer()` 既有的 render 后 `loadDoc(cur, false)` 回填（刷新时重新拉取保持新鲜，并更新缓存）。

### 区块迁移

- `info` pane：meta-grid、完善徽标、Agent 已上报 notice、操作 notice 与按钮行（上一条/下一条仍固定在操作行两翼、不进任何页签内容区，快捷键 ArrowLeft/Right 不变）、下属 Bug 列表、`batchSettingsHtml()`。
- `doc` pane：`#docView`（`loadDoc` 渲染 + `linkupDocDemo()` 接管演示链接，BUG-20260908-021 契约不动）。
- `disc` pane：`reqDiscussionsHtml()`（需求单为关联讨论旧绑定记录；Bug 单返回空态文案——Bug 无讨论绑定能力）+ 需求单的 `#reqDocDisc` 文档讨论挂载点（REQ-20260909-003，`ATBReqDisc.mount()` 按 id 定位、随主轮询刷新，与位置无关）。README 表格只列了 `reqDiscussionsHtml()`（撰写时快照早于 REQ-20260909-003 落地），实现把同属讨论纪要语义的文档讨论区块一并归入该页签，避免基本信息页签继续被拉长。
- 搜索命中文档条带（`loadDoc(hitDoc, true)`）保留：`setActive` 经 `activateDrawerTab` 切到对应文档页签。
- 「＋ 发起讨论」入口已随 REQ-20260909-004（讨论不再绑定需求）移除，不在本需求复活；空态文案沿用现有「新版讨论不绑定需求」指引口径。

### 样式（style.css）

- `.drawer-tabs`：头部下方独立页签栏（`flex-wrap: wrap`，窄屏换行无横向滚动），置于 `.tabs` 规则之后覆盖共享属性。
- `.drawer-tab:focus-visible`：可见焦点态（键盘 Tab 导航；button 原生支持 Enter/Space 激活）。

## 风险与边界

- 只改静态前端（app.js / style.css），不动 server、core、列表与抽屉外区域；讨论单（ASK）详情在 oncall.js，不受影响。
- 文档缓存生命周期 = 抽屉单次打开（openDrawer 重置）：满足「再次激活不重复请求」，条目刷新时仍重新拉取当前文档。
- 既有契约测试依赖 `renderDrawer` 内 notice→操作行、`.drawer-actions-center` 模板与 `openDrawer` 的 state 重置前缀，模板重组时保持原样（drawer-actions-row / drawer-nav / item-demo-link 回归）。
