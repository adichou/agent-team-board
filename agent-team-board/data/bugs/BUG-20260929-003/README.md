# BUG-20260929-003 发布模块硬编码 main 分支：master 主干项目创建发布即报 git rev-parse 失败

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：BUG-20260916-001（引入的构建发布执行器 build-publish.mjs 自诞生起硬编码 refs/heads/main）
- 创建：2026-09-29T00:31:04.136Z

## 现象

主干为 master 的项目（本地无 main 分支，如 cili_search、DarlingHelper），版本计划合并完成后在构建发布页点击「创建发布」，立即报错，无法进入预检：

```
git rev-parse 失败：fatal: ambiguous argument 'refs/heads/main': unknown revision or path not in the working tree. Use '--' to separate paths from revisions, like this: 'git <command> [<revision>...] -- [<file>...]'
```

报错文案来自 build-publish.mjs 的 command() 帮助函数（`${bin} ${args[0]} 失败：${stderr}` 包装），触发点是同文件多处硬编码的 `git rev-parse refs/heads/main`。

## 复现步骤

1. 取一个本地仅有 master、无 main 分支的仓库（REQ-20260916-005 口径：master 主干不补建 main），如 cili_search 或 DarlingHelper；
2. 在看板创建版本计划并将条目合并入主分支——合并目标经 build-git 的 resolveMainBranch() 回退到 master，可正常到 merged；
3. 构建发布页点击「创建发布」→ 立即报上述错误（create() 无捕获地调用 inputs() → `git rev-parse refs/heads/main`）。

有本地 main 分支的项目（agent-team-board 自身、官网仓库等）不受影响——2026-09-29 凌晨本仓库 v1.0.0 发布（BPUB-711ea71f）即正常成功。

## 期望行为

- master 主干项目可正常「创建发布」并走完冻结 / 预检 / 确认计划 / 执行 / 推送全流程；
- 主分支名一律按 resolveMainBranch() 解析结果（优先 main，本地仅 master 时回退 master）取用，覆盖冻结 mainSha、文档合并核验、条目包含性核验、执行一致性比对与推送 refspec；
- 有 main 的项目行为不变。

## 验收标准

- 在仅有 master 的临时 git 仓库项目上：版本计划 merged 后可创建发布，冻结的 mainSha 为 master 头；执行阶段推送 refspec 与远端回验按 master 校验；
- 有 main 的项目（既有测试口径）全量回归通过；
- 「创建发布」不再出现 `git rev-parse 失败：fatal: ambiguous argument 'refs/heads/main'` 报错。

## 关联

- REQ-20260916-005：引入 resolveMainBranch()（main→master 回退）并接入 git-flow / build-git，但未覆盖发布执行器——本缺陷由该覆盖缺口显性化（详见 design.md 引入来源节）。
- BUG-20260928-014：sync-source 阶段改为 `rev-parse refs/heads/main` 一致性比对，同样沿用硬编码。
