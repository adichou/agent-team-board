# 测试用例 — REQ-20260923-004 删除需求需要同步提交

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| G1 | git 仓库删除 submitted 需求：同步产生一条消息含单号的提交（过 validateCommitSubject）；`git show --name-only HEAD` 仅含被删条目目录路径；工作区 porcelain 不再残留该路径 | P0 | ✓ 通过 |
| G2 | 不卷入无关改动：工作区预置其他条目目录脏改动与板外脏文件 → 删除提交 --name-only 不含任何无关路径，预置差异原样保留工作区 | P0 | ✓ 通过 |
| G3 | 提交失败不回滚：预置 .git/index.lock → 条目目录仍被移除，返回 failed 且 reason 含失败原因与人工补提交指引；porcelain 保留 ` D` 差异；移除锁后重试 commitItemDeletion 可成功入库 | P0 | ✓ 通过 |
| G4 | 非 git 仓库：返回 skipped，reason 注明「非 git 仓库，无法同步提交」；删除照常成功（不抛错） | P0 | ✓ 通过 |
| G5 | 待接受 Bug 条目同口径：data/bugs/<ID> 删除同样产生含单号提交 | P1 | ✓ 通过 |
| G6 | 从未入库的条目（创建后未提交 git）删除：skipped「无 git 差异」，不产生空提交 | P1 | ✓ 通过 |
| G7 | 服务端 DELETE /api/item/:id 同口径：git 仓库项目上删除 → 200 响应携带 gitCommit（status=committed + shortHash），git log HEAD 含单号；CLI 通道与 server 通道共用同一收口函数 | P0 | ✓ 通过 |
| G8 | CLI 静态契约：atb.mjs delete 分支在 core.deleteItem 后调用 commitItemDeletion；server.mjs DELETE 分支同样调用 | P1 | ✓ 通过 |
| U4 | UI 静态：确认文案说明将同步产生 git 提交；deleteItem 按 gitCommit.status 分支反馈（committed 含短号 / failed 警告 toast 含原因与指引 / skipped 说明） | P1 | ✓ 通过 |
| U5 | UI 沙箱：删除成功后 toast 含提交短号；gitCommit.status=failed 时走警告 toast 且文案含补提交指引；无 gitCommit 字段（旧服务）保持旧文案 | P1 | ✓ 通过 |

回归：既有 `scripts/tests/item-delete.test.mjs`（D1–D7、U1–U3，非 git temp 项目走 skipped
路径）全量通过。

实测补充：新增 i18n 词典条目后 `i18n-coverage.test.mjs` 通过；`npm test` 全量 340 个
测试文件 0 失败；CLI 真实端到端冒烟（temp git 项目）验证 committed（含短号与提交消息）
与 skipped（未入库条目）两条输出路径、`--json` 携带 gitCommit。
