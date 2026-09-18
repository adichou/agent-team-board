# 设计 — BUG-20260908-020 已接受单的批次相关的显示需要删除

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260907-012（Web 看板为已接受条目引入「已入批次 / 未入批次」批次进入状态显示——卡片 chip、悬停说明、详情状态字段与操作 notice）；REQ-20260908-010（批量开发批次候选口径切换为「已计划（planned）且未认领」，已接受单不再随批次创建入批，该显示随之失效但仍渲染「未入批次」）。两编号均经 `atb list` 核验存在。

## 根因分析

REQ-20260907-012 上线时，批量开发批次面向已接受单取候选，「是否已入批次」是人工真正关注的派发状态，因此用批次 chip 替代了通用的「已接受」便签。REQ-20260908-010 起批次候选改为「已计划且未认领」（`scripts/lib/batch.mjs` 的 `candidateItems`），已接受单不再入批，`batchEntry` 仅在「入批后被移出计划退回已接受」的过渡态才非空，常态恒为「未入批次」——不携带任何区分信息。REQ-20260908-020 又为已接受单引入「未完善 / 完善中 / 已完善」三态徽标承载人工关注的状态，批次 chip 与之并排只剩噪音。前端特例分支（`acceptedEntryChip` / `acceptedEntryTitle` / 详情与 notice 的 accepted 分支）与服务端对 accepted 的 `batchEntry` 附加成了失活显示。

## 方案（实施记录）

按 README「期望行为」的建议方案做最小改动：直接移除 REQ-20260907-012 的 accepted 特例分支，恢复与其他状态一致的通用展示；服务端收窄 `batchEntry` 附加口径至 planned（批次派发面向已计划单）。

1. `scripts/web/app.js`
   - 删除 `acceptedEntryChip` / `acceptedEntryTitle` 两个函数；`BATCH_ENTRY_STATUS_LABEL` 保留（planned 的 notice 仍用）。
   - 列表卡片（`reqRowEl`）：已接受行恢复通用 chip `<span class="state s-accepted">已接受</span>`（走 LANE_LABEL 统一分支），悬停恢复 `LANE_HINT.accepted`（「已接受，可在详情页『移入计划』排入开发计划」）；完善三态徽标 `refineBadgeHtml` 保持在旁。
   - `renderBoard` 列表签名：移除 `it.batchEntry` 项——列表不再渲染任何批次内容，无需随入批/出批重绘（抽屉内 planned 的批次 notice 不依赖列表签名）。
   - 详情抽屉「状态」字段：恢复 `<span class="state s-accepted">已接受</span>`（STATE_LABEL 统一分支），已接受时追加完善徽标。
   - `drawerActionsNoticeHtml` accepted 分支：删除「已入批次 …，等待按批次派发实施。」入批文案，固定返回不含批次内容的指引（「未入计划。可点『移入计划』……或用 /dev 认领」）。
   - 注释同步：删除 REQ-20260907-012 特例注释，`planCandidates` 处「含已入批次未派发的单」措辞一并去除。
2. `scripts/server.mjs`：`/api/board` 与 `/api/item/:id` 的 `batchEntry` 附加条件由 `accepted || planned` 收窄为 `planned`——批次派发面向已计划单，已接受单不再下发该字段（planned notice 仍正常取到）。注释同步更新。
3. `scripts/lib/batch.mjs`：`batchEntryIndex` 本身按条目查批次、不区分状态，逻辑不动；仅更新头注释的消费口径描述。
4. 测试 `scripts/tests/accepted-batch-entry.test.mjs` 同步改写：L1/L2/L4/L5 断言改为「已接受恢复通用 chip、不出现任何批次文案」；L6 改写为源码级断言「列表签名不再包含 it.batchEntry」；S1（索引单测）保留不动；S2 改写为「accepted 不再附加 batchEntry 字段，planned 仍附加（入批 {batchId,status} / 未入批 null / finished 剔除），非 planned 不附加」。

## 风险与边界

- 已计划（planned）条目范围外内容零改动：详情 notice「已入批次 batch-xxx（…）」、批量实施面板（任务模块）批次/队列展示原样保留。
- 完善三态徽标、批量/单条「移入计划」、驳回接受（完善中禁用）等 accepted 既有交互不受影响（`planCandidates` 资格仍为 accepted）。
- 服务端不再对 accepted 下发 `batchEntry` 属于对外响应字段变化：app.js 内该字段唯一剩余消费者是 planned notice，无其他引用（已全仓核验）；CLI 输出本就不含该文案。
- 历史缓存响应若仍带 accepted 的 `batchEntry` 字段，前端已无任何读取点，不会渲染。
