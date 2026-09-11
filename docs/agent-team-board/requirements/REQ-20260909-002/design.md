# 设计 — REQ-20260909-002 列表头与批量操作条合并为单行：去清空选择、文案精简

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

Status Board 需求列表勾选条目后，独立批量操作条（`#selectionBar`）与列表头（`.req-caption`）上下排列重复占高；「清空选择」与「☐ 全不选」功能重复；计数显示两遍（`已选 N 项（档位）` + 按钮「（N）」后缀）。

## 方案

（技术选型、接口设计、影响面）

### 结构（scripts/web/index.html）

- 删除独立 `#selectionBar` 与「清空选择」按钮；`.req-caption` 升级为合并列表头 `#reqCaption`，内部分两组：
  - 左组 `.caption-left`：条目计数 `#reqCount`、排序 `#reqSort`、成对入口 `#selectOperable` / `#selectNone`（保持 REQ-20260908-027 语义：仅当前筛选档、叠搜索范围）。
  - 右组 `#selGroup`（`role="group" aria-label="批量操作"`）：竖分隔线 `.caption-divider`（组内首元素，`aria-hidden`，随组显隐）+ 计数 `#selCount` + 当前档动作按钮（`#acceptSelected` / `#planAdd` / `#planReject` / `#implGo` / `#planRemove`，按档显隐逻辑不变）。
- `#acceptResult`（`role="status" aria-live="polite"`）独立位于合并行下方，进度/结果不塞入合并行。

### 行为（scripts/web/app.js）

- `syncAcceptance`：`#selectionBar` → `#selGroup`；右组在当前档选中数 >0 时显示、零选择整体隐藏（分隔线随之，无空占位）；开发中/待测试/已完成档 `LANE_SELECTION` 无映射 → 恒隐藏。
- 文案精简：`#selCount` 统一 `已选 M 项`（去档位括号）；五个动作按钮静止文案无「（N）」数量后缀，进行中仍显「接受中… / 移入中… / 驳回中… / 移出中…」；确认弹窗与进度/结果中的必要数量保留；`#implGo` 的 title 提示保留（0 勾选默认范围语义）。
- 删除 `clearSelections()` 与其事件绑定——清除选择统一走 `deselectOperable()`（仅清当前档，其他档保留）。
- 计数与按钮同步仍只更新控件属性（textContent/disabled/classList），不重建列表头 DOM（renderBoard 中 `#reqCount` 亦仅改文本），勾选/轮询不导致焦点丢失或闪烁。

### 样式（scripts/web/style.css）

- 删除 `.selection-bar` 系列规则（含 `#clearSelection` 的 `margin-left:auto`）。
- `.req-caption` 与 `.sel-group` 均 `display:flex; flex-wrap:wrap`：充足宽度两组同行、右组 `margin-left:auto` 靠右；窄屏右组整体换到下一行、组内按钮继续换行，不产生横向滚动/裁切（390px 视口可容纳，无固定宽度）。
- `.sel-group .btn` 沿用原工具条小尺寸（padding 4px 10px / 12px）；`.sel-count` 主题色计数保留。

### 影响面

- 仅前端三文件 + 既有测试契约更新；批量流转、二次确认、资格过滤、按档隔离、结果反馈、完善中拦截等服务端与状态机行为不变。

## 实施记录（2026-09-09，zcode-batch-019-01）

- TDD：test-cases.md 补 M1–M9 用例，新增 `scripts/tests/selection-bar-merge.test.mjs`（vm 模拟 DOM + 静态契约）先跑红（6/9 红）→ 实施上述三文件改动 → 跑绿 9/9。
- 既有契约同步更新（REQ-20260908-027 起的旧断言随本需求演进）：
  - `selection-lane-scope.test.mjs`：S1/S2/S3 改断言 `#selGroup` 与「已选 M 项」；S8 改为「清空选择入口移除 + 全不选仅清当前档」；S10 去掉 `#clearSelection` 禁用断言。
  - `accept-ui.test.mjs` A1：`#selGroup` 显隐 + 无括号计数。
  - `impl-entry-ui.test.mjs`：E1 `selectionBar`→`selGroup`；E3/E6/N1 计数断言去括号。
  - `plan-batch-move.test.mjs`：U3 计数/按钮文案；U9 去 clearSelections 段。
  - `batch-ui.test.mjs` U1、`refine-ui.test.mjs` R12-1：`#selGroup` 替代 `#selectionBar` 正则。
- 验证：`npm test` 全量 104 个测试文件失败 0；`node --check app.js` 通过；index.html div 配对完整、无 `selectionBar`/`clearSelection` 残留。

## 风险与边界

- 已计划档 0 勾选时「进入批量开发」随右组隐藏（需求明确右组零选择整体隐藏）；0 勾选进默认范围的函数行为保留，任务模块入口不受影响。
- 窄屏断点未取固定值，按内容容纳自然换行（README 口径）；如后续需收紧再按 /bug 登记。
