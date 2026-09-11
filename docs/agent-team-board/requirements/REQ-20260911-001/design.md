# 设计 — REQ-20260911-001 修改需求的对话框改为使用侧拉框，参考新建条目界面

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`editItem`（卡片与详情共用，仅 submitted 可编辑）原经 `uiEditForm` 打开自绘居中弹窗
（`.modal-wrap.confirm-wrap` 全屏遮罩 + `.modal.confirm-box` 居中盒子）：先读 README 截取描述节、
再弹双字段表单，失败 toast 后不打开任何容器。与「＋ 新建」「项目管理」已迁移的右侧贴边侧拉面板
（REQ-20260910-014 `.side-panel`）形态不一致，且看板上下文被遮罩压暗。

## 方案

（技术选型、接口设计、影响面）

### 容器迁移（静态常驻节点，对齐「＋ 新建」）

- `scripts/web/index.html` 新增常驻 `#editModalWrap`（`.side-panel hidden role="dialog"`），置于
  `#projModalWrap` 之后（同 z-index 下 DOM 靠后者盖上层）；头部常驻（动态标题 `#editItemTitle`
  「编辑 <编号>」+ 说明 `#editScope` + ✕ `#editClose`），内容区独立滚动，三态切换：
  - `#editLoading`：读取中「正在读取描述…」；
  - `#editError`：读取失败或缺节（`#editErrorText` 原因 + `#editRetry` 重试 + `#editErrorClose` 关闭），
    不出现可提交的伪空表单（缺节不能当空描述覆盖文档）；
  - `#editForm`：标题（maxlength=120）→ 描述 textarea（Enter 换行）→ 反馈 `#editMsg`
    （role=status aria-live=polite）→ 取消 / 保存（type=submit）。
- `scripts/web/style.css` 仅补 `.edit-loading` / `.edit-msg`（含 .err）/ `.edit-error-text` 三条文案样式，
  颜色全走 CSS 变量；几何（宽度 `min(560px,92vw)`、≤640px 全宽、投影、深浅色）全部复用 `.side-panel`。

### 行为模块（app.js）

- 删除 `uiEditForm` + `promptActive`（居中编辑弹窗与同屏输入互斥旧机制整体下线；`uiConfirm`
  居中确认弹窗及其 `confirmActive` 保留）。新增 `editSide` 状态机（open / busy / id / project /
  heading / opener / origTitle / origDesc / seq）与 `editPanelOpen` / `openEditPanel` /
  `loadEditContent` / `closeEditPanel` / `submitEditPanel` / `setEditBusy` / `setEditView` / `editMsg`。
- `editItem(id, opener)`：仅 submitted 可开；`busy`（保存中）拒绝切换（toast 提示，不静默覆盖）；
  同条目重复点击幂等（不叠加、不重置草稿）；换条目重开并重新读取当前已保存内容。
- 项目与条目绑定：读取与保存请求均携带打开时快照的 `editSide.project` / `editSide.id`；`seq`
  在每次开 / 关时递增，异步回调先校验 token 再写 DOM——迟到响应不污染新面板（项目或条目切换安全）。
- 读取：面板先开（加载态，禁用表单与保存、保留关闭入口），完成后预填并聚焦标题；失败 / 缺节进
  错误态，可重试（重试即重新读取）或关闭。
- 校验与保存：空白标题、无变化在面板反馈区拦截（不发写请求、面板保持）；保存走既有
  `POST /api/item/:id/content`（标题与文档首行同步、描述整体替换「## 描述 / ## 现象」节，
  Bug 与需求共用同一编辑函数，节口径 `descHeadingOf` 不变）。保存中 `setEditBusy(true)` 禁用
  标题 / 描述 / 取消 / ✕ / 保存（按钮「保存中…」，防重复提交与误关闭）；失败恢复可编辑、
  反馈区显示错误、草稿保留可重试；成功关闭面板 → toast → `poll()` → 详情打开该条目时
  `refreshDrawer()`（详情保留）。
- 关闭：✕ / 取消 / Esc（Esc 链中编辑层位于详情抽屉之前，一次只关一层；保存中 Esc 被拦截），
  不发写请求；点击面板外不关闭（无遮罩）。焦点管理：`bindRenameButtons` 把入口按钮传入作为
  opener，关闭后焦点返回入口；入口被看板重渲染替换时按 `data-rename-id` 回落找回。
- 快捷键让位：`anyModalOpen` 纳入 `#editModalWrap`（`/`、`?`、方向键在面板打开时不响应）。

### 影响面

- `editItem` 增加 `opener` 参数（第二参，可缺省）；其余接口、权限、字段、状态规则不变。
- 既有契约测试迁移：edit-content / rename-reject 的 U2/U3（居中弹窗口径）改写为侧拉面板口径；
  shortcuts / new-shot-preview / impl-entry-ui 沙箱把 `#editModalWrap` 纳入初始隐藏桩；
  detail-close-btn T3 的 Escape→closeDrawer 字面窗口随链中新增一层放宽（行为不变）。

**开源选型（REQ-20260909-015）**：未引入开源库。本项是既有自研 SPA 内的容器形态迁移与交互收敛，
复用项目内已有 `.side-panel` 容器、字段样式与 `api()` 封装即可完成，无合适的外部 UI 依赖可引入
（引入组件库的改造成本高于在既有范式上迁移），故沿用自研。未使用开源库，不创建 licenses.md。

## 风险与边界

- 无全屏遮罩后面板打开期间主界面仍可点击：与其他侧拉面板现状一致（同屏多面板叠放按 DOM 序，
  Esc 按链逐层关闭）；保存中面板被锁定（busy 拒绝切换 / 关闭），不会静默覆盖未完成的写请求。
- 与新建 / 项目管理面板同时打开的草稿取舍策略属 README 待确认项：当前口径为「编辑面板不主动关闭
  其他面板，换条目重开即重新读取已保存内容；保存中拒绝切换」，后续裁定若要求草稿保留可再扩展
  `editSide` 草稿快照。
- 服务端无改动；旧版常驻服务对新前端无新增接口依赖（读取 / 保存接口均既有）。
