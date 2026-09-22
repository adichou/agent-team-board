# 测试用例 — REQ-20260922-004 AI 分析要支持并行子代理模式，可同时最多展开 3 个子代理认领需求分析

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 新增测试文件：scripts/tests/req-20260922-004.test.mjs（P1~P11）；既有测试按新口径更新：
> refine-store.test.mjs R5（并行领取 + 锁断言）、refine-cli.test.mjs R10（未收尾改并行领取）、
> tasks-refine.test.mjs T6（领取锁断言）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| P1 | 领取并行（数据层）：在途 <3 时不同 owner 领取不同条目（≤3 路同时预留）；第 4 次 next 返回 stop=busy + 在途清单提示（不抛错）；同一条目不被两路领取（activeByItem 跳过） | P0 | ✅ |
| P2 | 回执隔离：3 路在途时 done/fail/release 任一回执只结算自身（activeRunIds/currentRunId 调整），其余在途照常、可继续补派；done「文档确有变更」核验口径不变 | P0 | ✅ |
| P3 | check 协议：currents 在途列表 ≤3 可见（runId/itemId/owner/phase）；在途 <3 且可领数 >0 → continue；满 3 或可领数 0 → needs_attention；队列取空在途未清 → next stop=finished+notice 且批次不落 finished；队列空在途清零 → stop+finished；响应 ≤2KiB | P0 | ✅ |
| P4 | 提示词：不再含「同一时间只运行一个」；含「最多 3 个」「不同条目」「不要让子代理再派发子代理」「补派」；项目根/CLI 入口仍在尾部参数区（缓存口径保持） | P0 | ✅ |
| P5 | 暂停/终止/挂起：暂停只停新派发（在途回执不受阻、回执后不补派）；终止把全部在途落 interrupted + activeRunIds 清空 + 提示人工停止；hold 声明挂起只停队列（pauseRequested），其他在途运行仍可回执 done | P0 | ✅ |
| P6 | CLI：next 满槽 exit 0 + busy 提示（--json 可解析）；check 文本输出在途列表；usage 并行口径 | P1 | ✅ |
| P7 | serve：/api/refine/current 透传 activeRuns（含 owner/createdAt），current 保留 | P1 | ✅ |
| P8 | UI：renderRefinePanel 渲染在途卡片（≤3、条目可点、子代理会话/开始时间/已用时）；统计「进行中」=在途数；activeRuns 缺失回退 current；i18n 中英词条同步（i18n-coverage 通过） | P0 | ✅ |
| P9 | 退化兼容：单在途（实际并行度 1）下 check=needs_attention / 回执后 stop 与串行口径一致（R8 回归）；存量账本无 activeRunIds（仅 currentRunId）续跑可回执可补派 | P0 | ✅ |
| P10 | 锁迁移：zcode 领取不再持有 refine.lock（短临界区 refine-next.lock 操作后释放）；无候选收尾释放 refine.lock 时不清 codex-refine kind 占用；abort 仍全量释放 | P1 | ✅ |
| P11 | codex 执行器不回归：tryAcquireRefineLock/releaseRefineLockForRun 语义保留（并发 1 队列不动）；运行中实时接受新单吸收（R4 回归） | P1 | ✅ |
