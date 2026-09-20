# 测试用例 — REQ-20260910-008 选择区域布局优化

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/caption-toolbar-20260910-008.test.mjs`（L1–L6）；
> 被本需求取代的旧结构契约（两行列表头）在 caption-two-row-20260909-009 / selection-bar-merge /
> lane-quick-entry-20260909-007 / selection-lane-scope 内同步改写，行为断言保留。
> 浏览器目检（宽窄屏换行、四态观感）走条目目录 ui-demo.html 离线人工验收（L6 覆盖离线自包含）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1 | 静态单行工具栏：#reqCaption 单容器内左起 排序→全选→全不选→右组(#selGroup)→快捷入口(#laneQuickEntry)；无 #selectRow/.caption-info/.caption-select；#reqCount 保留为条件提示且初始 hidden，页面无静态「个条目」文案 | 高 | 通过 |
| L2 | CSS 契约：.req-caption 单行 flex + wrap（不再 column）；无 .caption-row 残留规则；#laneQuickEntry margin-left:auto 靠右；.sel-group 保留 wrap 且无 margin-left:auto（选择区连续、快捷入口才靠右） | 高 | 通过 |
| L3 | 计数提示语义：普通档（无搜索、无截断）#reqCount 隐藏且无文案；已完成截断档显示「N / M 个条目」+ 搜索引导；搜索结果已到显示「搜索命中 N 项」且不含「个条目」；关键词已输结果未到不显示提示（全量不误称命中） | 高 | 通过 |
| L4 | 按档显隐与零跳变：三个选择档全选/全不选可见，勾选首项右组出现、清零消失（同显隐口径，无空占位）；开发中/待测试/已完成两按钮与右组均隐藏，无 #selectRow 空行；快捷入口仅已接受/已计划可见 | 高 | 通过 |
| L5 | 交互语义不回退：全选仅当前档叠搜索范围、全不选仅清当前档、切档保留其他档勾选；批量进行中全选/全不选禁用；排序控件五选项与绑定不动 | 高 | 通过 |
| L6 | ui-demo.html 离线自包含：存在于条目目录，无外链 script/link/资源引用；覆盖六档、排序、选择与批量动作、快捷入口、正常/空/加载/失败四态与宽窄屏换行演示 | 中 | 通过 |
