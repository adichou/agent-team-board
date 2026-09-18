# BUG-20260911-009 禁用态按钮无视觉反馈，点击看似无响应（如批量开发「启动新一轮」）

- 状态：accepted
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260909-011（终态「启动新一轮」引入「无候选时禁用按钮」设计，style.css 未同步补通用 `.btn:disabled` 禁用态视觉）
- 创建：2026-09-11T09:41:56.268Z

## 现象

批量开发面板批次已结束（如 batch-20260908-011，remaining 0）时显示「启动新一轮」按钮；当看板没有已计划（planned）候选时，该按钮被渲染为 `disabled`，但**外观与可点击按钮完全一致**——不透明、指针光标正常。点击后无任何反馈：禁用的原生 button 不触发 JS、不弹 toast，唯一线索是悬停时出现的 title 提示「暂无已计划候选：请先在看板接受条目并「移入计划」」。用户感知为「点了没反应」，误以为功能坏了。

## 复现步骤

1. 看板条目中没有任何 planned 状态条目（`atb list --json` 核验，或看板已计划列空）；
2. 打开 Status Board → 任务模块 → 批量开发面板：存在一个已结束批次（当前项目为 batch-20260908-011）；
3. 概况页签底部出现「启动新一轮」按钮（`#batchNext`，`app.js` 渲染逻辑：`nextDisabled = plannedQueue().length === 0`）；
4. 点击按钮：无 toast、无跳转、无任何反应；悬停可见 title 提示。

根因侧佐证：`scripts/web/style.css` 中只有 `.sel-group .btn:disabled`、`.card-accept-btn:disabled`、`.shot-x:disabled` 等个别上下文的禁用样式，**没有通用的 `.btn:disabled` 规则**，任务面板内的 `.btn` 被禁用时样式不变。

## 期望行为

- 被禁用的 `.btn`（含 `.btn.primary` 等变体）有明确禁用态视觉：半透明（opacity 降低）+ `cursor: not-allowed`；
- 禁用态样式全局生效（通用规则），同时不回退现有各上下文的专属禁用样式（`.sel-group`、卡片按钮、`.shot-x`、`.refine-badge` 等）；
- 主操作按钮（如「启动新一轮」「启动」）被禁用时，面板内有可读文字说明原因，而不只依赖悬停 title（可选增强）。

## UI 说明（界面布局 / 交互行为 / 状态反馈）

本 Bug 修复涉及界面（`scripts/web/style.css` 补通用 `.btn:disabled` 禁用态视觉；`scripts/web/app.js` 界面结构不变），对照说明如下。

### 界面布局

- 触发界面为 Status Board → 任务模块 → 批量开发面板「概况」页签（`renderZcodeBatchPanel`，`scripts/web/app.js`）：批次状态行（状态 chip + 批次号 + 模式/创建时间）→ 提示条（`notice ok`「本批范围已处理完毕」）→「启动新一轮」按钮行（`drawer-actions batch-actions`，按钮 `#batchNext`，样式 `btn primary`）→ 元信息网格（meta-grid：当前条目 / 子代理会话 / 开始时间 / 耗时 / 最后活动）→ 处理统计行。
- 修复不改布局结构，仅改变按钮禁用时的视觉呈现；若实现「可选增强」（禁用时面板内可读原因文字），原因文字就近显示在按钮行下方，不新增页面区块。

### 交互行为

- 现状（缺陷）：按钮 `disabled` 时外观与可点击态完全一致（`style.css` 无通用 `.btn:disabled` 规则，仅有 `.sel-group .btn:disabled`、`.card-accept-btn:disabled`、`.shot-x:disabled`、`.refine-badge:disabled` 等个别上下文规则）；点击被浏览器静默吞掉——不触发 click、无 toast、无跳转，唯一线索是悬停 title。
- 修复后：禁用按钮呈半透明（opacity 降低）+ `cursor: not-allowed`；点击同样不触发任何动作（禁用语义不变），但视觉上一眼可辨「不可点」；hover title 保留。
- 同口径受影响按钮（均按「禁用 + title 说明」渲染）：`#devStart`（批量开发启动）、`#refineNext`（批量完善「启动新一轮」，title「暂无可完善候选：已接受条目均已完善（或尚无已接受条目）」）、`#commitNext`（批量 Commit「启动新一轮」，title「暂无已完成候选：请先人工确认条目完成（done）」）。

### 状态反馈

- 正常（有已计划候选）：按钮可点，点击后走「创建任务 + 复制调度提示词」流程（现有 toast 反馈），本 Bug 不涉及该路径。
- 空态（无已计划候选）：按钮禁用；缺陷态无任何视觉反馈（仅悬停 title「暂无已计划候选：请先在看板接受条目并『移入计划』」）；修复后半透明 + not-allowed 光标，就近展示原因文字，不再只依赖悬停 title。
- 加载中：面板数据未就绪时显示「加载中…」占位（`app.js` 既有行为，与本次修复无关）。

## 界面展示

可交互演示（单文件、无外网依赖、浏览器直接打开）：**[ui-demo.html](./ui-demo.html)**

- 界面布局：按 `app.js`「概况」页签真实结构复刻的演示面板（批次状态行 / 提示条 / 「启动新一轮」按钮行 / 元信息网格 / 统计行），按钮配色取自 `style.css` 同源变量。
- 交互行为：「缺陷现状 / 修复后」模式开关对照——空态下同一颗「启动新一轮」按钮，缺陷模式外观与可点击完全一致、点击毫无反应；修复模式半透明 + not-allowed 并就近显示禁用原因。演示含「按钮区按压（pointerdown）/ 按钮 click」双计数对照，直观呈现「确实点了、但事件从未触发」。
- 状态反馈：可切换「加载中 / 正常（有候选）/ 空态（无候选）」三种面板状态；正常态点击按钮弹出 toast；空态禁用静默（禁用语义不变）；附同口径受影响按钮（`#devStart` / `#refineNext` / `#commitNext`）与既有上下文禁用样式样例（`.sel-group .btn:disabled` 等，修复不得回退）。
- 深浅色：跟随系统 `prefers-color-scheme`（配色取自 `scripts/web/style.css`）。

## 验收标准

1. 复现步骤场景下，「启动新一轮」按钮呈明显禁用态（半透明 + not-allowed 光标）；
2. 悬停 title 提示保留不回退；
3. 其他已知禁用场景（暂无已计划候选时的「启动」`#devStart`、批量完善无候选时的「启动新一轮」`#refineNext`、批量 Commit 同口径按钮）同样获得禁用态视觉；
4. 现有 `.sel-group .btn:disabled` 等上下文样式不回退（既有测试通过）；
5. 新增样式有对应前端桩测试覆盖（沿用 scripts/tests 的 vm 桩测试模式）。
