# 测试用例 — REQ-20260910-011 去掉接受、驳回待接受和加入计划，移出计划等二次提示框，意义不大，因为可以撤销

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/no-confirm-undo-20260910-011.test.mjs`（N1–N9）；M1 为内置浏览器人工核验。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| N1 | 静态契约：acceptItems / moveToPlan / rejectToSubmitted / removeFromPlan 四函数零 `uiConfirm` 调用、无 `skipConfirm` 参数；deleteItem 保留 `uiConfirm` + `danger: true` | 高 | 通过 |
| N2 | 单条接受（卡片/详情入口 `acceptItems([id], { single: true })`）：零确认、立即 POST `{to:"accepted"}`；toast「✓ {单号} 已接受」带「撤销」按钮，点击 POST `{to:"submitted"}`（驳回接受）并提示已撤销 | 高 | 通过 |
| N3 | 批量接受（工具栏入口）：零确认、逐条 POST；toast 为「接受完成：成功 X 条，失败 Y 条」批量文案且无撤销按钮 | 高 | 通过 |
| N4 | 批量移入计划 / 驳回待接受 / 移出计划：零确认立即逐条 POST（to=planned/submitted/accepted），进行中进度与完成文案、资格过滤口径不变 | 高 | 通过 |
| N5 | 单条移出计划（详情入口 `removeFromPlan([id], { single: true })`）：toast「✓ {单号} 已移出计划」带撤销，点击 POST `{to:"planned"}`；撤销失败（服务端拒绝）错误 toast 不假成功 | 高 | 通过 |
| N6 | 驳回接受单条（drawerAction → submitted）：ACTION_UNDO 增加 `submitted → accepted` 且为 TRANSITIONS 合法边；toast 带撤销，点击重新接受 | 高 | 通过 |
| N7 | drawerAction accepted 分支：planned 来源走 `removeFromPlan([id], { single: true })`、submitted 来源走 `acceptItems([id], { single: true })`（静态） | 高 | 通过 |
| N8 | 删除防回归：deleteItem 仍弹 danger 确认，标题含单号、正文含条目标题与不可恢复说明；取消零 DELETE、确认后 DELETE；成功 toast 无撤销按钮 | 高 | 通过 |
| N9 | 其余确认框零回归（静态）：deleteBatchById / abortRefineTask / abortDevTask / #cxStopCurrent 停止执行 / 项目面板移出项目与批量移出不存在目录的确认入口保持 | 高 | 通过 |
| M1 | 人工核验：看板实际点击四操作无弹窗、误操作可撤销/反向回退；删除弹窗内容与取消路径 | 中 | 待人工 |
