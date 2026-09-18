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

1.

## 期望行为
