# 设计 — BUG-20260909-006 已计划列表中的选择进入批量开发的功能去掉，因为已经有批量开发队列了。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260906-018（引入「已计划列多选进入批量开发」入口与勾选范围推送链路：复选框 + `#implGo` + `enterBatchImpl` + `POST /api/dispatch/scope` + 调度范围过滤）；REQ-20260908-010（批量实施改口径为已计划队列并把入口改名「批量开发」，但保留了勾选范围链路，使其与队列口径并存）。两编号均经 `atb list` 核验真实存在（2026-09-09，均 in-progress）。

## 根因分析

REQ-20260907-004 起批量开发页面化为任务模块、REQ-20260908-020 起子面板以「已计划队列（最旧优先、运行中新置计划自动进入）」为唯一开发范围口径；而 REQ-20260906-018 引入的「列表勾选 → 推送派发范围」链路未被拆除，形成两套并存的开发范围口径：

- 从「已计划」列表勾选进入过一次后，服务端调度器（`scripts/lib/scheduler.mjs`）被 `scope` 过滤为只派发勾选子集，未勾选的已计划单不自动派发，与「运行中新置计划的条目自动进入队列」的既定心智矛盾；
- 范围是服务端内存态，仅 Codex 面板 notice 与创建面板 scopeLine 两处提示，「已计划」列表页本身无任何范围标记（隐性全局状态）；
- REQ-20260909-002 起零勾选隐藏整个批量操作组，`#implGo` tooltip 的「未勾选已计划条目时为全部候选」成为不可达死文案。

结论：入口与范围机制整体冗余，应移除，批量开发入口唯一收敛为任务模块、口径唯一化为已计划队列。

## 方案

### 前端（`scripts/web/index.html`、`scripts/web/app.js`）

- `index.html`：删除 `#implGo` 按钮及其 tooltip；`#selGroup` 右组已计划档仅剩「移出计划」。
- `app.js` 移除范围推送链路：`enterBatchImpl`、`pushImplScope`、`pushImplScopeClear` 三个函数；`state.impl` 的 `scopeActive` / `scopeSig` 字段；项目切换 `switchProject` 中的旧项目清范围推送与字段重置；复选框 change、`selectOperable` / `deselectOperable`、`syncImpl` 中的推送调用；`syncImpl` 的 `#implGo` title 同步块；`syncAcceptance` `laneOfBtn` 的 `#implGo` 项；事件绑定区 `#implGo` click 监听。
- 面板呈现清理：Codex 面板 `st.scope`「本批范围：勾选 N 项」notice；`CX_WAITING_LABEL` 的 `scope-empty` 文案；`renderZcodeBatchPanel` 的 scopeLine（两处插值）；`refreshBatch` 拉取 `/api/batch/current` 不再拼 `?ids=`；「启动新一轮」title 去掉勾选范围措辞，改为队列口径。
- `createBatchAndCopy`：删除「缺省沿用勾选集合」回退；保留 `opts.ids` 显式入参（见下）。
- **复选框保留**（`data-impl-id`，资格不变 = planned 未认领）：已计划档勾选集合现仅为「移出计划」服务，全选/全不选、计数、进行中防误触、成功/失败分列反馈、轮询剪枝均不回归。批量开发入口唯一收敛为顶栏「任务」→「批量开发」子面板。

### 服务端处置：**删除（不保留 dormant）**

- `scripts/server.mjs`：删除 `POST /api/dispatch/scope` 路由；删除 `GET /api/batch/current` 的 `?ids=` stats 过滤分支（无调用方后不可达）。
- `scripts/lib/scheduler.mjs`：删除 `S.scope` 字段、`status().scope`、`selectCandidate` 的范围过滤与 `scope-empty` blocker、`disable()` 中的清范围、`setScope()` 方法。
- 依据：全仓检索（scripts/ 全部 *.mjs）确认移除前端链路后 `/api/dispatch/scope` 无任何调用方（仅测试引用）；`scope` 为纯内存态、无持久化消费方，保留即不可达死代码，与「口径唯一化」目标冲突，故同步删除。
- **保留 `ids` 入参**：`scripts/lib/batch.mjs` `createBatch({ ids })` 与 `server.mjs` `POST /api/batch/create` 的 `body.ids` 透传保留——REQ-20260908-026「终态任务按原配置重试本项」以单条目重建批次（`app.js` `retryRunFromRecord` → `createBatchAndCopy(agent, { ids: [rec.itemId] })`）仍依赖该入参，其语义是「显式指定候选」，与已移除的「列表勾选范围」无关。

## 风险与边界

- 「移出计划」批量功能是同链路复用方：复选框、`state.impl.selected`、`syncImpl` 剪枝、`removeFromPlan` 全部保留，测试 S 系列（selection-lane-scope）相应断言保留并补「已计划档无进入批量开发」的反向断言。
- 老用户若曾依赖「只开发勾选子集」：等价能力由「移出计划」（把暂不开发的单退回已接受）承担，与 README 待确认项的处置一致。
- `/api/dispatch/status` 响应不再含 `scope` 字段：仅 Codex 面板消费过，已同步移除提示。
- 测试更新：`impl-scope.test.mjs`（S3/S4/S5/S6 改为移除后契约，S1/S2 保留验 `ids` 冻结）、`impl-entry-ui.test.mjs`（E1/E4/E5/E7/E8/E9/E10/E11 重写为移除后行为）、`selection-lane-scope.test.mjs`（S1/S2/S7 调整）、`batch-ui.test.mjs`（U1）、`planned-chip-dedup.test.mjs`（T1 文案）。
- 「本批范围已处理完毕」notice（`atb.mjs` / `batch.mjs` 收尾文案）指批次冻结候选集，与勾选范围无关，保留。

## 实施记录（2026-09-09，zcode-batch-019-1）

- 按上述方案完成移除：前端 `#implGo` / `enterBatchImpl` / `pushImplScope` / `pushImplScopeClear` / `scopeActive` / `scopeSig` / Codex 范围提示 / `scope-empty` 文案 / scopeLine / `?ids=` 拉取 / 创建勾选回退全部删除；服务端 `/api/dispatch/scope` 路由、scheduler `scope` 机制（字段/过滤/blocker/setScope/disable 清理）、`/api/batch/current` ids 过滤分支删除；`createBatch({ids})` 保留（REQ-20260908-026 单条目重试），空集报错文案同步改为「指定的条目」。
- TDD：先更新 `impl-scope` / `impl-entry-ui` / `selection-lane-scope` / `batch-ui` / `planned-chip-dedup` 断言为移除后行为并确认跑红（7 处），实施后随批修复 `next-batch-entry`（N3 勾选回退断言）、`planned-state`（S16）、`selection-bar-merge`（M4/M6）三处旧断言。
- 验证：`npm test`（`node scripts/tests/run-all.mjs`）112 个测试文件全部通过，失败 0。
- 无新问题登记（未发现新缺陷）。
