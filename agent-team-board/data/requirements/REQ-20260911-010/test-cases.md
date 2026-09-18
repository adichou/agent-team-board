# 测试用例 — REQ-20260911-010 回退批量 Commit 的相关功能，但需保留已完成需求的 commit 号显示这个功能

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | CLI 回退：`atb commit create/next/done/fail/release/check/summary/records/pause/abort` 全部非零退出并给「批量 commit 已回退（REQ-20260911-010）」类明确提示；主 usage 与 COMMIT_USAGE 无「批量 commit」分组条目 | 高 | 通过 |
| R2 | 旧命令不产生副作用：真实 git 临时仓库中执行旧命令，git 提交数不变、不落 `commits/batches` 账本 | 高 | 通过 |
| R3 | REQ-009 索引命令保留：`atb commit log <ITEM-ID>` / `atb commit which` 照常可用 | 高 | 通过 |
| R4 | 数据层裁剪：`commit-store.mjs` 不再导出 CMT 批次流程函数（createCommitBatch/nextCommitItem/finishCommitRun/abortCommitBatch/commitBatchBrief/buildCommitPrompt 等）；共享内核保留且行为不变（validateCommitSubject / committedItemIndex / itemCommittedInGit） | 高 | 通过 |
| R5 | 服务端路由回退：`/api/commit/current、create、pause、abort、records` 返回 404（未知接口）；`/api/commit/item-status` 保留 200（未初始化 400） | 高 | 通过 |
| R6 | item-status 换源：取数来自 REQ-009 索引（自动提交账本 + git 历史消息含单号合并）；一个 commit 消息含两个单号时两条目都关联该 hash；索引整体为空时 `statuses={}` 不报错；响应不再含 CMT 批次字段 `batches` | 高 | 通过 |
| R7 | 看板任务模块回退：无「批量 Commit」页签按钮、无 renderCommitPanel/refreshCommit/createCommitBatchAndCopy 等面板函数、无 /api/commit/current\|create\|pause\|abort 调用、快照不保存/恢复 commitPane 与 batchMode 'commit' | 高 | 通过 |
| R8 | 已完成档快捷入口回退：done 档 #laneQuickEntry 隐藏（无「▶ 开始 Commit」）；accepted「▶ 开始完善」/ planned「▶ 开始开发」显隐与文案不回归 | 高 | 通过 |
| R9 | 全局看板回退：GLOBAL_KIND_FILTERS/LABEL/PREFIXES 无 commit 与 CMT-；globalCountsParts 无 commit 分支；空态文案无「批量 Commit」；/api/batch/global 不再返回 CMT 简报行（存量/损坏 CMT 账本不降级项目、逐字节不动） | 高 | 通过 |
| R10 | 徽标保留（换源后四态）：done 条目默认「未提交」、有索引记录「已提交 + N 个提交号」可展开可复制、查询失败「提交状态加载失败 + 重试」不伪装未提交、详情页「提交状态」字段保留；数据源为 /api/commit/item-status | 高 | 通过 |
| R11 | state-guard：CMT 在途豁免移除（hasActiveCommitBatchRun 符号不存在）；流程外 git commit 拦截提示不含「批量 commit」通道，仍含到待测试自动提交口径 | 高 | 通过 |
| R12 | 不回归：批量完善 / 批量开发 / 全局看板其余功能、需求/bug 模块既有交互（存量测试全量跑绿，203 文件 0 失败） | 高 | 通过 |

实施说明（与验收「待确认」项的衔接，详见 design.md）：

- 待确认 1（一单一 commit vs 一单多 commit）：REQ-009 已按仓库提交规范实现 doc/test/业务分组（一单多
  commit），本单按 README 预留分支维持「一单多提交号」展示，索引天然支持「一个 commit 关联多个单号」；
  最终口径留人工确认。
- 待确认 2（存量数据）：`commits/` 存量账本、settings.json、.gitignore 一律保留不删（R9-C3 守只读）；
  本仓库当前无在途 CMT 批次。
- 待确认 3（复用边界）：validateCommitSubject / itemCommittedInGit / committedItemIndex / 规范常量保留为
  REQ-009 底层（R4 守行为不变）；CMT 批次执行函数整体移除。
- 待确认 4（REQ-009 文档衔接）：未修改 REQ-20260911-009 条目文档，留人工确认后同步。
