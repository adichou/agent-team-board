# BUG-20260917-002 收口自动提交对已整体暂存的删除路径 git add -A 报 pathspec fatal，提交被毒死

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-17T07:44:13.455Z

## 现象

现象：BUG-20260917-001 上报（run receipt）后系统收口 0 组提交失败挂起：git add -A -- docs/agent-team-board/builds/versions/BLD-20260914-001/version.json 报 fatal: pathspec did not match any files。

根因：commitPaths（scripts/lib/git-flow.mjs）对每个归因路径执行 git add -A -- <path>；当该路径的删除已被整体暂存（索引中已无条目、工作区也无文件，如本例 BLD-20260914-001/version.json 遗留的暂存删除）时，pathspec 匹配不到任何文件，git add 直接 fatal，导致整组提交中止。autoCommitForRun 与人工确认补交 supplementCommitForRun 共用 commitPaths，同一根因会连环卡死收口与确认补交。

复现：git rm <tracked-file>（或人工暂存某文件删除且工作区无此文件）后，对任意单 report / run receipt 触发收口，doc 组包含该共享路径即失败。

影响：凡工作区存在「已整体暂存的删除」的看板共享路径，所有后续条目的收口提交都会失败并挂起待人工确认，且确认补交勾选计入该路径时同样失败。

期望：add 阶段对「仅剩已暂存删除」的路径幂等容错（如匹配不到任何文件时跳过 add，直接依赖 commit --only 收录删除），或提交前校验 pathspec 可匹配性并给出可操作提示。

排查：版本合并（build-git mergeCommitsIntoMain）与管理记录提交（mgt-commit）均为路径限定 add，未发现产生全量暂存的代码路径；本例毒源的暂存删除来源未定位（疑似人工终端操作遗留）。临时处置：git restore --staged 该路径恢复为未暂存删除后，确认补交即可正常收录。

## 复现步骤

前置：项目为 git 仓库，存在一个已被跟踪的看板共享路径（如旧前缀 `docs/agent-team-board/builds/versions/BLD-20260914-001/version.json`，或新前缀 `agent-team-board/` 下任意共享文件）。

1. 制造「已整体暂存的删除」：对该被跟踪文件执行 `git rm <tracked-file>`（或人工暂存其删除且工作区无此文件）——此后索引中已无该条目、工作区也无该文件，pathspec 匹配不到任何对象。
2. 对任意单触发收口自动提交：批量开发回执核验通过（`atb report <ID> --summary "…"` / run receipt）后系统执行 `autoCommitForRun`，归因时该共享路径按板级共享进入 doc 组（`groups.doc`）。
3. `commitPaths` 对 doc 组执行 `git add -A -- <path>`，因 pathspec 匹配不到任何文件直接 `fatal: pathspec did not match any files`，整组提交中止。
4. 观察结果：run 回执显示 autoCommit `failed`、0 组提交落库，条目挂起待人工确认；失败明细落 `auto-commit.json`（errorFull 含完整 fatal 信息）。
5. 重试同样失败：`atb run autocommit <RUN-ID>` 重走同一 `commitPaths` 路径，同样 fatal。
6. 确认补交也卡死：在挂起面板人工确认后走 `supplementCommitForRun`（与 `autoCommitForRun` 共用 `commitPaths`），勾选计入该共享路径时同样 fatal——收口与确认补交连环失败。
7. 对照（临时处置验证）：执行 `git restore --staged <path>` 把删除恢复为「未暂存」后，再次确认补交即可正常收录该删除——证明卡点仅在 add 阶段的 pathspec 匹配。

最小化复现（开发阶段测试可采用）：在临时 git 仓库中创建被跟踪文件并 `git rm`，随后以该路径为归因路径调用 `commitPaths`（或经收口入口间接到达），修复前代码应抛出 fatal。

## 期望行为

- add 阶段对「仅剩已暂存删除」的路径幂等容错：整块 `git add -A -- <chunk>` 失败时逐路径重试，命中「did not match any files / no such file or directory」类错误则跳过该路径的 add（其删除已在索引中，由后续 `git commit --only` 以 HEAD 跟踪记录为准一并提交），整组提交正常完成。
- 容错须同时覆盖 `autoCommitForRun`（收口自动提交，含 `atb run autocommit` 重试）与 `supplementCommitForRun`（人工确认补交）两条路径（共用 `commitPaths` 即天然覆盖，但须验证）。
- 仅容错 pathspec 无匹配类错误；其他 git 错误照常上抛并完整落账（errorFull 不截断关键信息，BUG-20260915-003 口径不回退），不得静默吞错。
- 修复后：存在已整体暂存删除的共享路径时，收口不再挂起、确认补交可正常完成，且该删除确实被提交收录（`--only` 提交内容含该路径的删除）。

## 验收说明

- 回归测试：按 TDD 在 `scripts/tests/bug-20260917-002.test.mjs`（先红后绿）覆盖——临时 git 仓库中 `git rm` 一个被跟踪的看板共享路径后触发收口提交：
  - doc 组提交成功生成，`git show --stat` 确认该路径的删除被提交收录；
  - 不再出现 `fatal: pathspec did not match any files`；
  - 非 pathspec 类 git 错误（如构造其他失败）仍上抛、不吞错。
- 覆盖确认补交路径：`supplementCommitForRun` 在同一暂存删除现场（勾选计入该路径）提交成功，或以代码审阅证明其与收口共用 `commitPaths` 的同一容错分支生效。
- 幂等与重试：曾因本 Bug 挂起（`autoCommit.status=failed`）的单，容错后 `atb run autocommit <RUN-ID>` 可补齐剩余分组，不重复提交已成功分组。
- 全量 `npm test` 通过，既有收口/补交/幂等用例不回退。
- 关联现状（开发阶段须核验，勿重复实现）：2026-09-18 提交 `21fc312`（REQ-20260916-007 人工确认补交）已在 `commitPaths` 引入「整块 add 失败逐路径重试、跳过 did not match any files / no such file or directory」的容错。本单开发须确认该容错完整覆盖本 Bug 场景（错误信息正则匹配、supplement 路径、`--only` 收录删除）并补齐上述回归测试；若已完整覆盖，收口为补测试 + 现场核验，不再改逻辑。
- 待确认：git 输出本地化（非英文 locale）环境下 fatal 信息是否仍能被现有正则匹配；不能匹配时的兜底策略由开发阶段评估（如以退出码而非文案判定）。

## 相关现场

- BUG-20260917-001：其上报（run receipt）触发本次收口失败挂起，是暴露现场，非引入来源。
- 本例毒源的暂存删除来源未定位（疑似人工终端操作遗留），不影响根因与修复判定。
