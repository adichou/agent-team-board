# 设计 — REQ-20260911-009 需求模块使用 dev 分支进行开发，每条需求或 bug 开发完到待测试状态都自动 commit

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板开发流程与版本库脱节：初始化不做任何 git 操作（非 git 项目只能靠后续人工补）、开发分支无约定，
「开发完成进入待测试」与「提交进版本库」分离，需要人工创建 CMT 批量 commit 批次派发子代理归因提交。
本单把两者绑定：dev 分支开发 + 到待测试自动提交 + 条目与提交互相索引。

## 方案

新增数据层 `scripts/lib/git-flow.mjs`（git 工作流单一真源），三块能力：

### 1. 初始化落 dev 分支（需求 1/2）

- `ensureDevWorkflow(root)`（幂等）：非 git 项目先 `git init -b main`；随后按需创建 `dev` 并把工作区
  切到 dev（`git switch -c dev` / `git switch dev`）。只做本地分支操作，不 push、不配置远端、
  不执行丢弃/还原/暂存类命令。git 失败如实抛 `AtbError`（不做静默降级）。
- `core.initData`（CLI `atb init` 与网页 `POST /api/init` 共用）在创建数据目录**之前**先落 Git 工作流
  （失败即中止，不产生半初始化数据）。
- Status Board 设置页新增「Git 工作流」分区（`cx-config` 形态）：`GET /api/git/branch-state`（只读，
  进入设置页即加载，加载期按钮禁用）+ `POST /api/git/init-dev`（人工网页操作；`uiConfirm` 确认 →
  执行 → 就近反馈；已在 dev 呈「已在 dev 分支」就绪态；非 git 项目按钮禁用并提示引导走初始化，
  不顺带 `git init`）。失败显示原因可重试，重试不重复创建已存在分支（ensureDevWorkflow 幂等）。

### 2. 到待测试自动 commit（需求 3）

- **触发点与执行主体（待确认结论）**：`batch.finishRun` 中 reported 回执**核验通过后、写回执落盘前**，
  由 **atb 进程自身**执行 `autoCommitForRun`（`scripts/lib/git-flow.mjs`）。不选「子代理在回执前执行」：
  系统执行天然绕过 Agent Bash 工具（hook 不经手）、幂等与失败重试由系统统一保证，worker 流程零新增步骤。
- **归因（快照差集）**：`batch.nextItem` 预留运行时对 `git status --porcelain -uall` 拍工作区快照
  （存 `dispatch/runs/<runId>/run.json` 的 `treeSnapshot`，该目录已被 .gitignore 排除）。回执时差集归因：
  - **doc 组**：看板数据目录内当前全部脏路径，排除**其他条目目录**——本单条目目录整体纳入
    （含预留前注册产生的未跟踪文档），看板共享文件（.gitignore / config.json / dispatch 索引等）
    随本单 doc 提交收纳，工作区收敛干净；
  - **test / 业务组**：严格按快照差集（非看板路径）——预留前已存在的暂存/未暂存改动绝不卷入；
  - 未跟踪文件按内容 sha1 探测变更（porcelain 码 `??` 不随内容修改变化）。
- **提交方式**：逐组 `git add -A -- <paths>` + `git commit --only -m "<类型>: <描述> <单号>" -- <paths>`。
  `--only` 保证只提交指定路径，预留前已暂存的其他内容留在暂存区不动（实测验证含修改/删除/新增组合）。
  分组与消息规范沿用 commit-store 现行口径（feat/fix/chore/doc/test、描述 ≤20 字（取条目标题截断）、
  必含单号；条目目录文件只进 doc 类、`scripts/tests/` 单独 test 类、业务 REQ=feat/BUG=fix），
  提交后逐条过 `validateCommitSubject` 核验。
- **幂等**：① 同一运行重复回执走 finishRun 既有幂等通道（不重跑自动提交）；② git 历史消息已含单号
  → 整单跳过（skipped 落账）；③ 部分失败重试按差集续传（已提交路径退出脏集合天然去重），
  仅在上次状态为 failed 时豁免「历史已含单号」整单跳过，避免永远补不齐剩余分组。
- **失败不阻断**：`autoCommitForRun` 永不抛错——失败记 reason（回执 `autoCommit` 概要 + 运行目录
  `auto-commit.json` 明细），改动保留工作区，回执仍 reported、批次照常继续；`atb run autocommit <RUN-ID>`
  提供重试入口（仅 reported 运行可重试）。
- **回执协议**：reported 回执附加 `autoCommit: { status, commits: [hash…], reason? }`（仍受 ≤2KiB 约束）。
- **账本**：自动提交在 `commits/runs/` 落 phase=committed 运行记录（batchId=`auto:<开发运行ID>`），
  与人工 CMT 批次同源汇入 `committedItemIndex` → 看板「已提交」徽标数据源统一；
  `ensureLedgerIgnore` 幂等补齐数据目录 .gitignore（commits/runs、commits/batches 不进版本控制）。

### 3. hook 授权口径（需求 3，待确认结论）

- **系统自动提交不受 hook 拦截的机制**：自动提交由 atb 进程内部 `spawnSync('git', …)` 执行，
  hook 只拦 Agent 的 Write/Edit/Bash 工具调用，天然不经手——无需豁免标记传递。
- **新增「流程外 Agent 自动 commit」拦截**（state-guard bash 模式规则 ⑤）：仅当命令上下文是看板项目
  （自 cwd 向上找到 `docs/agent-team-board/`）且解析到 git 子命令 `commit`（精确区分 commit-tree 等，
  跳过 -C/-c/--git-dir 等带值全局选项）时拦截；**豁免**：存在未结束 CMT 批次且其 currentRun 未收尾
  （人工授权的批量提交通道）。无看板上下文的其他项目不越界管辖；`git add` 等非提交命令放行。
- `hooks/hooks.json` / `hooks/codex.json` bash 守卫 statusMessage 同步更新（纳入提交拦截口径说明）。

### 4. 条目 ↔ commit 双向索引（需求 4）

- 正向 `gitFlow.itemCommitLog(dataDir, root, itemId)`：账本（committedItemIndex，经核验）+ git 历史
  （消息含单号）合并去重，CLI `atb commit log <ITEM-ID>`；反向 `itemOfCommit`：从提交消息提取
  REQ-/BUG- 单号并核验条目存在，CLI `atb commit which <HASH|消息文本>`。
- 徽标：待测试（in-progress 且已上报）条目与 done 条目同样展示「已提交」徽标
  （`commitBadgeHtml` / 宽行提交状态格），与既有「待测试」角标并列，数据同源 `/api/commit/item-status`。

## 开源选型（REQ-20260909-015）

自研。理由（三选一之「无合适库的原因」）：本功能是对自有账本（dispatch/commits JSON 账本）与 git CLI
（init/switch/status/add/commit --only，Node 17 均内置支持）的流程编排，无可复用的成熟通用库；
引入 git 客户端库（如 simple-git）反而增加依赖面且不覆盖快照差集归因与看板分组规范。仅用 Node 标准库
（child_process/crypto/fs/path）。未引入任何第三方依赖，不创建 licenses.md。

## 待确认项结论（开发阶段定稿）

| 待确认 | 结论 |
| --- | --- |
| 自动 commit 触发点与执行主体 | 回执核验通过后（finishRun 内）由系统执行；子代理零新增步骤 |
| hook 授权口径实现方式 | 系统提交经 atb 子进程执行、不经 Bash 工具（无需豁免标记）；同步新增流程外 git commit 拦截（CMT 在途豁免） |
| init 自动 git init 是否要开关 | 不设开关，默认自动（README 验收口径即默认自动；`git init -b main` 统一基线分支名） |
| 空仓库创建 dev 的路径 | unborn HEAD 直接 `git switch -c dev`（等价未出生分支改名），首个提交自然落 dev |
| 设置按钮是否顺带 git init 存量非 git 项目 | 不顺带：按钮禁用并提示引导（网页入口只做分支操作，建仓属初始化流程） |

## 实施记录

- 新增 `scripts/lib/git-flow.mjs`：ensureDevWorkflow / gitBranchState / workingTreeSnapshot /
  changedPathsSince / autoCommitForRun / itemCommitLog / itemOfCommit。
- `scripts/lib/core.mjs`：initData 先落 Git 工作流再建数据目录（失败不产生半初始化）。
- `scripts/lib/batch.mjs`：nextItem 预留即拍快照（run.treeSnapshot）；finishRun reported 核验通过后
  调 autoCommitForRun 并把概要附进回执；新增 retryAutoCommit。
- `scripts/atb.mjs`：`run autocommit`、`commit log`、`commit which` 子命令 + USAGE/输出更新。
- `scripts/server.mjs`：`GET /api/git/branch-state`、`POST /api/git/init-dev`（项目参数绑定）。
- `scripts/state-guard.mjs` + `hooks/hooks.json` / `hooks/codex.json`：流程外 git commit 拦截与豁免。
- `scripts/web/app.js` + `scripts/web/i18n.js`：设置页「Git 工作流」分区（状态行/按钮/确认/反馈/重试）、
  待测试条目「已提交」徽标、词典条目。
- 测试：新增 `scripts/tests/dev-flow-20260911-009.test.mjs`（D1–D12，真实 git 临时仓库 + CLI/子进程）；
  按新契约修正 4 个存量测试（commit-batch C1 非_git 场景改模拟存量项目、dispatch-api T2b 同、
  release-git mkEnv 发布场景显式回 main、commit-rollback E1 设置页两分区）。全量 203 个测试文件通过。

## 风险与边界

- `git commit --only` 语义依赖（已实测修改/删除/新增组合与预暂存隔离）；路径超长时分块 add/commit，
  同组可能拆为多条同消息提交（均含单号，索引不受影响）。
- 自动提交要求 git 提交身份（user.name/email）可用；缺失时按失败落账并给原因，不代配身份。
- 快照差集以「运行期间的变更」为准：worker 在领取前手改的非看板文件不会被卷入（符合预期）；
  运行期间外部进程并发改写工作区（impl 互斥下不应发生）可能被归因到本单。
- 流程外拦截是确定性静态解析（不展开 git 别名/包装脚本），与既有守卫口径一致：宁可拦常见形态，
  不做启发式放行；人工终端操作不经 hook，不受影响。
- 不改变状态机与人机分工：自动提交不动条目状态；accepted/planned/done 仍仅人工。
- 范围边界：自动提交绑定「批量开发批次」回执（batch.finishRun，即 atb run receipt 核验通路）；
  Codex 自动派发（scheduler 自有运行账本）不经该回执通路，暂不在自动提交范围（如需纳入另立单）。
