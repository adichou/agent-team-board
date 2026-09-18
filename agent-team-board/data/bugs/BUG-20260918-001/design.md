# 设计 — BUG-20260918-001 serve 轮询实时 git 扫描持 index.lock，与终端 git 写操作互相锁冲突

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**BUG-20260915-003**（经 `atb list` 核验存在）——该单把挂起确认面板的计数/文件表/核验
  改为「候选范围实时扫描」同源口径（confirm-store.mjs `scopeOfRec` 每次 viewRecord 都调
  `confirmScopeForRun` → `workingTreeSnapshot` 全量 git status），使 2 秒轮询
  `/api/confirms` 每次都实时扫描工作区，成为持锁高频入口；底层 `gitRaw` 助手无
  `--no-optional-locks` 注入则源自 REQ-20260911-009（git-flow.mjs 创建之初），两单叠加构成本 Bug 现场。

## 根因分析

- 链路（与 README 一致，修复时复核确认）：前端 2s 轮询 → `GET /api/confirms`（server.mjs）→
  `listConfirms` / `legacyConfirmViews` / `confirmDetail`（confirm-store.mjs）→ `scopeOfRec` /
  `pathStates` → `confirmScopeForRun` / `workingTreeSnapshot` / `fileDiffText`（git-flow.mjs）→
  `gitRaw` → `spawnSync('git', args)`（**无 `--no-optional-locks`**）。
- `git status` / `git diff` 等读取类命令默认做「机会性刷新 index stat 缓存」的可选写，须先创建
  `.git/index.lock`；脏路径越多持锁窗口越长，与终端 `git add`/`git commit` 持锁窗口重叠即互报
  `fatal: Unable to create '.git/index.lock': File exists`。
- 修复阶段实测补全的持锁调用清单（本仓库 serve 进程内、随轮询/调度周期反复执行）：
  1. `git-flow.mjs` `workingTreeSnapshot`：`git status --porcelain -uall`（/api/confirms 清单、
     详情、pathStates、确认核验共用）——主犯；
  2. `git-flow.mjs` `fileDiffText`：`git diff HEAD -- <path>`（/api/confirms/:id/diff 详情差异）；
  3. `scripts/lib/scheduler.mjs` `gitStatusSnapshot`：`git -C root status --porcelain`（批量执行期
     serve 进程内工作区探针，tick 周期运行）——即 README 佐证段「脚本运行期间仍出现锁冲突」的
     未覆盖点之一（该探针与 status 同样受 core.optionalLocks 约束，但配置级兜底不如命令级注入确定）。
  其余 serve 读链路（rev-parse / branch / symbolic-ref / remote / log / ls-files）只读 refs 或
  对象库、不触碰 index，无持锁问题；写链路（init / switch / add / commit）的锁为本职所需，不动。

## 方案

`git status` / `git diff` 等 git 内建即支持 `--no-optional-locks` 全局选项（等价
`GIT_OPTIONAL_LOCKS=0`，优先级高于仓库 `core.optionalLocks` 配置与环境），禁用机会性 index
刷新即可使只读扫描彻底不创建 index.lock——属 git 官方为该场景提供的标准能力，无冲突点。

- `scripts/lib/git-flow.mjs`：`gitRaw` 对只读子命令（status / diff / log / show / ls-files /
  rev-parse / rev-list / symbolic-ref / for-each-ref / describe / merge-base / cat-file / remote）
  统一前置注入 `--no-optional-locks`；写命令（init / switch / branch / add / commit）不注入，
  report 收口等写链路行为不变（期望行为 4）。
- `scripts/lib/scheduler.mjs`：工作区探针 `git -C root status --porcelain` 同样前置注入。
- 不叠加 TTL 缓存：期望行为 3 允许「实时计数继续随轮询刷新」的最小改动口径，实时性与统计
  输出保持原样，避免缓存一致性的额外风险面。
- 测试：`scripts/tests/bug-20260918-001.test.mjs`——独立进程忙循环监视 `.git/index.lock` 的并发
  实测（900 脏路径现场）、PATH shim 捕获真实 argv 断言注入面与写命令不注入、scheduler 探针
  源扫描、快照口径与直连 git status 一致、并行写持锁容错。

**开源选型（REQ-20260909-015）**：自研（理由：引入成本高于自研——修复为 git 官方内建全局选项的
两处注入与配套测试，无需任何第三方库；无「npm 依赖能更优实现一行 git 选项注入」的合理候选）。
未引入开源库，不创建 licenses.md。

## 风险与边界

- `--no-optional-locks` 需 git ≥ 2.15（2017-09 发布）；本机实测 2.49.0 通过，当代环境无兼容性风险。
- 注入后 git 不再机会性回写 index stat 缓存，index 缓存陈旧只会让后续某次真实写命令
  （add/commit）多付一次全量 stat 比对，不影响正确性；轮询面板口径与文案不变（W5 断言）。
- 写命令严格不注入：ensureDevWorkflow / autoCommitForRun / supplementCommitForRun 行为逐字不变
  （W3 断言 + dev-flow / auto-commit / closeout 既有回归全绿）。
- 终端侧撞锁的另一残余来源（worker 自身 report 收口的 git add/commit 与终端并发）属本职持锁，
  不在本单范围；本单只消除「只读轮询扫描持锁」这一非常规来源。
