# 设计 — BUG-20260929-003 发布模块硬编码 main 分支：master 主干项目创建发布即报 git rev-parse 失败

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260916-001（提交 e6f6267 引入构建发布执行器 scripts/lib/build-publish.mjs，冻结 / 预检 / 执行链路自诞生起即硬编码 refs/heads/main；BUG-20260916-001 已经 `atb show` 核验真实存在，状态 done）。
- 关联：REQ-20260916-005（引入 resolveMainBranch() main→master 回退并接入 git-flow.mjs / build-git.mjs，但未覆盖发布执行器，本缺陷由该覆盖缺口显性化）；BUG-20260928-014（sync-source 阶段改为 rev-parse 一致性比对，沿用同一硬编码）。

## 根因分析

（2026-09-29 会话排查，证据与结论）

1. **报错格式定位**：`git rev-parse 失败：fatal: …`（"失败" 前带空格）与 build-publish.mjs:12 的 command() 帮助函数输出（`` `${bin} ${args[0]} 失败：${stderr}` ``）完全一致；git-flow.mjs / build-git.mjs 的 gitOk() 默认标签无空格（`git rev-parse失败：`），测试脚本的 helper 格式为 `git <全部参数> 失败：`，均可排除。
2. **硬编码位置**：build-publish.mjs 中 `git(root,'rev-parse','refs/heads/main')` 共 4 处——inputs()（约 L65，冻结 mainSha）、assertDocsReady()（约 L129，文档合并核验）、precheck 挑选条目（约 L157）、execute 的 sync-source（约 L246，本地一致性比对）。create()（约 L95）无 try/catch 直接调用 inputs()，故「创建发布」点击即报错；precheck（约 L152）对 inputs() 有捕获，不在预检拦截。
3. **触发项目核实**：看板注册的 8 个项目中，cili_search 与 DarlingHelper 本地仅 master 无 main；两者版本计划 BLD-20260929-001 均已于 2026-09-29 到 merged（合并目标经 build-git 的 resolveMainBranch() 回退到 master，故合并步骤成功），首次走到「创建发布」即暴露本缺陷。其余项目（含 agent-team-board 本仓库与官网仓库 app-homepage-repo）均有本地 main，不受影响。
4. **与回退逻辑的覆盖缺口**：REQ-20260916-005 已把 resolveMainBranch()（优先 main，本地仅 master 时回退 master，两者皆无返回 null）接入 git-flow.mjs（gitBranchState / ensureMainBranch 等）与 build-git.mjs（同步跳过名单、合并目标、precheckMerge 等），发布执行器 build-publish.mjs 未同步接入，属覆盖遗漏而非新引入回归。

另：build-publish-store.mjs:19 的 validateRepo 也硬编码 `refs/heads/main`，但那是对**官网仓库**的准入校验（产品口径要求官网必须有 main 分支），与本项目源码仓库的主干选择无关，不在本单范围。

## 方案

（/dev 阶段细化；登记时方向）build-publish.mjs 接入 git-flow.mjs 的 resolveMainBranch()：冻结（inputs() 的 mainSha）、文档合并核验、条目包含性核验、sync-source 一致性比对与推送 refspec（`${mainSha}:refs/heads/<主分支名>` 及远端回验 refs 清单）统一按解析出的主分支名取用；resolveMainBranch() 返回 null（空仓库等无基点场景）时维持现有报错路径不变。既有 main 项目行为不变。

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界

- master 项目执行阶段将推送 `${mainSha}:refs/heads/master` 与 `${devSha}:refs/heads/dev`——与该类项目实际主干一致，不额外创建 main；
- 冻结记录中 `mainSha` 字段名沿用（语义为「主分支头」），展示层如需改名另行评估，避免破坏既有 run.json 兼容；
- validateRepo（官网必须有 main）维持现状，不随本单放宽。
