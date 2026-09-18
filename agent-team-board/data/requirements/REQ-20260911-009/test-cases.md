# 测试用例 — REQ-20260911-009 需求模块使用 dev 分支进行开发，每条需求或 bug 开发完到待测试状态都自动 commit

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | init 非 git 项目：自动 `git init` + 落 dev 分支；不 push、不配远端（remote 为空） | 高 | 通过 |
| D2 | init 已是 git 仓库：跳过 init 不重复初始化；已有提交仓库按需创建 dev 并切换；已在 dev 幂等；dev 已存在仅切换不重复创建 | 高 | 通过 |
| D3 | 空仓库（git init 后无任何提交）：init 落 dev 不报错，当前分支为 dev | 高 | 通过 |
| D4 | 设置页接口：GET /api/git/branch-state 返回分支状态；POST /api/git/init-dev 幂等创建/切换；非 git 项目给出明确提示（不出现必失败入口） | 高 | 通过 |
| D5 | 快照归因：预留时已存在暂存/未暂存改动不被卷入；本单的修改/新增/删除按 doc（条目文档）/test（scripts/tests）/业务（feat/fix）分组提交，消息过 validateCommitSubject | 高 | 通过 |
| D6 | finishRun reported 触发自动提交：回执携带 autoCommit；committedItemIndex（已提交徽标同源）点亮；其他单目录改动保留在工作区 | 高 | 通过 |
| D7 | 幂等：同一运行重复回执不重复提交；git 历史已含单号时跳过（skipped 落账） | 高 | 通过 |
| D8 | 失败不阻断：提交失败（pre-commit 钩子拒绝）→ 回执仍 reported、改动保留、批次可继续；`atb run autocommit` 重试成功且不重复提交 | 高 | 通过 |
| D9 | 旧版预留（无工作区快照）/非 git 项目 → 自动提交跳过并给出明确原因，不猜测归因 | 中 | 通过 |
| D10 | hook：看板项目内流程外 `git commit` 被拦；CMT 批次在途运行豁免；无看板上下文的项目放行；`git add` 等非提交命令放行 | 高 | 通过 |
| D11 | 索引：`atb commit log <ITEM-ID>` 查该单全部提交（hash+消息）；`atb commit which <HASH>` 从提交反查条目 | 中 | 通过 |
| D12 | UI 静态断言：设置页「Git 工作流」分区（状态行/按钮/就近反馈/确认弹窗）；待测试（in-progress 已上报）条目同样展示「已提交」徽标 | 中 | 通过 |

自动化：`scripts/tests/dev-flow-20260911-009.test.mjs`（真实临时 git 仓库 + CLI/子进程集成，模式对齐 commit-batch-20260910-013 / code-guard / serve 既有测试）。
