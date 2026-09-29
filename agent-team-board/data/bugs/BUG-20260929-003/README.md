# BUG-20260929-003 发布模块硬编码 main 分支：master 主干项目创建发布即报 git rev-parse 失败

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-29T00:31:04.136Z

## 现象

现象：主干为 master 的项目（如 cili_search、DarlingHelper）版本计划合并完成后，在构建发布页点击「创建发布」立即报错：git rev-parse 失败：fatal: ambiguous argument 「refs/heads/main」: unknown revision or path not in the working tree，无法进入预检。

复现：仓库本地仅有 master 无 main（REQ-20260916-005 口径：master 主干不补建 main）→ 版本计划到 merged → 创建发布。

原因：scripts/lib/build-publish.mjs 多处硬编码 refs/heads/main——inputs() 冻结 mainSha、assertDocsReady() 文档合并核验、precheck 挑选条目、execute 的 sync-source 一致性比对与推送 refspec——均未接入 resolveMainBranch()（main→master 回退）；git-flow.mjs 与 build-git.mjs 已接入，发布执行器被遗漏。有 main 的项目不受影响。

期望：master 主干项目可正常创建发布并走完冻结/预检/执行/推送全流程，主分支名一律按 resolveMainBranch() 解析结果取用；有 main 的项目行为不变。

## 复现步骤

1.

## 期望行为
