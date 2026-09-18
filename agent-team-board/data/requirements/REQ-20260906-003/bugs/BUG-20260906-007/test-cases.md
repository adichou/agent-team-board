# BUG-20260906-007 测试用例

## D19 网络退避等待期停止当前执行：撤销待执行重试并结束运行（本 Bug 回归）

- 前置：假 CLI `net-error` 模式（每次尝试都以网络错误退出）；退避序列 `[600, 600]`。
- 步骤：
  1. enable 后等待账本 `retriesUsed === 1`（首次失败已进入 600ms 退避等待，此时无活进程）。
  2. 记录 `spawnCount`，调用 `stopCurrent()`（应返回 ok）。
  3. 再观察 850ms（覆盖退避窗口）。
- 断言：
  1. `spawnCount` 不变——退避结束后不得再启动新进程（不复活旧执行）。
  2. run 落账 `phase=interrupted`、`result.reason=user-stop`——停止请求必须撤销待执行重试并结束运行。
  3. 实施互斥锁释放（`readProjectLock() === null`）、`status().current === null`——结束后不残留占用。

对应验收探针 C-A4（docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs）。

## D20 scheduleRetry 回调的取消竞态防线（与续跑路径同级的二次核对）

- 前置：同 D19。
- 场景：即使停止请求与退避定时器触发存在竞态（如 timer 回调先于清理进入队列），回调内也必须核对停止意图，不得 spawn。
- 断言：`scheduleRetry` 回调触发时若内存或账本 `cancelRequested=true`，则不调用 `spawnAttempt`。
- 实现方式：与 D19 合并覆盖（修复在回调内加双重核对），另以 D19 的 850ms 观察窗口兜底验证。
