# REQ-20260910-013 增加一个批量commit 的功能，要求参考批量完善和批量开发的。

- 状态：submitted（待人工接受）
- 创建：2026-09-10T04:44:03.697Z

## 描述

1、批量 commit 针对已完成的单，逐项commit 到 git 上
2、因为这是人工触发的流程，所以可以允许 Agent Commit 代码
3、commit 消息要精简，控制住 20 个字内（不包括单号），主要包括 feat、fix、chore、doc、test 这几类， 一定要写上本次 commit 的需求或 bug 单号。
4、测试代码和业务代码要分开提交。

### 现状与差距（完善阶段整理，基于当前代码）

- 现有两条批量流程可参考，均为「创建批次 → 子代理逐项领取 → 执行 → 回执 → 核对/记录」的同构模式：
  - 批量完善（REQ-20260907-003 / REQ-20260908-020）：`atb refine create / next / done / fail / release / check / summary / pause / abort / records`，候选 = 已接受（accepted）未完善，账本在 `docs/agent-team-board/refine/batches/`（`scripts/lib/refine-store.mjs`）。
  - 批量开发（REQ-20260906-002 / REQ-20260908-010）：`atb batch create / next / check / summary / pause / abort / records / delete` + `atb run receipt / release`，候选 = 已计划（planned）未认领、最旧优先，账本在 `docs/agent-team-board/dispatch/batches/`（`scripts/lib/batch.mjs`）。
- 当前没有任何批量 commit 能力；本仓库 git 历史仅一个初始提交（`0f84698 chore: 初始化 agent-team-board 仓库`，2026-09-09），此后 200+ 个已完成单的改动全部堆积在工作区未提交（当前 101 个脏文件），无法按单追溯——这是本需求的直接动机。
- 全局工作规则约定 Agent「不自动 commit」；本需求定位为**人工触发**的批量流程（触发即视为人工明确指令），触发前 Agent 仍不得自行提交，两者不冲突。现有 hooks（`hooks/state-guard.mjs`）只拦截人工专属状态命令与 `status.json` 直写，不拦截 git 命令，无需放行改动。
- 看板账本不记录每个单改动了哪些文件（`test-report.md`、批次运行记录均无文件清单）。「逐项 commit」需要执行方结合条目文档（README / design / test-report）与 `git status` / `git diff` 对工作区未提交改动做按单归因，这是本功能的核心工作量。
- 「已完成的单」存在口径问题（截至 2026-09-10）：状态机 `done` 仅 9 个单，其中 7 个创建于初始提交之前（改动大概率已含在初始提交内，无工作区改动可提交）；另有 191 个单处于 in-progress 且已上报（`agentCompletedAt` 已置位）待人工确认完成，堆积的未提交改动主要来自这些单。若候选只取 `done`，当前几乎无单可提交；若含「已上报待确认」，则覆盖了实际动机。**候选口径需人工确认**（见待确认 1）。

### 目标细化（完善阶段口径）

1. **人工触发的批量流程**：新增一组 `atb` 子命令（命名参考 `atb commit create / next / done / fail / release / check / summary / records`，最终命名与参数由开发阶段定），模式与批量完善 / 批量开发同构：创建批次（冻结候选）→ 子代理逐项领取 → 执行提交 → 回执 → 主会话核对。仅当人工创建并派发任务后才执行 commit；任务之外 Agent 不得自动提交。
2. **候选 = 已完成的单**（口径待确认，见下）：默认建议按状态机 `done` 取单；每轮领取实时读取（新确认完成的单自动进入本轮候选，与批量开发的实时队列口径一致）。
3. **逐项归因提交**：子代理领取一个单后，阅读该条目文档（README / design / test-cases / test-report），从工作区未提交改动中找出属于该单的文件，`git add` 分组后提交。多个单改过同一文件时（如 `scripts/atb.mjs` 被多个需求叠加修改），文件只能整体归入一个 commit——归属规则（如归入最早创建的涉及单并在回执中注明共改文件）由开发阶段设计定。
4. **commit 消息规范**：`类型: 精简描述 单号`。类型限定 feat / fix / chore / doc / test 之一（需求单与 Bug 单同样适用该五类）；描述控制在 20 个字以内（不含单号）；单号必须出现（如 `REQ-20260910-013` / `BUG-20260910-003`）。条目目录内的文档改动属 doc 类。
5. **测试与业务分开提交**：同一单至少拆成两个 commit——业务代码一个、测试代码一个（本项目测试代码集中在 `scripts/tests/*.test.mjs`）。两者先后顺序不限定，但不得混在同一 commit。
6. **只 commit 不 push**：本功能只产生本地 commit；push 仍由人工决定与执行。
7. **幂等与失败处理**：已提交过的单重复运行不产生新 commit（按 git 历史中已含该单号识别）；某单在工作区无对应改动或无法归因时，走失败/跳过回执并写明原因，不阻塞其他单；不属于任何候选单的剩余改动保持原样，不得混入他人 commit。
8. **账本与核对**：批次执行记录（每单的 commit hash、消息、结果、原因）落盘可查，提供与 batch / refine 同构的 check（≤2KiB 最小核对）与 records 分页；主会话不读完整队列。

### 待确认

1. **候选口径**：仅 `done`（人工确认完成），还是含「已上报待人工确认」（`agentCompletedAt` 已置位的 in-progress 单）？按当前数据前者几乎无可提交单，后者才是主要诉求；是否需要创建任务时可指定单号范围（类似 `refine create --ids`）？
2. **看板界面**：是否需要在 Status Board 任务模块提供批量 commit 的启动/监控入口（与批量完善、批量开发并列），还是首期仅 CLI？（本需求原文未提及界面。）
3. **同文件多单叠加改动的归属规则**：归入最早创建的涉及单、还是最近完成的单、还是该单相关改动占多数者？（影响逐项提交的准确性，开发阶段 design 定。）

## 验收标准

- [ ] 人工通过新增 CLI 命令创建批量 commit 批次并派发；未创建任务时，任何 Agent 会话不会因本功能自动产生 commit（与全局「不自动提交」规则兼容）。
- [ ] 批次按候选口径（见待确认 1，实现须与人工确认结果一致）逐项派发子代理，逐单提交；候选为空或全部处理完时明确提示停止，不空轮询。
- [ ] 每个成功提交的单在 git 历史中至少有一个 commit，且：消息含该单需求或 Bug 单号；类型前缀为 feat / fix / chore / doc / test 之一；描述部分（不含单号）不超过 20 个字。
- [ ] 同一单的测试代码与业务代码分属不同 commit（抽查 `git log` / `git show --stat`：含 `scripts/tests/*.test.mjs` 的 commit 与业务代码 commit 分离）。
- [ ] 只执行 `git commit`，不执行 `git push`；全程不丢弃、不还原、不暂存无关改动（处理结束后非候选单的改动仍在工作区）。
- [ ] 无对应改动或无法归因的单产生明确的失败/跳过回执与原因，不影响其他单继续处理；批次账本记录每单的 commit hash、消息与结果，check / records 可查。
- [ ] 重复运行幂等：对已产生 commit 的单再次运行不再生成新 commit（按 git 历史含单号识别）。
- [ ] 命令用法与输出风格（含 `--json`）与现有 batch / refine 子命令一致，usage 帮助同步更新；现有批量完善、批量开发行为不回归。
