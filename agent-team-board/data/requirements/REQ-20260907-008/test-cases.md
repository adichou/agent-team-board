# 测试用例 — REQ-20260907-008 讨论视图精简：删除头部说明区，状态筛选与需求栏样式统一并去掉「全部」

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 静态契约：oncall.js 无头部（oncall-head / 新建讨论单 / #ocNew 均不出现）；style.css 无 .oncall-head / .oc-filter 死规则 | P0 | 通过 |
| T2 | 行为：渲染后无「全部」chip，缺省选中「待回复」（filter-chip active），chips 为 filter-chip + filter-count 结构，计数正确 | P0 | 通过 |
| T3 | 行为：存在失败单时渲染「失败」filter-chip（带 oc-failed 修饰与计数）；无失败单时不渲染 | P1 | 通过 |
| T4 | 行为：列表按当前筛选档过滤（无 all 分支）；零条目空态文案指向顶栏「＋ 新建」 | P0 | 通过 |
| T5 | 回归：req-filter-removed T5 断言随契约更新（oc-filter → filter-chip）；oncall-ui / 需求栏筛选相关测试全绿 | P0 | 通过 |

实现文件：`scripts/tests/oncall-view-lean.test.mjs`（T1–T4）；
`scripts/tests/req-filter-removed.test.mjs` T5 同步更新断言。
