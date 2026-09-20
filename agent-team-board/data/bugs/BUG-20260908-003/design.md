# 方案 — BUG-20260908-003 Status Board 收到 SIGTERM 后可能滞留不退，端口被占导致后续实例无法启动

## 引入来源（源单）

- 引入来源：REQ-20260906-003（Codex 后台自动派发：每单独立会话、日志追踪与进程回收——其「服务接入」改造在 server.mjs 引入 SIGTERM/SIGINT 优雅关停 `shutdownServer()`：停取单→取消受管执行→落账→退出，兜底强退 setTimeout 写在了 scheduler 关停 await 之后，经 `atb list` 核验存在；发现现场为 REQ-20260902-002 CI 测试）。

## 根因分析

- 位置：`scripts/server.mjs` `shutdownServer()`（修复前）：

  ```js
  const deadline = Date.now() + 20_000;
  await Promise.all([...schedulers.values()].map((s) => s.shutdown({ cancelCurrent: true }).catch(() => {})));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), Math.max(0, deadline - Date.now())).unref();
  ```

- 20s 强退兜底 `setTimeout` 在 `await Promise.all(...)` **之后**才注册。任一环节挂起时（scheduler.shutdown 链路里的取消/收尾等待、或 `server.close()` 回调因滞留 keep-alive 连接不触发），兜底与 `server.close()` 都执行不到：进程滞留、端口持续被占，下一实例 `EADDRINUSE` `exit(1)`（REQ-20260902-002 CI 实测：SIGTERM 后进程存活数分钟占住 30412）。
- scheduler.shutdown 自身名义上有界（缺省 waitMs = cancelGraceMs 10s + settleMs 1.5s + 3s），但链路含子进程取消、观察者清理等多个 await 边，任何一条不返回即整体挂起——兜底必须与具体挂起点解耦。

## 方案

1. **兜底强退先注册**：`shutdownServer()` 第一行即注册 `setTimeout(() => process.exit(0), shutdownForceMs).unref()`，先于任何 await——无论后续哪一步挂起，进程都在时限内退出、释放端口。
2. **scheduler 等待有界**：`Promise.all(schedulers.shutdown())` 套 `Promise.race`，上界 `shutdownForceMs - 2s`（给 `server.close()` 留余量），单个 scheduler 挂起不再拖住整个关停。
3. **close 解阻塞**：`server.close(cb)` 后调 `server.closeIdleConnections?.()`（Node ≥18.2，旧版静默跳过），空闲 keep-alive 连接不拖住 close 回调；在途请求仍有强退时限前的窗口。
4. `ATB_SHUTDOWN_FORCE_MS` 环境变量可收紧强退时限（缺省 20_000，生产行为不变），供测试确定性验证。

## 已知边界（不在本条范围）

- 强退 `process.exit(0)` 时仍在途的 scheduler 落账可能不完整——与原设计一致（原 20s 兜底同为 exit(0)），调度账本已有重启恢复核对（recovery）兜底。
- 重复 SIGTERM 会重入 `shutdownServer()`（重复注册无害定时器）；不加防重入，保持最小改动。

## 影响面

- `scripts/server.mjs`：仅 `shutdownServer()` 及其前置常量 `shutdownForceMs`（9 行注释+10 行实现），信号注册与路由不动。
- `scripts/tests/shutdown-forced-exit.test.mjs`：新增 T1 源码顺序契约 / T2 正常退出 / T3 挂起强退三组用例。
- 条目 README（复现步骤/期望行为）、本 design、test-report。
