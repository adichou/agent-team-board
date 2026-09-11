# BUG-20260906-008 执行详情恢复本项未绑定当前 runId 可能恢复其他条目

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-003
- 创建：2026-09-06T06:40:04.199Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 C-A5。

## 现象

有两个可恢复 interrupted 记录时，选择较早记录恢复，实际恢复较新的另一项。前端发送空请求体，服务和 scheduler 均不接收选中的 runId。

## 复现步骤

隔离项目创建两个带不同 threadId 的 interrupted 账本；请求恢复较早 run，核对返回 runId；对照前端恢复按钮请求体。

## 期望行为

恢复必须绑定用户当前查看的 runId、itemId 和原 threadId，并核对 owner 和执行状态。

## 根因分析（2026-09-06 修复，zcode-batch-002-08）

恢复链路三层都未传递用户当前查看的 runId：

1. `scripts/web/app.js` `#cxResumeItem` 点击处理器发送 `body: '{}'` 空请求体；
2. `scripts/server.mjs` `/api/dispatch/codex/resume-item` 不解析请求体，直接调用 `schedulerFor(root).resumeItem()`；
3. `scripts/lib/scheduler.mjs` `resumeItem()` 无参，自行代选目标——`listOpenRuns` 里第一条带 threadId 的 open run，或最近 20 条里第一条 blocked/interrupted。存在多条可恢复记录时必然可能恢复成用户未选中的另一条（如较新那条），与 UI 按钮所在详情无关。

修复：

- `scheduler.mjs` `resumeItem(runId)`：必须绑定 runId；按 runId 精确取 run，核对其状态为 blocked/interrupted、已记录 threadId，才走原有占用获取（全局 hub + impl.lock，即 owner/占用核对）并按该 run 的确切会话 ID 续跑；缺 runId、run 不存在、状态不符、无会话 ID 均明确拒绝，不再代选。
- `server.mjs`：端点解析请求体并校验 `runId` 为非空字符串，否则 400（AtbError）；合法则透传给 `resumeItem(body.runId)`。
- `app.js`：处理器发送 `body: JSON.stringify({ runId: state.codex.detail.runId })`；无详情时直接提示拒绝。

## 关联（引入来源）

- 引入来源：REQ-20260906-003（Codex 自动派发引入 resumeItem/恢复本项功能时即无参代选实现，前端按钮也未携带 runId；已经 atb list 核验 REQ-20260906-003 存在）。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/web/app.js:cxResumeItem；scripts/server.mjs:resume-item；scripts/lib/scheduler.mjs:resumeItem
- 当前为测试登记，尚未修复。


## 复现步骤

1.

## 期望行为
