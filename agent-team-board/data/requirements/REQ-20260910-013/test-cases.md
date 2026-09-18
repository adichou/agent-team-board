# 测试用例 — REQ-20260910-013 增加一个批量commit 的功能，要求参考批量完善和批量开发的。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

自动化：`scripts/tests/commit-batch-20260910-013.test.mjs`（真实 git 仓库 + 临时看板项目，CLI 端到端；
git 身份用 `-c user.email/-c user.name` 注入，不依赖全局配置）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | create 候选口径：非 git 仓库报错；默认候选=done 单（创建时间升序）；in-progress 已上报单默认排除、`--include-reported` 纳入；`--ids` 取交集；输出含 CMT- 批次号与主调度提示词（含 `atb commit next`、只 commit 不 push 约束）；`--json` 可解析且含 alreadyCommitted 计数 | P1 | 通过 |
| C2 | 全链路：next 领取（runId/itemDir/docs）→ 子代理按「业务/测试/条目文档」三组真实 git commit → done --summary --commits 回执成功；账本记录 commit hash 与主题；check 计数 committed=1；records 展示 hash/消息；impl.lock 已释放 | P1 | 通过 |
| C3 | done 核验拒绝：消息不含单号 / 非五类前缀 / 描述超 20 字 / hash 不在当前分支 / 同一 commit 混入 scripts/tests 与业务文件 / 条目目录文件出现在非 doc 类 commit——各分支均报明确错误且不落终态（修正后可重新 done） | P1 | 通过 |
| C4 | 幂等：git 历史已含某单号的提交消息 → create 过滤该单（alreadyCommitted 计数）；批量运行中由 next 自动落 skipped 出局账（reason 含「幂等」），不派发子代理 | P1 | 通过 |
| C5 | fail 不阻塞：无对应改动的单 `commit fail --reason` 落 failed 回执；批次继续派下一项；全部处理完 next 返回 stop=finished，check nextAction=stop；候选为空时 create 明确报错 | P1 | 通过 |
| C6 | release/pause/abort：未收尾运行再领被拒；release 释放互斥后可换单；pause 后 next 提示 stop=paused、--off 恢复；abort 剩余项落 skipped、批次 finished+aborted、impl.lock 全释放 | P1 | 通过 |
| C7 | 互斥：commit 运行在途（next 后未回执）持有 impl.lock → `atb batch next`（开发批次）与手工 claim 均被拒；done 收尾后恢复可用 | P2 | 通过 |
| C8 | 协议与帮助：check 载荷 ≤2 KiB、含 counts/nextAction；`atb help` USAGE 含 commit 命令组；`atb commit` 无子命令提示用法；summary/records --json 可解析 | P2 | 通过 |
| R1 | 回归：现有测试套件（node scripts/tests/run-all.mjs）全量通过，批量完善/开发行为不回归 | P1 | 通过 |
