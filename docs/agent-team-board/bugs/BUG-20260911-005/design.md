# 设计 — BUG-20260911-005 增加了批量 commit 功能后，要在已完成列表中添加“开始 Commit”按钮，布局和已接受和已计划的一样

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**BUG-20260910-014**（批量 Commit 功能 UI；编号已经 `atb list` 核验真实存在，
  状态 in-progress）。REQ-20260910-013 提供 CLI 命令组，BUG-20260910-014 上线任务模块
  「批量 Commit」面板与已完成条目徽标时，未同步扩展 REQ-20260909-007 建立的
  `#laneQuickEntry` 档位快捷入口映射，导致已完成档缺直达入口。

## 根因分析

`scripts/web/app.js` 的 `syncAcceptance()` 中快捷入口配置是按档硬编码的三元链，
BUG-20260910-014 加入批量 Commit 面板（`gotoRuns('commit')` / `refreshCommit()` /
`data-bmode="commit"` 页签均已存在）时未在该链中加 `done` 分支（conf 为 null，按钮保持
hidden）；`#laneQuickEntry` 点击处理器（`app.js:6690`）同样只有
`accepted → refine`、其余 → `develop` 两个分支，无 `done → commit` 映射。面板能力与
入口映射分处两处代码，后者按档枚举、新档接入需显式登记，漏登记即出现本缺陷。

## 方案

不新增按钮节点，复用 REQ-20260909-007 的常驻 `#laneQuickEntry` 节点与 `#captionActions`
布局（同行、空间足够时靠右、`btn small primary`），仅扩展两处映射：

1. `syncAcceptance()` 快捷入口 conf 增加 `done` 分支：
   `{ label: '▶ 开始 Commit', title: '进入任务模块批量 Commit 面板：对已完成条目批量归因提交到本地 Git（与勾选无关；只 commit 不 push）' }`，
   aria-label 沿用既有 `conf.label` 同步机制；其余档（待接受 / 开发中 / 待测试）仍为 null 隐藏。
2. `#laneQuickEntry` 点击处理器扩为三分支：
   `gotoRuns(state.reqFilter === 'accepted' ? 'refine' : state.reqFilter === 'done' ? 'commit' : 'develop')`。
   仅导航：切任务视图 + 激活批量 Commit 页签 + 拉取 `/api/commit/current`；不创建任务、
   不弹确认、不执行 Git，任务创建仍由面板内「启动」承接（无已完成候选时禁用并说明，
   BUG-20260910-014 既有逻辑不动）。

**开源选型（REQ-20260909-015）**：自研理由——无合适库：改动是对既有单文件前端内两处
档位映射的 3 行扩展（配置对象 + 三元分支），引入任何 UI/路由库的成本与体积都远高于自研，
且项目 web 端为零依赖原生 JS 架构。未引入开源库，不创建 licenses.md。

## 风险与边界

- 既有映射回归：已接受 →「开始完善」（refine）、已计划 →「开始开发」（develop）不变；
  由 lane-quick-entry-20260909-007.test.mjs（Q1-Q6，已按新契约更新 done 档口径）守护。
- 轮询口径：沿用 syncAcceptance 只 toggle hidden / 改文案、不重建节点，无闪烁；
  批量操作进行中不禁用（仅导航）。
- 不触碰：批量 Commit 面板本体、启动禁用逻辑、提交状态徽标、后端 /api/commit/* 接口。
- 文案含英文单词「Commit」，与既有「批量 Commit」页签用语一致（README 待确认项维持现状）。
