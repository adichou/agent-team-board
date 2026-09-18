# 设计 — BUG-20260910-014 批量 Commit 功能需要有 UI

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260910-013（经 `atb list` 核验存在：`增加一个批量commit 的功能，要求参考批量完善和批量开发的。`）
- 归因依据：该需求实现了批量 commit 全套 CLI（`atb commit create/next/done/fail/release/check/summary/records/pause/abort` +
  `scripts/lib/commit-store.mjs`），其 design §7 明确决策「首期仅 CLI（Status Board 任务模块入口不在本批范围，后续单另立）」。
  本 Bug 即该决策遗留的 UI 缺口（原始用户诉求含通过看板使用该能力），非实现缺陷。

## 根因分析

- `scripts/web/app.js` 的任务模块一级页签（`batch-modes`）与 `refreshBatch` 只定义 refine/develop 两种模式
  （`GLOBAL_KIND_LABEL` 同样仅 develop/refine），没有 commit 类型入口；用户无法从看板发现、创建、监控批量提交任务。
- `scripts/server.mjs` 没有任何 `/api/commit/*` 接口——CLI 能力（commit-store）与看板之间没有数据通道；
  需求模块的已完成条目也没有「是否提交/提交号」数据源（commit 账本 `docs/agent-team-board/commits/` 从未下发给前端）。
- 根因归类：能力交付时按 design §7 显式裁剪了 UI，无对应后续实施——补齐即可，不涉及既有行为缺陷。

## 方案

**开源选型（REQ-20260909-015）**：自研，未引入开源库。理由：本单全部为既有看板（零依赖 Node http 服务 +
原生 JS 前端）与既有 commit-store 的胶水层——接口转发、HTML 渲染与剪贴板操作均复用项目内既有模式
（refine 面板 / runAttemptsHtml / copyId），无合适的第三方库承担该职责；未使用开源库，不创建 licenses.md。

### 1. 服务接口（scripts/server.mjs 新增，与 refine 端点同构）

- `GET /api/commit/current`：无批次 → `{ batch: null, stats.candidates }`（done 口径实时计数）；
  有批次 → 批次公开视图（含 prompt）/ 当前运行（含标题）/ 计数 / 记录（5 条）/ recordsTotal /
  `pending`（剩余候选编号，领取序；标题由前端从看板数据补齐，避免账本透出全队列载荷）/ nextAction / notice。
- `POST /api/commit/create`：body `{ developer, includeReported? }` → `commitStore.createCommitBatch`
  （幂等返回未结束批次）；UI 默认不带 include-reported（README 待确认：以 done 候选口径为基线，
  服务端仅透传严格布尔，供人工后续确认后启用）。
- `POST /api/commit/pause`：终态批次先经 `commitBatchTerminalReason` 拒绝（400，不静默成功）。
- `POST /api/commit/abort`：人工终止（二次确认在前端）；剩余项出局、在途落 interrupted。
- `GET /api/commit/records`：`batchId/offset/limit` 分页（与 batch/refine records 同构）。
- `GET /api/commit/item-status`：`{ statuses: { [itemId]: { commits: [完整 hash], batches, lastCommittedAt } } }`。
  本组接口对 git 零操作——浏览面板不执行任何提交。

### 2. 提交状态数据源（scripts/lib/commit-store.mjs 新增只读导出 `committedItemIndex`）

- 只统计 `phase=committed` 的运行（`commit done` 回执核验通过后落的 commits 完整 hash）；失败/跳过/中断
  不产生已提交记录——与 README「不得仅凭存在任意 Git hash 推定条目已提交」口径一致；同条目多 run 按
  创建时间序合并去重。轮询每 2s 读一次 run.json 账本（小文件全量读，规模 ~200 run 级别，毫秒级）。
- 前端独立拉取（`refreshCommitStatus`），**不并入 /api/board**：查询失败只影响提交状态徽标
  （显示「提交状态加载失败」+ 重试），看板主体不受牵连；失败保留上次数据（成功历史不消失）。

### 3. 前端（scripts/web/app.js + style.css）

- 任务模块一级页签新增「批量 Commit」（`data-bmode="commit"`），与批量完善/批量开发并列；数据分发
  `refreshBatch → refreshCommit`（签名剪枝，轮询不打断点击/输入）；二级页签（概况/队列/提示词/记录）
  复用 `taskPaneShell`，分区记忆 `state.commit.pane` 独立入快照（batchMode 恢复接受 'commit'）。
- 启动区（无任务）：候选计数（已完成口径）+ 开发人员 + 「启动」（无候选禁用并说明，不靠接口报错兜底）；
  创建 = `POST /api/commit/create` + 复制主调度提示词（复制成功 ≠ 执行中）；重复创建幂等返回如实提示。
  运行面板：概况（状态/批次号/当前条目/子代理会话/计数：已提交/异常=失败+中断/待处理）、暂停/恢复、
  终止（uiConfirm 二次确认）、终态「启动新一轮」；队列分区（待提交队列，最近 2 条）；提示词分区（重新复制）；
  记录分区（`commitRecordsHtml`：结果标签 + 回执说明 + 每个提交号完整 hash + 独立复制按钮，任务搜索过滤）。
- 已完成条目（done，需求与 Bug 同）列表行徽标 `commitBadgeHtml`：默认「未提交」；有核验提交记录显示
  「已提交」+ `<details>` 展开全部提交号（完整 hash 可换行、逐个复制）；查询失败显示
  「提交状态加载失败」+ 点击重试（不伪装成未提交）。详情页基本信息区新增「提交状态」字段（同数据源，
  hash 全量列出 + 逐个复制 / 失败重试）。列表签名计入提交状态，回执核验后徽标随轮询自动刷新。
- 提交号复制 `copyHash`（口径对齐 copyId：clipboard → execCommand 降级，失败提示手动框选完整值）；
  展开/复制/重试均 `stopPropagation`，不触发行点击打开详情。项目切换重置 `state.commit/commitStatus`
  （不串项目数据）。

### 4. 明确不做（边界）

- 全局任务总览（`/api/batch/global`）不纳入 commit 类型（README 待确认 3，保持现状）。
- UI 不开放 include-reported / 自选条目（README 待确认 2；默认 done 候选口径，服务端透传供后续启用）。
- 不新增任何 git 写路径：提交仍由人工创建任务后派发的子代理执行（REQ-20260910-013 既有协议），本单只加 UI。

## 风险与边界

- **轮询成本**：item-status 每轮全量读 commit 运行账本；run.json 为小文件，当前量级（数百）毫秒级完成，
  后续若显著增长可加 mtime 缓存（当前不做，避免提前优化）。
- **pending 队列载荷**：`/api/commit/current` 下发剩余候选编号数组（不含标题），大批次时为若干 KB 级 JSON，
  与 /api/board 同量级，可接受；标题缺失时前端以编号展示（不伪造）。
- **既有测试兼容**：session-entry 测试沙箱按函数抽取 bindBatchDrawer 并显式桩直接依赖，本单为其补
  `bindCommitWidgets` 桩（该沙箱模式的既有惯例：新增直调依赖即补桩）；其余任务面板/快照/列表测试全量回归。
- 剪贴板在非安全上下文/权限拒绝时经 execCommand 降级，仍失败则提示手动框选完整提交号（不误报成功）。
