# 设计 — REQ-20260910-013 增加一个批量commit 的功能，要求参考批量完善和批量开发的。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

仓库当前仅一个初始提交（`0f84698`，消息不含任何单号），200+ 个已完成单的改动全部堆积在工作区未提交，
无法按单追溯。现有两条批量流程（完善 `refine-store.mjs`、开发 `batch.mjs`）均为
「创建批次 → 子代理逐项领取 → 执行 → 回执 → 核对/记录」同构模式；本需求按同一模式新增批量 commit 流程。
全局规则「Agent 不自动 commit」不冲突：本流程仅在**人工创建批次并派发**后运行，任务之外不产生 commit；
本功能代码自身对 git 只做只读操作（log / show / rev-parse），`git add/commit` 由派发的子代理按单执行。

## 方案

（技术选型、接口设计、影响面）

**开源选型（REQ-20260909-015）**：自研，无引入开源库。理由：本功能核心是文件账本 + 原子锁 + 子代理
回执协议，与既有 batch/refine 同构，直接复用 `lib/core.mjs` 的锁与原子写设施；git 操作只需
`git log/show/rev-parse` 只读命令（Node 内建 `child_process.spawnSync` 即可），无合适的第三方库
承担「按单归因 + 账本 + 互斥」语义（simple-git 等仅是命令封装，引入徒增依赖）。未使用开源库，不创建 licenses.md。

### 1. 命令组与账本（与 batch / refine 同构）

新增 CLI 子命令组 `atb commit`（`scripts/atb.mjs` 新增 `commitCmd`，数据层新文件 `scripts/lib/commit-store.mjs`）：

- `atb commit create [--ids ID1,ID2] [--include-reported] [--dev 名称]` 创建批次（冻结候选）并输出主调度提示词
- `atb commit next [--batch ID] [--by 会话]` 子代理领取一项（原子预留 + 项目实施互斥；实时吸收新完成单；
  git 历史已含单号的单自动出局落账）
- `atb commit done <RUN-ID> --summary <要点> --commits <hash1,hash2,…>` 成功回执（核验提交规范，见 §4）
- `atb commit fail <RUN-ID> --reason <短句>` 失败/跳过回执（无对应改动、无法归因；不影响其他单继续）
- `atb commit release <RUN-ID> [--reason 短句]` 释放未回执的预留（认领冲突换单）
- `atb commit check [--batch ID]` 主调度最小核对（≤2 KiB）
- `atb commit summary [--batch ID]` 批次摘要；`atb commit records [--batch ID] [--offset N] [--limit N]` 记录分页
- `atb commit pause [--off] [--batch ID]` 暂停/恢复；`atb commit abort [--batch ID]` 终止（剩余项出局）

账本事实源：`<dataDir>/commits/{settings.json（计数器）, batches/CMT-YYYYMMDD-NNN/batch.json, runs/<runId>/run.json}`；
`ensureCommits` 幂等初始化并向 `<dataDir>/.gitignore` 追加 `commits/runs/`、`commits/batches/`（执行账本不进版本控制）。
批次阶段 `prepared/running/paused/finished`（终止时 `finished + aborted/abortRequested` 终态标记）；
运行终态 `committed / failed / skipped / interrupted`；计数 `total/committed/failed/skipped/interrupted/remaining`。
编号序列 `CMT-`（批次）与 `run-`（运行，`commits-id.lock` 互斥自增），与 refine 的 RFB 序列同款。

### 2. 候选口径（待确认 1 的落地：两口径都实现，人工创建时选择）

- 默认：状态机 `done`（人工确认完成）的单，全部纳入。
- `--include-reported`：追加「已上报待人工确认」的单（`in-progress` 且 `agentCompletedAt` 已置位）——
  当前 197 个堆积单的主体，需求动机所在。两口径经旗标由人工在创建时定夺，实现不替人做选择。
- `--ids`：显式指定候选（与规范候选序取交集，类似 `refine create --ids`），供人工圈定范围重试。
- 排序：创建时间升序 → 编号（最旧优先，与批量开发同口径）。这也是共改文件归属规则的执行序（见 §5）。
- 实时队列：每轮 `next` 吸收「创建后新满足口径」的单（排除已冻结在其他未结束 commit 批次的）。

### 3. 幂等与出局（验收：重复运行不产生新 commit）

- 判定依据：`git log` 全量提交消息（`--format=%B`）包含该单号即视为已提交。
- `create` 时过滤已提交单（响应带 `alreadyCommitted` 计数）；全部已提交 → 明确报「没有可提交候选」。
- `next` 时逐项复查：已在 git 历史的单自动落 `skipped` 出局账（reason：`git 历史已含该单号提交（幂等跳过）`），
  不派发子代理；目录损坏/状态已变化（不再是候选口径）同样 `skipped` 出局，不阻塞其他单。

### 4. 提交规范核验（done 回执校验，验收第 3/4/5 条的机器判定）

`commit done --commits` 对每个 hash（须在当前分支 `git log` 内可达）核验：

1. **消息格式**：主题行 `^(feat|fix|chore|doc|test): ` 五类前缀之一；消息含该单号；
   描述 = 主题行去掉类型前缀与单号后的剩余文本，非空且 ≤20 字（码点，不含单号）。
2. **测试/业务分离**：`git show --name-only` 变更文件中，`scripts/tests/**` 不得与其他路径混在同一 commit。
3. **条目文档归类**：含条目目录（`docs/agent-team-board/{requirements,bugs}/…/<ID>/…`）文件的 commit
   类型必须为 `doc`（README 口径：条目目录内文档改动属 doc 类）。

任一不满足 → done 拒绝（可修正后重新 done，同 run 未收尾前允许重试）；子代理自身无法满足规范时改走 `commit fail`。
工具侧不执行 `git push`，也不提供任何 reset/checkout/stash 通道（工作区改动只由子代理按单 `git add` 分组提交，
不属于任何候选单的改动保持原样）。

### 5. 按单归因（子代理执行约定，写入派发提示词）

- 子代理领取单后阅读条目文档（README / design / test-cases / test-report）与 `git status --short`、`git diff`，
  从工作区未提交改动中找出属于该单的文件，按「业务 / 测试（`scripts/tests/**`）/ 条目文档」分组提交。
- **共改文件归属**（待确认 3 的落地）：候选按创建时间升序处理，被多个单叠加修改的文件（如 `scripts/atb.mjs`）
  整体归入**最早创建的涉及单**（即最先被处理的单），并在该单回执 summary 中注明共改文件，供人工核对。
- 单在工作区无对应改动或无法归因 → `commit fail` 落明原因，不阻塞其他单。

### 6. 互斥与收尾

- 每项处理期间占用项目实施互斥 `.locks/impl.lock`（payload `kind: 'commit'`）：与批量开发、手工 claim
  互斥（提交会改写 git 索引，与实施同级别排他）；attention 占用期间同样拒绝开工。
- `done / fail / release` 收尾即释放（按 runId/owner 匹配）；`abort` 全量释放；`pause --off`（恢复）解除
  本批次留下的 attention 占用，与 batch 的恢复语义一致。
- 失败**不暂停批次**（本需求：无法归因属正常出局路径，验收要求不影响其他单），故不引入 needs_attention。

### 7. 界面（待确认 2 的落地）

首期仅 CLI（需求原文未提及界面；Status Board 任务模块入口不在本批范围，后续单另立）。
`atb commit` 输出风格（含 `--json`）与 batch/refine 一致；`atb help` 的 USAGE 同步登记命令组。

## 影响面

- 新增 `scripts/lib/commit-store.mjs`、`scripts/tests/commit-batch-20260910-013.test.mjs`；
  修改 `scripts/atb.mjs`（新增子命令组与 USAGE）。
- 不改状态机、不改 batch/refine 行为（既有测试全量回归）；不触碰 hooks（state-guard 本就不拦 git 命令）。
- 账本目录 `docs/agent-team-board/commits/` 新增（运行账本已 gitignore，settings.json 进版本控制）。

## 风险与边界

- **归因准确性**依赖子代理阅读文档与 diff 的判断，工具只做规范核验兜底；共改文件按最早单整体归属，
  后续单可能因此无文件可提（走 fail 注明），由人工在 check/records 核对。
- **中途中断**：impl.lock 无超时接管，子代理异常退出后须人工 `commit abort` 或 `pause --off` 释放
  （与批量开发同纪律）。
- **done 核验只覆盖机器可判定项**（消息格式/分离/归类/可达性），不判定「提交内容是否真的属于该单」。
- 大批量（~200 单）逐项派发较慢：属预期（每项一个子代理会话），暂停/终止随时可停。
