# 设计 — REQ-20260908-026 优化批量任务管理界面与 Agent 配置

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

基于 REQ-20260908-020 已落地的任务模块（「批量完善 / 批量开发」双子面板、子代理模式、复制调度提示词）与
`tasks/settings.json` 四路配置，按已确认 Demo（`./ui-demo.html`）统一两类任务的管理界面：
启动文案统一为「启动」、候选与记录仅展示最近 2 条、运行面板计数与耗时、暂停/终止/重试口径、
任务设置改为「四列表格 × 固定 Codex/Zcode 两行」。

## 方案

### 前端（scripts/web/app.js、style.css）

- **启动区**：无进行中任务时才渲染启动区（执行 Agent 选择 + 开发人员 + 「启动」按钮）；有批次（含待启动/终态）时
  由运行面板承接，终态经「启动新一轮」+ 内嵌 Agent 选择重建任务。两类按钮文案均为「启动」。
- **复制反馈**：创建成功 toast 统一为「任务已创建、提示词已复制，请在对应项目会话粘贴发送」（附带批次号与候选数）；
  复制失败保留任务，提示「重新复制」与展开提示词手动复制。
- **运行面板**：计数行改为「已处理 N · 异常 N · 处理中 N · 待处理 N」——
  完善：已处理=done，异常=failed+interrupted，处理中=当前在途 1/0，待处理=remaining（终态记 0）；
  开发：已处理=reported，异常=failed+blocked+interrupted，其余同上；出局数以小字附注保留真实账面。
  当前项增加「已用时 mm:ss」（轮询自然刷新）。无当前项占位按阶段：待启动（粘贴指引）/等待领取/已暂停/本轮已结束，
  终态绝不显示「等待领取」。
- **最近两条**：
  - 待处理队列（完善=实时 accepted 未完善候选；开发=/api/batch/current 新增 pending 字段，按领取顺序），
    仅展示最近加入的 2 条（最新在前）+「最近 X 条 / 共 N 条」；>2 条附「仅展示最近 2 条」说明；终态隐藏该区。
  - 本轮处理记录改为四列表格（需求 / Bug、执行状态、次数、操作），仅展示最近创建的 2 次执行尝试；
    类型按编号前缀 REQ-/BUG- 判定；状态含异常原因；次数=「第 N 次」（attempt=本任务内该条目运行数）；
    异常/已中断行给「重新执行」，其余「—」。删除既有「查看批次记录」全量列表与「加载更多」分页
    （BUG-20260908-018 的分页交互被本需求 2 条展示上限取代；账本与计数不受影响，条目详情沿用需求面板查看）。
- **暂停/终止**：按钮文案统一「暂停后续领取 / 恢复后续领取」；开发面板终态（aborted/finished）不再渲染暂停/恢复
  （对齐完善面板 BUG-20260908-015 口径）；终止二次确认文案补充「保留本轮全部处理记录」。
- **任务设置**：设置页「批量任务」分区改为两块四列表格（批量完善 / 批量开发），列＝执行 Agent / 子代理模型 /
  推理强度 / 是否隐藏，固定 Codex、Zcode 两行；行首 Agent 是配置对象而非执行者选择器。是否隐藏默认不勾选；
  保存按「未勾选隐藏」反算 agents 可见清单，**允许全部隐藏**（启动区禁用并提示到任务设置取消隐藏）。
  存量 settings.json 结构不变（agents/models 两节），旧数据直接映射，无需迁移。模型与强度沿用现网输入形态
  （模型自由文本可留空用默认；强度 高/中/低），不引入 Demo 占位模型（README「待确认」项保持待确认）。
- **重试**：「重新执行」绑定——活跃任务 POST /api/{batch,refine}/retry { runId }（后端核验后重排队）；
  终态任务复用既有 create 接口以 `ids=[itemId]` 承接为新待启动任务并自动复制调度提示词（复制成功≠执行成功）。
  不可重试时后端返回具体原因与人工处理指引（条目被认领需先在 Status Board 人工处理、确认旧子代理已停止后再试），
  即 Demo「确认停止后解除」的生产对应：占用核验通过才放行，杜绝重复在途执行。

### 数据层（scripts/lib）

- `task-settings.mjs`：`saveTaskSettings` 不再拒绝空 agents 列表；`loadTaskSettings` 不再把空列表回退为全量
  （全部隐藏成为合法持久态，`visibleAgents` 返回空数组）。
- `batch.mjs`：
  - `batchState` 计数新增 interrupted（展示口径）；`listRuns` 记录新增 `attempt`（本批次内该条目的运行次数）。
  - 新增 `retryRun(dataDir, runId)`：仅 failed/blocked/interrupted 可重试；同条目存在在途执行、impl 锁被占用、
    条目业务状态不符（被认领 in-progress/owner、非 planned）时拒绝并给出指引；通过后在批次账本标记
    `retryItems[itemId]=true`（幂等），计数把它记入待处理、不再计入异常；`nextItem` 对被标记条目放行重新领取，
    领取时清除标记（新账面即「第 N+1 次」）。
  - `/api/batch/current` 增加 `pending`（按领取顺序的待处理条目 id+title）、`recordsTotal`。
- `refine-store.mjs`：同构 `retryRefineRun`（failed/interrupted、无在途、条目仍 accepted；重排队尾并标记
  `retryItems`，`refineBatchState`/`nextRefineItem` 与 reacceptable 同口径处理）；`listRefineRuns` 记录增加 `attempt`。
- `server.mjs`：新增 POST `/api/batch/retry`、POST `/api/refine/retry`。

### 不做 / 边界

- 不新增复核、总结、「查看完善结果」入口；完整列表/结果面板不提供（2 条仅为展示限制）。
- 不自动修改人工管理的业务状态：被认领条目的重试一律拒绝并指引人工处理（Status Board），
  Demo 中「模拟确认子代理已停止」为演示件，生产以占用核验 + 人工处理条目状态承接。
- CLI（atb refine / atb batch / claim / report）行为不变；批次 FIFO 排队、impl 互斥、完善三态徽标等既有机制不动。

## 风险与边界

- 记录「加载更多」与「查看批次记录」被 2 条上限取代属预期破坏：已同步更新对应存量测试
  （refine-ui R12-11 重写为最近 2 条契约），BUG-20260908-018 的「刷新不重置深度」问题在固定 2 条展示下自然消解。
- `agents` 允许为空是行为变更：启动侧依赖 `visibleTaskAgents` 空数组禁用 + 提示，CLI 无消费方（已核验仅前端使用）。
- attempt 以「本任务内同条目运行数」计，跨任务（新一轮）从头计数，与 Demo「第 N 次」语义一致。

## 实施记录

- 2026-09-09 zcode-batch-018-01：按上述方案实施；测试文件 `scripts/tests/tasks-retry.test.mjs`（数据层用例 11–14）、
  `scripts/tests/tasks-panel-26.test.mjs`（界面契约 1–10、15–17），并更新 refine-ui / tasks-refine / refine-serve /
  planned-state / next-batch-entry / batch-ui / batch-serve / type-chip-removed 受影响断言（口径以本需求为准）；
  全量 98 个测试文件通过。服务端冒烟验证了 retry 路由校验、活跃重排队计数与终态「新一轮重建 + 复制提示词」链路。
- 事故说明：冒烟脚本一次未带 `?project=` 的请求命中了默认项目（注册表首个），把真实项目
  `tasks/settings.json` 的 `agents.refine` 短暂写成 `[]`；当即经 `saveTaskSettings` 恢复为两类全可见默认值，
  models 字段未被触及（均为默认值）。后续外部验证一律显式携带 `?project=`。
