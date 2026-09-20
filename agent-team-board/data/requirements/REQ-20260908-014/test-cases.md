# 测试用例 — REQ-20260908-014 需求完善批次每一轮上报需在主调度会话中显示单号和标题

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 数据层（R11）：done 回执含 itemId 与 title（=条目标题） | P0 | ✅ |
| 2 | 数据层（R11）：failed 回执含 title；check.current 与 records 记录均含 title | P0 | ✅ |
| 3 | 数据层（R11）：条目被删除后 records.title 为 null 不报错；回执/check 载荷 ≤2048 字节 | P1 | ✅ |
| 4 | CLI（R10 追加断言）：`refine done` 输出的回执 JSON 行含 `"title":"…"`（与条目标题一致） | P0 | ✅ |
| 5 | 回归：refine-store / refine-cli / refine-serve 既有用例全部保持通过 | P1 | ✅ |

> 执行记录：先写 R11 与 R10 追加断言跑红（回执无 title），实现后跑绿；
> 全量 `node scripts/tests/run-all.mjs` 87 个测试文件失败 0（首轮 impl-scope 偶发超时失败，
> 单独复跑与全量复跑均通过，与本改动无关）。
