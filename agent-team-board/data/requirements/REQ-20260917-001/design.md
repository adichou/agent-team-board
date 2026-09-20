# 设计 — REQ-20260917-001 需求模块的 AI 分析和 AI 开发按钮点击后，直接复制相应提示词即可，不需要打开任务页面

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

见 README「背景与现状」：现状两跳（需求页按钮 → 任务页 → 「启动」→ 提示词进剪贴板），本需求去掉中间页面切换，就地完成「创建任务 + 复制主调度提示词」。

## 方案

纯前端改动（`scripts/web/`），复用现有创建接口与提示词文本，不改服务端：

1. **点击语义**（`app.js`）：新增 `laneQuickCreate()`——按 `state.reqFilter` 分派 `createRefineBatchAndCopy({ fromLane: true })`（已接受档）或 `createBatchAndCopy({ fromLane: true })`（已计划档）；`#laneQuickEntry` 绑定从 `gotoRuns(...)` 换为 `laneQuickCreate`，不切视图。
2. **复用而非复制**：两个创建函数加 `opts.fromLane`——成功 toast 沿用任务页统一成功口径（同一份代码，同一事实源 `res.prompt`，与任务页「提示词」页签不出现两份文本）；fromLane 时跳过 `refreshRefine()/refreshBatch()`（任务面板未打开无需拉取，打开时由 2s 轮询吸收新任务），复制失败 toast 改为指引到任务页对应面板「提示词」页签手动复制（如实说明任务已创建，不误报已复制）。
3. **禁用口径**（`syncAcceptance()`）：`disabled = state.laneQuick.pending || !conf.ok`——无候选禁用并按任务页「启动」口径在 title 说明原因（已接受档 = `status==='accepted' && refineState!=='refined'` 无候选 →「暂无可完善候选……」；已计划档 = `plannedQueue()` 为空 →「暂无已计划候选……」）；创建请求进行中禁用（连点防重复，`state.laneQuick.pending` + 回执后 `syncAcceptance()` 恢复）；批量操作进行中不禁用（互不相干，保留既有口径）。
4. **悬停提示**：两档 title 改为「点击即创建 AI 分析/开发任务并复制主调度提示词（不跳转任务页）：范围为……，与勾选无关」；`index.html` 静态 title 同步。
5. **i18n**：新 title 4 条（两档 × 有/无候选，其中无候选 2 条沿用既有词条）与 2 条复制失败指引入 `EN` 静态词典；旧「进入任务模块……」2 条词条移除（i18n-coverage 卡点通过）。
6. **重复启动**：不做前端预判，沿用服务端 400 拒绝口径（「同一时间只有一轮执行……」），前端错误 toast 原样展示、不新建不复制（README「状态反馈」定稿）。

**开源选型（REQ-20260909-015）**：无合适开源库引入——本条目是对既有 Web 前端交互语义的调整（按钮点击分派、禁用态同步、词条更新），全部复用仓库既有基础设施（`api()` / `copyDispatchText()` / `syncAcceptance()` / i18n 词典），无新增第三方依赖，不创建 licenses.md。

## 风险与边界

- 存量契约测试随行为变更同步改写 6 处（见 test-cases.md 尾注），守护意图不变：gotoRuns 精准落地机制（完善徽标 / 全局总览共用链路）、任务页「启动」/「提示词」页签、无 Agent 化契约均保留。
- `refineState` 由 `/api/board` 随条目返回，需求页禁用口径与服务端 `refineCandidates`（`status==='accepted' && state!=='refined'`）同口径；「完善中」条目计为候选，此时点击由服务端 400 如实反馈（README 待确认项定稿口径）。
- `created === false` 幂等分支为遗留不可达代码（README 已核实），本次不动。
