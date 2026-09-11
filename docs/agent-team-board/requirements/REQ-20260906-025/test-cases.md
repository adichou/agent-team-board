# 测试用例 — REQ-20260906-025 批次排队：执行中可继续创建新批次，结束后自动接续下一批

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现文件：`scripts/tests/batch-queue.test.mjs`（core/serve/cli/ui 均在本文件覆盖）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| Q1 | core：A 未结束时创建 B 入队（created=true、queued=true、queuePosition=2），B 冻结创建时候选，A 候选不变 | P0 | 通过 |
| Q2 | core：队尾幂等——A 执行中重复创建且候选一致时返回同批不新建（created=false、queued=true、queuePosition）；候选变化（新接受条目）时不命中幂等，允许再排 C（FIFO：A→B→C） | P0 | 通过 |
| Q3 | core：无排队不回归——无未结束批次时创建 created=true 且 queued 不为 true；全结束时 batchSummary 缺省回退最新批次（已结束面板语义不变） | P0 | 通过 |
| Q4 | core：queueHeadBatch 返回最早未结束批次；nextItem 对非队首批次抛「排队中，不得抢先领取」；前序批次收尾后可正常领取 | P0 | 通过 |
| Q5 | core：A 收尾（remaining=0）后 checkBatch(A) 返回 stop 且携带 nextBatch（B 的 batchId）；pauseRequested 的 stop 不带；无排队时不带 | P0 | 通过 |
| Q6 | core：generatePrompt 含自动接续说明（stop 且带 nextBatch 时同一会话换批次继续） | P1 | 通过 |
| Q7 | core：创建时把「无在途且无待处理」的旧未结束批次就地收尾，幂等不被旧空批卡死 | P1 | 通过 |
| Q8 | serve：/api/batch/current 返回 queue（升序、含队首、不含 prompt）；/api/batch/create 排队创建响应带 queued/queuePosition | P1 | 通过 |
| Q9 | cli：排队创建输出「已加入队列，排第 N 位」；check 收尾输出下一批次接续提示 | P1 | 通过 |
| Q10 | ui：抽屉渲染排队列表（排队中标签 + 位次）；创建入队 toast 文案；refreshBatch 签名计入 queue | P1 | 通过 |
