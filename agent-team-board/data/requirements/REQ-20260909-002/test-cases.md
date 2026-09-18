# 测试用例 — REQ-20260909-002 列表头与批量操作条合并为单行：去清空选择、文案精简

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 新增用例 M1–M9 落在 `scripts/tests/selection-bar-merge.test.mjs`（vm 模拟 DOM + 静态契约，沿用
> selection-lane-scope / accept-ui 模式）；REQ-20260908-027 既有用例（S/U/E 系列）中文案与结构断言随
> 本需求契约同步更新（旧「已选 N 项（档位）」「移入计划（N）」「#selectionBar」「#clearSelection」断言改写）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| M1 | 静态契约：合并行 `.req-caption` 内左组含 `#reqCount`/`#reqSort`/`#selectOperable`/`#selectNone`，右组 `#selGroup` 带 `role="group"` 与 `aria-label="批量操作"`；`#acceptResult` 位于合并行之后；页面无 `#selectionBar`、无 `#clearSelection`；CSS 删除 `.selection-bar` 规则，`.req-caption`/`.sel-group` 均允许换行（flex-wrap: wrap） | 高 | 通过 |
| M2 | 右组显隐：当前档勾选数 > 0 时右组出现；当前档清零后右组隐藏（分隔线随右组，无空占位）；开发中/待测试/已完成档即使其他档有勾选也不出现右组 | 高 | 通过 |
| M3 | 计数文案：右组计数为「已选 M 项」，不含档位括号；切档只显示当前档勾选数（其他档选择保留但不计数） | 高 | 通过 |
| M4 | 动作文案：五个动作按钮静止文案为「接受所选 / 移入计划 / 驳回待接受 / 进入批量开发 / 移出计划」，均无「（N）」数量后缀；批量进行中分别显示「接受中… / 移入中… / 驳回中… / 移出中…」 | 高 | 通过 |
| M5 | 去清空选择：`index.html`/`app.js`/`style.css` 均无 `clearSelection` 入口；清除选择统一走 `deselectOperable()`（仅清当前档，其他档保留） | 高 | 通过 |
| M6 | 按档动作显隐不回退：待接受→接受所选；已接受→移入计划+驳回待接受；已计划→进入批量开发+移出计划；互不串档 | 高 | 通过 |
| M7 | 结果区独立：`#acceptResult` 在合并行下方按档显示批量进度/成功数/失败清单；右组因零选择隐藏时结果区仍可读 | 中 | 通过 |
| M8 | 计数更新不重建列表头：勾选/切档/轮询同步多次后合并行容器内容不被重写（无 innerHTML/replaceChildren 触碰，焦点不丢） | 中 | 通过 |
| M9 | 选择入口可用性不回退：当前档无可操作候选禁用全选；当前档 0 勾选禁用全不选；批量进行中两者均禁用 | 中 | 通过 |

既有用例回归：selection-lane-scope（S 系列）、accept-ui、impl-entry-ui（E/N 系列）、plan-batch-move（U 系列）、batch-ui、refine-ui 已随本需求契约更新并通过；`npm test` 全量 104 个测试文件失败 0。
