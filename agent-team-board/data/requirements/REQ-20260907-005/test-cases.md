# 测试用例 — REQ-20260907-005 待确认改为待测试。已完成界面去掉待确认按钮。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 改名契约：LANE_LABEL/筛选档文案 confirming 为「待测试」，STATE_LABEL 状态机文案不回归 | P0 | ✅ |
| T2 | 列表行：上报未确认（in-progress+agentCompletedAt）状态标签显示「待测试」，tooltip 为等待人工测试语义 | P0 | ✅ |
| T3 | 已完成列表行：done+agentCompletedAt 不渲染「待测试」角标（无 class="flag" 非 warn 角标） | P0 | ✅ |
| T4 | 详情页头部：done 条目无「待测试」角标、无「⚑ Agent 已上报完成…请人工测试」notice；上报未确认条目两者保留 | P0 | ✅ |
| T5 | 详情页下属 Bug：done Bug 无角标，上报未确认 Bug 显示「待测试」角标 | P1 | ✅ |
| T6 | 全量回归：confirm-lane / workbench-layout / detail-close-btn 及 npm test 全套通过 | P0 | ✅ |

说明：T1–T5 落在 scripts/tests/confirm-lane.test.mjs（T1/T3(旧)/T6(旧) 为 REQ-20260906-013
既有用例的断言更新），T2/T4/T5 为本条目新增；workbench-layout W5、detail-close-btn T1
为受影响既有断言的文案同步。T6 由 npm test 聚合回归。
