# BUG-20260914-014 回退 BUG-20260914-010

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-14T07:19:58.354Z

## 现象

BUG-20260914-010（「批量开发暂扣待人工提交的改动缺少人工提醒通道」）已由批次 batch-20260913-048
的实现单 run-20260914-232 开发并上报（状态 in-progress、待人工确认完成），但**实现方案被人工判定为
太差，要求先回退**。该实现单自身又命中暂扣路径，全部代码改动暂扣在工作区、未产生 fix/test 提交
（账本 `docs/agent-team-board/dispatch/runs/run-20260914-232/auto-commit.json`：`commits` 仅含
doc 提交 820c4eb，`pendingManual` 4 路径 + `heldGroups` test 1 / biz 2 路径）。当前 `git status`
中 `scripts/**` 的未提交改动里即包含这套实现。

BUG-010 引入的改动共 7 处（均以未提交修改/新增文件形式存在于工作区，且与 BUG-20260914-003 /
004 / 005 / 006 / 009 / 011 等其他单的暂扣改动混在同一批文件中）：

1. `scripts/lib/batch.mjs` —— `generatePrompt()` 新增「回执出现 autoCommit.pendingManual 立即
   报告」调度指令（通道三）；`checkBatch()` 新增暂扣计数拼入 notice 逻辑（通道一）；
2. `scripts/lib/git-flow.mjs` —— 新增导出函数 `pendingManualRuns()`（暂扣运行盘点，通道一/二
   共用口径）；
3. `scripts/server.mjs` —— `/api/holds` 响应新增 `pendingCommits` 字段（通道二服务端）；
4. `scripts/web/app.js` —— 新增 `pendingCommitCardHtml()`、「待人工提交」卡片与
   `pendingExpanded` 状态，`renderHolds()` 改为「待人工决策 / 待人工提交」两组渲染（通道二前端）；
5. `scripts/web/i18n.js` —— 新增「⚠ 待人工提交」「明细 / 收起明细」「暂扣 ◇ 路径」等一批
   静态词典与 EN_DYNAMIC 动态词条；
6. `scripts/web/style.css` —— 新增 `.hold-group-head` / `.hold-group-foot` / `.hold-detail` /
   `.hold-paths` 等样式；
7. `scripts/tests/bug-held-notice-20260914-010.test.mjs` —— 新增测试文件（未跟踪）。

「太差」的具体维度（如通道设计、实现方式、测试口径中哪一项不合格）登记时未说明——**待确认**；
本单只承接回退，不重新设计替代方案。回退后 BUG-20260914-010 本身如何处置（重开、重新规划或
另行立项）亦**待确认**，由人工在看板上决定，不在本单范围。

## 复现步骤

在仓库根 `/Users/adichou/Documents/src/agent-team-board` 执行（回退完成前可随时观察到下列状态）：

1. `git status --short` —— `scripts/lib/batch.mjs`、`scripts/lib/git-flow.mjs`、`scripts/server.mjs`、
   `scripts/web/app.js`、`scripts/web/i18n.js`、`scripts/web/style.css` 为已修改（M），
   `scripts/tests/bug-held-notice-20260914-010.test.mjs` 为未跟踪（??）；
2. `git diff scripts/lib/batch.mjs` —— 可见注释标注 `BUG-20260914-010 通道一/通道三` 的两处
   代码块（generatePrompt 指令行 + checkBatch 暂扣 notice 块）；
3. `node scripts/server.mjs` 打开 `http://localhost:8888` —— 需求模块列表下方「⚠ 待人工确认」
   聚合区出现「◇ 待人工提交（N）」分组：卡片含单号、「⚠ 待人工提交」角标、暂扣路径数、
   [明细] 展开账本路径清单与处理建议（N 含 run-221/223~226/232 等仍脏的运行，随工作区状态变化）；
4. `node scripts/atb.mjs batch check --dir "<项目绝对路径>"` —— 本轮存在 reported 且带暂扣的
   运行时，notice 含「N 单有暂扣待人工提交，明细见 dispatch/runs/*/auto-commit.json」一行；
5. 查看 `docs/agent-team-board/dispatch/runs/run-20260914-232/auto-commit.json` —— 暂扣路径与
   「现象」节所列 7 处一一对应。

## 期望行为

撤销 BUG-20260914-010 引入的全部代码改动，把上列 7 处恢复到 010 实现前状态（即 HEAD 820c4eb
对应内容），同时**不波及同文件中其他单的暂扣改动**、不破坏既有功能：

1. **逐处回退**（hunk 级，禁止对混有其他单改动的文件整文件 restore）：
   - `batch.mjs`：删除 generatePrompt() 的 pendingManual 指令行与注释块、checkBatch() 的暂扣
     notice 块（`gitFlow.pendingManualRuns` 调用随之移除，文件顶部如仅为 010 加的 import 一并还原）；
   - `git-flow.mjs`：删除 `pendingManualRuns()` 函数——保留同文件中 BUG-20260914-003 的
     `ensureMainBranch()` 等改动；
   - `server.mjs`：删除 `/api/holds` 中的 `r.pendingCommits = …` 行——保留 BUG-20260914-004 /
     009 / 011 的 build API 改动；
   - `app.js`：删除 `pendingCommitCardHtml()`、`state.holds.pendingExpanded`，`renderHolds()`
     还原为 010 之前只渲染 `items` 的单组形态（空态隐藏、签名剪枝、错误/重试口径不变）；
   - `i18n.js`：删除 010 新增的静态与 EN_DYNAMIC 词条——保留分支浏览等其他单文案；
   - `style.css`：删除 010 新增的 4 组选择器——保留其他单样式；
   - 删除 `scripts/tests/bug-held-notice-20260914-010.test.mjs`；
2. **行为恢复到 010 实现前**：`/api/holds` 响应不再携带 `pendingCommits`；看板「⚠ 待人工确认」
   区不再有「待人工提交」分组（回到仅「待人工决策」卡片、空态整体隐藏）；`batch check` notice
   不再出现暂扣统计行；新生成的调度提示词不再含 pendingManual 立即报告指令；
3. **历史保留**：BUG-20260914-010 条目文档（README / design / test-report / ui-demo.html）与
   `dispatch/runs/` 账本不删除、不改写；010 的看板状态由人工处置（待确认），本单不动其状态机；
4. 回退改动按项目既有流程落一个带本单号 `BUG-20260914-014` 的提交（与其他单暂扣改动分开归因）。

## 验收说明

按「残留清零 → 行为回归 → 他人改动完好 → 测试 → 历史保留」顺序核对（命令在仓库根执行）：

1. **代码残留清零**：
   - `ls scripts/tests/bug-held-notice-20260914-010.test.mjs` 不存在；
   - `grep -rn "pendingManualRuns\|pendingCommits\|BUG-20260914-010\|bug-held-notice-20260914-010" scripts/`
     无任何命中（函数名、字段名、单号注释与测试文件名均为 010 独有标识）；
   - 「待人工提交」相关中文文案（`grep -rn "待人工提交" scripts/web/i18n.js scripts/web/app.js`）
     在 010 相关位置无残留——注意与 BUG-20260913-006 注释里描述暂扣机制本身的措辞区分，以人工
     核对为准；
2. **行为回归**：
   - 启动 `node scripts/server.mjs`，`curl http://localhost:8888/api/holds` 响应无 `pendingCommits`
     字段；页面「⚠ 待人工确认」区仅呈「待人工决策」卡片形态（无分组头「◇ 待人工决策（N）」/
     「◇ 待人工提交（N）」），无待决策且无暂扣时整区隐藏；
   - `node scripts/atb.mjs batch check --dir "<项目绝对路径>"`：notice 不再含「N 单有暂扣待人工
     提交」字样（本轮存在带暂扣 reported 运行的场景下核对）；
   - `node scripts/atb.mjs batch create` 输出的新调度提示词不含「autoCommit.pendingManual …立即
     向用户报告」指令行；
3. **其他单改动完好**（回退误伤检查）：`git diff` 仍包含 `git-flow.mjs` 的 `ensureMainBranch()`
   （BUG-20260914-003）、`server.mjs`/`build-git.mjs`/`build-store.mjs` 的 build API 改动
   （004/009/011）、`i18n.js` 分支浏览词条（005/006/011）、`style.css` 分支浏览样式（003/006/009）、
   未跟踪的 `bug-branch-main-*.test.mjs`（003/012）等；
4. **测试与构建**：`node --test scripts/tests`（全量）通过、0 失败（010 测试文件删除后其余用例
   不受影响）；`node scripts/web/build.js` 构建正常；
5. **历史保留**：`docs/agent-team-board/bugs/BUG-20260914-010/`（README/design/test-report/
   ui-demo.html）与 `docs/agent-team-board/dispatch/runs/run-20260914-232/auto-commit.json` 内容
   未被本回退改动。

## 界面展示

可交互演示：**[./ui-demo.html](./ui-demo.html)**（单文件、内联 CSS/JS、无外网依赖、无构建步骤，
浏览器直接打开）。回退会移除看板「⚠ 待人工确认」区的「◇ 待人工提交」分组并改动界面，故演示以
「回退前（BUG-010 实现形态）↔ 回退后（期望形态）」开关对照同一份数据下的界面差别；暂扣数据取自
真实账本（run-20260914-221 / 223~226 / 232 的 `pendingManual` + `heldGroups`），「待人工决策」
卡片为示意（以 `holds/holds.json` 实际内容为准）。

- **界面布局**：复刻看板需求模块列表下方的「⚠ 待人工确认」聚合区——区头计数 + 副说明行 + 卡片
  流。回退前：两组渲染，「◇ 待人工决策」卡片（单号、⚠ 角标、未答计数、补决策/复工）与
  「◇ 待人工提交」分组（单号、⚠ 待人工提交角标、暂扣 N 路径、[明细] 展开账本路径清单与处理
  建议、组尾提示）。回退后：「待人工提交」分组及其样式整体消失，仅剩原「待人工决策」单组形态
  （暂扣数据仍在账本中但界面零展示，回到 010 实现前的状态）。页面另附两条旁证通道的对照：
  `batch check` notice（回退前多一行暂扣统计 / 回退后仅「本轮队列已处理完毕」）与 `/api/holds`
  响应 JSON 片段（回退前含 `pendingCommits` / 回退后无该字段）。
- **交互行为**：回退前/回退后开关对照同一数据；「明细」逐单展开/收起 run 的
  pendingManual/heldGroups 路径清单（仅回退前可用）；「模拟人工提交（消息带单号）」演示卡片在
  下一轮 2 秒轮询中消失（仅回退前）；「模拟新一轮产生暂扣」演示轮询自动出现新卡片（仅回退前）；
  失败态「重试」经加载态恢复。
- **状态反馈**：正常（卡片齐备）/ 加载（正在加载待确认清单…骨架）/ 失败（错误条「待确认清单
  加载失败」+ 重试，重试恢复）/ 空（无待决策且无暂扣时聚合区整体隐藏不占版面）四态切换；
  另附深浅色切换。回退后形态下暂扣相关交互全部不可用（控件随分组一起消失），以突出对照。
