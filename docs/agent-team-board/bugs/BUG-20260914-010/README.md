# BUG-20260914-010 批量开发暂扣待人工提交的改动缺少人工提醒通道

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：BUG-20260913-006（其修复引入 auto-commit 暂扣机制 pendingManual/heldGroups，只做账本落盘与回执上抛，未配套人工提醒通道）
- 创建：2026-09-14T04:52:10.537Z

## 现象

批量开发中 auto-commit 判定「预留前已脏且本单动过」的路径时，将 test/业务组整单暂扣
（pendingManual + heldGroups），仅提交 doc 组。这一「待人工核对提交」状态没有任何升级为人工
可见提醒的通道：批次正常收尾、看板无展示、调度会话不报告，人工只有主动翻
`dispatch/runs/<runId>/auto-commit.json` 账本或碰巧注意到回执 JSON 里的一行字段才会发现。

实际影响：2026-09-14 的 batch-20260913-048 一轮中，REQ-20260913-006（run-221）与
BUG-20260914-002/003/004/005（run-223~226）共 5 单的代码修复与测试被暂扣在工作区未提交，
批次最后以「本轮队列已处理完毕」正常 stop 结束，只字未提暂扣；四条 Bug 已人工确认 done，
但对应的 fix/test 提交至今缺位（`git status` 中 `scripts/**` 的改动即被暂扣内容）。

## 复现步骤

1. 任一非看板路径（如 `scripts/web/build.js`）处于已修改未提交状态（此前单据遗留）；
2. 启动一轮批量开发，某单实施中又修改了该路径并 `run receipt --result reported`；
3. auto-commit 将该路径列入 pendingManual，暂扣本单 test/业务组，仅提交 doc 组；
4. 观察三个应提醒处：
   - 主调度会话：回执 JSON 含 `autoCommit.pendingManual` 与 reason，但调度提示词要求
     「只接收短回执」「不逐项输出长总结」，无「出现 pendingManual 须报告人工」的指令——被当成功吞掉；
   - `atb batch check`：`checkBatch()` 的 nextAction 只看在途/needs_attention（failed、blocked）/
     终止/暂停/剩余数，`reported` 且带暂扣的运行算成功终态——notice 只报「队列已处理完毕」；
   - Status Board：「⚠ 待人工确认」聚合区为 `hold declare`（人工决策）专用，server.mjs 与
     web/build.js 中不存在任何 pendingManual 展示。

## 期望行为

暂扣发生时，人工在批次结束前就能从至少一条既有通道得知「有 N 单改动被暂扣待人工核对提交」，
且该提醒在人工处理（核对提交或显式忽略）前持续可见、处理后消失。具体要求：

1. `atb batch check` 的 notice（含收尾 stop 场景）列出本轮带 pendingManual/heldGroups 的单数
   与入口（如「3 单有暂扣待人工提交，明细见 dispatch/runs/*/auto-commit.json」）；
2. Status Board 有可见聚合（「⚠ 待人工确认」区新增暂扣类条目，或独立的「待人工提交」区），
   展示单号与暂扣路径，2 秒轮询自动刷新覆盖；
3. 主调度提示词含明确指令：回执出现 `autoCommit.pendingManual` 时立即向用户报告，不得当普通成功回执；
4. 人工提交（消息带单号）后提醒消失（以工作区/账本状态为口径，无需新增「忽略」动作）。

## 验收说明

按「先制造暂扣 → 逐通道核对 → 处理后消失 → 回归」的顺序人工验收（命令均在仓库根执行，
`<root>` 为项目绝对路径；暂扣制造方式同复现步骤）：

1. **制造暂扣并确认账本**：任一非看板路径（如 `scripts/web/build.js`）先改不提交，再跑一轮
   批量开发使某单动过该路径并上报；确认
   `docs/agent-team-board/dispatch/runs/<runId>/auto-commit.json` 已落盘
   `pendingManual`（路径数组）、`heldGroups`（`test`/`biz` 路径数组）、`pendingManualAdvice`
   与 `reason`（现状即如此，此步是验收前置而非修复点）。
2. **通道一 `batch check`**：`node scripts/atb.mjs batch check --dir "<root>"` ——
   运行中（continue）与收尾（stop，notice 现状为「本轮队列已处理完毕：实时队列已取空，可启动新一轮」）
   两种场景的 notice 均列出带暂扣的单数与明细入口（如「5 单有暂扣待人工提交，明细见
   dispatch/runs/*/auto-commit.json」）；响应总字节数仍 ≤ 2048（`CHECK_MAX_BYTES`），暂扣单过多时
   降级为计数 + 入口、不逐单列路径、不得触发「核对响应超过 2048 字节」报错。
3. **通道二 Status Board**：`node scripts/server.mjs` 后打开 `http://localhost:8888`
   （端口随 `ATB_PORT` 环境变量，缺省 8888）——需求模块列表下方「⚠ 待人工确认」聚合区出现
   「待人工提交」分组：单号、暂扣路径数、「明细」展开显示该单 `auto-commit.json` 的
   `pendingManual` + `heldGroups.test/biz` 路径清单与处理建议；无需手动刷新，2 秒主轮询自动
   覆盖出现与更新；接口失败时显示错误条 + 重试、保留上次数据（复用既有 `renderHolds()` 口径）。
4. **通道三 调度提示词**：重新 `node scripts/atb.mjs batch create`（会输出新的主调度提示词），
   检查提示词含明确指令：回执 JSON 出现 `autoCommit.pendingManual` 时立即向用户报告单号与
   暂扣路径数，不得当作普通成功回执。
5. **处理后消失**：按账本 `pendingManualAdvice` 人工核对后整文件提交（提交消息带单号）→
   下一次 2 秒轮询 / 下次 `batch check` 中该单从「待人工提交」分组消失；只提交部分暂扣路径时
   提醒仍在（消失判据为账本路径当前是否仍处于未提交脏状态，非账本改写）。
6. **回归**：无暂扣的正常轮 notice 不出现暂扣字样、看板无该分组（空态不占版面）；既有
   `hold declare`「待人工决策」分组展示与补决策/复工/确认完成操作不受影响；
   `scripts/tests`（含 `auto-commit-pre-dirty-20260913-006.test.mjs`）全部通过。

## 界面展示

可交互演示：**[./ui-demo.html](./ui-demo.html)**（单文件、内联 CSS/JS、无外网依赖、无构建步骤，
浏览器直接打开）。演示聚焦 Status Board 需求模块列表下方的「⚠ 待人工确认」聚合区与两条旁证
通道（`batch check` notice、主调度提示词），用「缺陷形态 ↔ 修复后」开关对照同一份数据下的
可见性差别；REQ-20260913-006 的暂扣路径取自真实账本 `dispatch/runs/run-20260914-221/auto-commit.json`，
其余单据路径为示意（以各单 auto-commit.json 为准）。

- **界面布局**：复用既有聚合区结构——区头「⚠ 待人工确认」+ 副说明行，其下分组渲染：
  「待人工决策」组（`hold declare` 既有卡片：单号、⚠ 等人工决策、未答计数、补决策/复工等操作）
  与新增「待人工提交」组（单号、暂扣路径数、[明细] 展开该单 `auto-commit.json` 的
  `pendingManual`/`heldGroups` 清单与处理建议、[模拟人工提交] 入口）。缺陷形态下「待人工提交」
  组完全不存在（数据在账本里但界面零展示），旁证的 `batch check` notice 只报
  「本轮队列已处理完毕」、调度提示词无 pendingManual 指令；修复后三者均可见。
- **交互行为**：缺陷/修复开关对照；「明细」逐单展开/收起账本路径清单；
  「模拟人工提交（消息带单号）」让该单在下一轮 2 秒轮询中从分组消失（演示持续可见→处理后消失）；
  「模拟新一轮产生暂扣」在下一轮轮询自动出现新卡片（演示 2 秒轮询自动刷新）；
  失败态「重试」经加载态恢复正常。
- **状态反馈**：正常（分组与卡片齐备）/ 加载（正在加载待确认清单…骨架）/ 失败
  （错误条「待确认清单加载失败」+ 重试，重试恢复）/ 空（无待决策且无暂扣时聚合区整体隐藏不占版面）
  四态切换；另附深浅色切换。缺陷形态固定为「正常」数据但处处不见暂扣，以突出信息被吞掉的对比。

聚合区线框（ASCII 仅作补充，实际以可交互演示与既有看板样式为准）：

```
┌─ ⚠ 待人工确认 ────────────────────────────────┐
│ ◇ 待人工决策（1）                              │
│   · BUG-20260914-0xx  ……  [复工]              │
│ ◇ 待人工提交（5）                              │
│   · REQ-20260913-006   暂扣 1 路径  [明细]     │
│   · BUG-20260914-002   暂扣 2 路径  [明细]     │
│   · BUG-20260914-003   暂扣 3 路径  [明细]     │
│   · BUG-20260914-004   暂扣 3 路径  [明细]     │
│   · BUG-20260914-005   暂扣 2 路径  [明细]     │
│ 人工核对后整文件提交（消息带单号）即自动消失   │
└───────────────────────────────────────────────┘
```

明细点开为该单 auto-commit.json 的 pendingManual / heldGroups 路径清单。
