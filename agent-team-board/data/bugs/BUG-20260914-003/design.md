# 设计 — BUG-20260914-003 为什么会显示无其他本地分支的？main 分支应该是要显示的

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260911-009（`atb list` 已核验存在，状态 done）
  - 该需求的 `ensureDevWorkflow()`（scripts/lib/git-flow.mjs）定义了空仓库初始化路径：`git init -b main` 后立即 `git switch -c dev`（未出生分支改名），首个提交落 dev，`refs/heads/main` 从未被创建。本仓库即经此路径初始化，main 从未出生。
  - 交互界面属构建模块「分支浏览」（REQ-20260913-001 建立）：其「本地」分组如实渲染 git 状态，显示链路无缺陷；缺陷在于初始化工作流不保障 main 出生，且界面无解释，与后续模块（合并入 main 依赖本地 main）的前提不符。

## 根因分析

1. **显示链路无缺陷**：`listBranches()`（scripts/lib/build-git.mjs）用 `git branch --format=%(refname:short)` / `git branch -r` 取分支，`renderBranchesPane()`（scripts/web/build.js）如实渲染——本地无 main 时「（无其他本地分支）」是真话，不是漏列。
2. **main 从未出生**：`ensureDevWorkflow()` 空仓库路径下首个提交落 dev，无任何代码路径会创建 `refs/heads/main`。构建模块「合并入 main」`precheckMerge()` 要求 `refs/heads/main` 存在 → 本仓库该核心流程报「main 分支不存在」不可用，而分支浏览界面无任何提示，用户无从解释 main 去向。
3. **落差本质**：「用户预期 main 存在并显示」（构建模块的隐含前提）与「初始化工作流从不保障 main 出生、界面无解释」之间的落差。

## 方案

**定案：方向 a + b 组合（产品侧修复为主，本仓库经产品路径补建）**

1. **数据层（根因修复，scripts/lib/git-flow.mjs）**：新增 `ensureMainBranch(root)`——仓库已有提交且 `refs/heads/main` 缺失时，在当前分支历史的根提交（`git rev-list --max-parents=0 HEAD` 首行；多根历史取首行）上 `git branch main <root>` 补建本地 main。约束：不切换分支、不推送远端、不触碰工作区与未提交改动；幂等（main 已存在则不动）。`ensureDevWorkflow()` 收尾调用并在返回值中携带 `mainCreated`。入口保持不变（`atb init` / 设置页「Git 工作流」初始化，均为人工显式动作）：
   - 存量仓库（含本仓库）：下次执行「Git 工作流」初始化（幂等重入）即补齐 main；
   - 新空仓库：首个提交落 dev 后的再次 ensure 自动补建（空仓库尚无基点时跳过、不报错）。
2. **UI 提示（可解释性，scripts/web/build.js）**：分支浏览「本地」分组在分支数据加载成功、`local` 非空且不含 `main` 时，渲染明确提示：本地缺少 main、版本计划「合并入 main」将报「main 分支不存在」（与 `precheckMerge` 报错口径一致）、引导到「设置 → Git 工作流」执行初始化（幂等，将在首个提交上补建 main，不推送远端）。加载中 / 读取失败 / 非 git 阶段不渲染；既有空态文案（「（无其他本地分支）」等）不变。
3. **仓库侧（本仓库落地）**：修复合入后经产品路径（调用 `ensureDevWorkflow`，等价设置页按钮）对 agent-team-board 仓库补建本地 main（基点=根提交 `b7225d0`），**不推送远端**——推送留给用户经分支浏览「推送」按钮（首推 -u 建跟踪）显式执行。补建后：分支浏览「本地」分组显示 main；「合并入 main」前置校验通过。
   - 落地时发现本仓库 `.git/config` 早已存在休眠的 `branch.main.remote=origin / branch.main.merge` 用户配置（早期 HEAD 未出生 main 期间的遗留，`git branch` 建引用不写该配置）：补建后该配置生效，`git branch -vv` 显示 `main … [origin/main: gone]`（远端为空仓库）。属用户既有配置，不动它——对界面无影响（分支浏览不渲染上游状态），用户点「推送」时即按既有跟踪直接推送 origin。

**开源选型（REQ-20260909-015）**：不引入开源库。自研理由：无合适库——本修复仅是「本机 git 子进程调用 + 既有前端渲染」的极薄领域逻辑，Node 标准库（child_process / fs）完全覆盖，不存在也不需要「main 出生保障」类三方库；未创建 licenses.md。

## 风险与边界

- 补建只创建本地分支，绝不 push / 不切分支 / 不动工作区与未提交改动；幂等可重入，可用 `git branch -D main` 完全撤销。
- 多根历史仓库取 `rev-list --max-parents=0` 首个根提交作基点（罕见场景，代码注释写明）。
- master-only 仓库经人工显式「Git 工作流」初始化采纳 dev 工作流时同样会补建 main——该入口本身即「采纳 main+dev 工作流」的显式授权。
- 前端提示仅在分支列表加载成功后判定，不影响加载中 / 失败重试 / 非 git 引导空态，也不改动既有空态文案口径。
- 回归面：`ensureDevWorkflow` 既有调用方（initData / 设置 init-dev）返回值仅新增字段；D1–D4 既有断言（dev 创建切换、main 保留、空仓库路径）不受影响。
