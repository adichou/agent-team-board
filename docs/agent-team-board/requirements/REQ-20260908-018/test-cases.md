# 测试用例 — REQ-20260908-018 已接受列表要要支持批量移入计划

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 静态契约：#selectionBar 有 #planAdd「移入计划」按钮；已接受行渲染 data-plan-id 复选框，待接受/已计划/开发中行不渲染；selectOperable title 覆盖「已接受」 | P0 | ✅ |
| 2 | 复选框交互：点击不冒泡打开详情；change 增删 state.plan.selected；pending 时禁用 | P0 | ✅ |
| 3 | 工具条合并计数升级：勾选后显示「已选 N 项（待接受 X · 已接受 Y · 已计划 Z）」；#planAdd 随已接受勾选数显示（N）并在 0 时禁用 | P0 | ✅ |
| 4 | 批量移入计划：二次确认一次（含条数与单号）；逐条 POST /api/item/<ID>/status {to:'planned'} 且绑定当前项目；完成反馈「成功 N 条」 | P0 | ✅ |
| 5 | 资格过滤：待接受/已计划/开发中单混入 moveToPlan 不发请求并提示无可移入条目；重复 id 去重 | P0 | ✅ |
| 6 | 取消确认不发任何请求；pending 期间防重入 | P1 | ✅ |
| 7 | 单项失败不回滚：某条 POST 失败进 failures，成功计数与其余成功单不受影响，结果区分列呈现 | P1 | ✅ |
| 8 | 轮询剪枝：勾选单离开已接受状态后 syncPlan 自动移出勾选并 toast；切档不清空勾选（跨档保留） | P1 | ✅ |
| 9 | 选择可操作项/清空选择：已接受档全选本档可见已接受条目；其他档不回退；清空选择同时清空已接受勾选；切换项目重置已接受勾选 | P1 | ✅ |

> 用例 1-9 的自动化实现：`scripts/tests/plan-batch-move.test.mjs`
> （vm 模拟 DOM 模式，沿用 accept-ui / planned-state 前端测试脚手架）。
> 服务端 accepted→planned 边、守卫人工专属、批次实时队列拾取后置计划单
> 分别由既有 planned-state.test.mjs S1/S4/S6/S7 覆盖，本需求不重复建设。
