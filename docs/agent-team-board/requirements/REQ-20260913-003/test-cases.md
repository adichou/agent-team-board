# 测试用例 — REQ-20260913-003 批量任务去掉批次概念，每次启动到结束就实时执行当前的任务

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化用例落盘 scripts/tests/realtime-round-20260913-003.test.mjs（RT-* 编号对应）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| RT-01 | 启动不冻结候选：createBatch 建轮后账本 candidates 为空（显式 ids 仅作队首种子）；nextItem 领取时实时吸收全部已计划条目（最旧优先） | 高 | 通过 |
| RT-02 | 实时队列：启动后新「移入计划」条目，下一次 next 立即可领取，无需任何并入操作；batchSummary/check 的待处理队列实时包含新条目 | 高 | 通过 |
| RT-03 | 重复启动拒绝：已有未结束轮次（待启动/执行中/暂停）时 createBatch 抛「已有进行中的任务」明确提示，且不产生新账本对象；空转账本就地收尾不阻塞新启动 | 高 | 通过 |
| RT-04 | 实时队列取空即本轮结束：checkBatch 在队列取空时 stop=finished，不再携带 nextBatch 排队接续 | 高 | 通过 |
| RT-05 | 调度提示词去批次：generatePrompt / buildRefinePrompt 不含「批次」「batchId」「--batch」及接续说明；含实时取单指令（最旧优先、队列取空结束） | 高 | 通过 |
| RT-06 | 存量冻结提示词展示归一：normalizePromptForDisplay 把「批次：…」「完善批次：…」「批次摘要入口 --batch」「nextBatch 接续」「完善批次：RFB-…」行归一为无批次口径，对新版生成输出幂等 | 中 | 通过 |
| RT-07 | refine 实时队列：createRefineBatch 建轮不冻结（candidates 空）；启动后新接受条目下一次 refine next 立即可领取；重复启动被拒 | 高 | 通过 |
| RT-08 | 服务端响应去批次号：/api/batch/create、/api/batch/current、/api/batch/prompt、/api/refine/create、/api/refine/current、全局简报不含 batchId；/api/batch/current 无 queue 字段；/api/board 不再附加 batchEntry | 高 | 通过 |
| RT-09 | 前端静态契约：app.js 无批次号渲染（概况 cid 批次号、排队批次节、排队新批次、删除本批次、已入批次、全局视图批次号均移除）；index.html 全局搜索占位无「批次号」 | 高 | 通过 |
| RT-10 | 既有能力不回归：暂停后续领取 / 恢复 / 终止（剩余项出局、记录保留）/ 重新执行 / 本轮处理记录在无批次概念下照常工作 | 高 | 通过 |
