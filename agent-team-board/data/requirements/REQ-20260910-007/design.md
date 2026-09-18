# 设计 — REQ-20260910-007 支持快捷键

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`app.js` 已有 document 级 keydown 匿名处理器：ArrowLeft/Right 切换详情抽屉（REQ-20260901-001，
冻结范围、边界不循环）与 Escape 关闭链（REQ-20260910-005 项目管理 > 新建弹窗 > 抽屉）；
搜索框 `#searchInput` 在第三行 `.module-search` 内（设置模块隐藏）。本单补全 `/`、`?` 两个单键
与帮助面板、Tab 焦点圈定，统一守卫口径（输入态 / 组合输入 / 弹窗 / 长按重复 / 修饰键），
并保证单次按键只触发一次。四态（正常/空/加载/失败）交互演示见条目 `ui-demo.html`。

## 方案

**键位与页面覆盖（README「待确认」结论）**

- 键位即 README 交互契约表：`/` 聚焦当前模块搜索框、`?` 开帮助、`←/→` 详情导航、`Esc` 关最上层、
  `Tab/Shift+Tab` 沿用原生顺序（帮助模态内圈定）。不做自定义键位。
- 覆盖范围 = 看板单页 `scripts/web/index.html`（讨论/需求/任务/全局/文件/设置共用顶栏与搜索行）；
  讨论模块内嵌同一页面，当前无独立 oncall 页面需要覆盖；不做桌面原生全局快捷键
  （Electron 壳沿用网页内行为，不注册全局热键）。

**实现（原生 DOM，无新依赖）**

- 既有匿名 document keydown 处理器收敛为具名 `onGlobalKeydown`（document 冒泡阶段、全页唯一
  注册点 → 单次按键只触发一次；按键入口与按钮入口复用同一组函数，无第二套逻辑）。
- 守卫顺序：Ctrl/Meta/Alt 组合键直接放行（不拦截浏览器默认）→ 帮助模态态（Tab 圈定 / Esc 顶层
  关闭 / 其余键不响应）→ `e.repeat || e.isComposing` 忽略（长按不连发、组合输入不触发）→
  输入态让位 `isEditableTarget`（INPUT/TEXTAREA/SELECT/contenteditable，不 preventDefault，
  字符照常上屏不吞）→ 弹窗让位 `anyModalOpen()`（#modalWrap / #projModalWrap / .confirm-wrap
  动态确认与编辑弹层）。
- `/`：无弹窗 + 非输入态 + 搜索入口可用（`#pageHead .module-search` 未隐藏——设置模块隐藏搜索）
  → preventDefault + 聚焦 `#searchInput`（preventDefault 保证 `/` 不落入输入框）。
- `?`：同守卫 → `openShortcutHelp()`；面板节点常驻 `index.html`（#shortcutHelpWrap，role=dialog
  aria-modal），打开时记录 `document.activeElement` 为入口，已开直接 return（重复按键不叠加面板），
  焦点进入面板关闭按钮；关闭恢复入口焦点，入口已脱离 DOM（isConnected）时回落帮助按钮。
- Tab 圈定：帮助开启时 `trapShortcutHelpFocus`（面板首/末可聚焦元素回绕，Shift 反向）；面板头部
  常驻关闭按钮，窄屏整体滚动（max-height + overflow）时头部 sticky，关闭按钮始终可达。
- `←/→`：沿用既有 `navDrawer`（冻结范围 navIds、边界停止不循环）；守卫从仅 #modalWrap 扩到
  `anyModalOpen()` + repeat / IME / 修饰键；抽屉导航按钮 title 与 aria-keyshortcuts 标注方向键，
  首尾禁用提示「已是第一条 / 最后一条」。
- `Esc`：帮助（新最上层）→ 项目管理 → 新建弹窗 → 抽屉，一次只关一层；uiConfirm / uiEditForm /
  文档右键菜单 / 讨论灯箱各自 capture 级 Escape 原样保留（未保存保护沿用原规则）。
- 加载与失败：沿用现状（列表由轮询驱动、抽屉加载失败 toast 后关闭、聚合失败保留旧数据 + 重试
  提示），方向键依赖 `state.board.items` 存活集合，不导航至无效条目；四态反馈在 ui-demo.html 演示。
- 快捷键只触发现有界面入口对应行为（聚焦 / 开面板 / 导航 / 关闭），处理器内不发业务请求，
  不直接接受、计划、删除条目或启动批次。

**开源选型（REQ-20260909-015）**：未引入开源库。理由（引入成本高于自研）：需求仅为 5 类浏览器内
单键 + 焦点圈定，原生 KeyboardEvent 即可完整实现；mousetrap / hotkeys-js 等库的核心收益
（组合键 DSL、序列键）与本需求不匹配，且需与既有分层 Escape 链（右键菜单 / 确认弹层 / 搜索框
各自的 capture 或 stopPropagation 处理）重新整合优先级，成本高于自研。未使用开源库，不创建
licenses.md。

**影响面**：`scripts/web/index.html`（顶栏帮助按钮、搜索框 `/` 提示、#shortcutHelpWrap 面板节点）、
`scripts/web/app.js`（onGlobalKeydown 收敛 + 帮助面板开关 / 焦点圈定 + drawerNavBtn 标注）、
`scripts/web/style.css`（.kbd-hint / .shortcut-help / 键盘焦点样式）。服务端与 oncall.js 零改动。

## 风险与边界

- 单次按键执行两次：全页唯一 keydown 注册点（具名函数替换旧匿名处理器）；`?` 按键与帮助按钮
  click 汇入同一 `openShortcutHelp` 已开守卫。
- 长按连发：`/ ? ← → Esc` 均忽略 `e.repeat`（Tab 圈定对 repeat 保持圈定，避免原生焦点外逸）。
- 既有 Esc 优先级回归：impl-entry-ui E10 以源码切片驱动该处理器——实现保持「注册语句在绑定区、
  依赖函数定义在绑定区之前」的源码结构；该切片测试补 #shortcutHelpWrap 初始隐藏桩（对齐
  index.html 初始态）。
- 中文输入法：`isComposing` 期间不触发；组合输入中的 `/` `?` 正常上屏（输入态让位不 preventDefault）。
- 帮助面板与既有弹窗互斥：`?` 仅在无其他弹窗时打开；帮助开启期间其余单键不响应，Esc 先关帮助。
