# 测试用例 — BUG-20260914-015 快捷入口按钮执行中态

自动化测试文件：`scripts/tests/bug-quick-entry-running-20260914-015.test.mjs`
（服务端用例走真 server + atb CLI fixture；前端用例沿用 lane-quick-entry-20260909-007 的 vm 模拟 DOM 模式）

## 服务端（GET /api/tasks/state）

- **S1 无任务**：项目内无任何批次账本 → `{ ok: true, refine: null, develop: null }`。
- **S2 执行中透传**：构造 develop `running` 批次（创建后 `batch next` 预留即置 running）→ `develop: 'running'`；refine `running` 批次同理 → `refine: 'running'`；两类并存时各自透传。
- **S3 终态排除**：批次 finished / aborted（人工终止）后不进入响应 → 对应为 null（按钮随之恢复）。
- **S4 非执行态透传**：develop `prepared`（创建未预留）→ `develop: 'prepared'`（前端只消费 running，接口完整透传）。
- **S5 未初始化项目**：无 dataDir → 200 + 两 null，不抛错。

## 前端（vm 桩）

- **F1 AI 分析执行中**：`state.taskRun.refine = 'running'` 时已接受档按钮 `disabled = true`、文案「AI 分析中」、title 说明执行中、aria-label 同步「AI 分析中」。
- **F2 AI 开发执行中**：`state.taskRun.develop = 'running'` 时已计划档按钮禁用、文案「AI 开发中」。
- **F3 非执行态可点**：refine/develop 为 `prepared` / `paused` / `needs_attention` / null 时按钮保持原文案、`disabled = false`（与面板徽章口径一致，不矛盾）。
- **F4 跨任务不联动**：refine running 时已计划档按钮（develop null）不受影响；反之亦然。
- **F5 收尾自动恢复**：refine 从 running 变 null 后再次 `syncAcceptance()`，按钮恢复「▶ 开始 AI 分析」且可点。
- **F6 数据链路**：`refreshTaskRunState()` 拉取 `/api/tasks/state` 并写入 `state.taskRun`；签名无变化不重复触发 `syncAcceptance`；拉取失败保留旧值。
- **F7 不回归**：无任务态时「批量操作进行中也不禁用」保持（四路 pending 与 disabled 解耦）。

## 源码契约

- **C1 接线**：`poll()` 内调用 `refreshTaskRunState()`（不依赖任务面板打开）；`switchProject()` 重置 `state.taskRun`；`syncAcceptance()` 消费 `state.taskRun`（三处源码契约断言，防接线遗漏回归）。
