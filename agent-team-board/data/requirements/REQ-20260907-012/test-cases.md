# 测试用例 — REQ-20260907-012 已接受的需求或 Bug 不要在列表界面或详细内容界面显示已接受便签，应呈现是否已进入批次

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1 | 已接受且入批（未结束批次 candidates 含该编号）：列表卡片不出现「已接受」chip，显示「已入批次」，title 含批次号与批次状态 | P0 | 通过 |
| L2 | 已接受且未入批：列表卡片显示「未入批次」，不出现「已接受」chip；`batchEntry` 字段缺失时同样兜底为「未入批次」 | P0 | 通过 |
| L3 | 非已接受条目（待接受/开发中/待测试/已完成）卡片状态 chip 不受影响 | P0 | 通过 |
| L4 | 详情抽屉：已接受条目「状态」字段显示「已入批次/未入批次」而非「已接受」；已入批悬停含批次号 | P0 | 通过 |
| L5 | 详情抽屉操作说明 notice 不再以「已接受。」开头；入批→提示等待批次派发（含批次号），未入批→提示 /dev 认领或勾选入批 | P1 | 通过 |
| L6 | 列表渲染签名包含 batchEntry：入批/出批后轮询重绘（源码级断言） | P1 | 通过 |
| S1 | `batchEntryIndex`：入未结束批次→返回 {batchId,status}；未入批→无条目；批次 finished→不再计入；多批次取最早 | P0 | 通过 |
| S2 | `/api/board` 与 `/api/item/:id`：accepted 条目附带 batchEntry（未入批为 null）；in-progress 条目不附带 | P0 | 通过 |

- 前端用例（L1–L6）：`scripts/tests/accepted-batch-entry.test.mjs`（vm 沙箱，card-flag-dedup.test.mjs 同法）。
- 服务/数据用例（S1–S2）：同文件内集成段（真实起 server + 临时项目，multi-project.test.mjs 同法）。
- 回归：`npm test` 全量 73 个测试文件 0 失败（含 card-flag-dedup、pending-alignment、confirm-lane、workbench-layout 等 UI 契约）。
