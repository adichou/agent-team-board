# BUG-20260908-003 Status Board 收到 SIGTERM 后可能滞留不退，端口被占导致后续实例无法启动

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-08T01:04:21.062Z

## 现象

server.mjs shutdownServer() 先 await Promise.all(schedulers.shutdown())，20s 强退兜底 setTimeout 在 await 之后才注册——任一 scheduler.shutdown() 挂起（无超时）时兜底永不执行，进程滞留并持续占用端口。本批次 CI 测试（REQ-20260902-002）实测：SIGTERM 后进程存活数分钟占住 30412，下一轮测试新实例 EADDRINUSE exit(1)。建议把兜底 setTimeout 提到 await 之前，或给每个 shutdown 加超时。复现：spawn server.mjs → kill -TERM → 观察进程未退且端口仍监听。

## 复现步骤

1. 起一个 Status Board 实例（如 `ATB_PORT=30412 node scripts/server.mjs`），并保持一条滞留连接或让任一 scheduler 关停环节不返回（CI 场景为受管执行收尾挂起）；
2. `kill -TERM <pid>` 发 SIGTERM；
3. 观察进程未退出且端口仍监听（数分钟）；随后再起新实例（同端口）→ `EADDRINUSE` `exit(1)`。
   自动化复现：`node scripts/tests/shutdown-forced-exit.test.mjs` T3（修复前 8s 内不退出）。

## 期望行为

1. 收到 SIGTERM/SIGINT 后，无论 scheduler 关停或 `server.close()` 是否挂起，进程都在强退时限（缺省 20s，`ATB_SHUTDOWN_FORCE_MS` 可收紧）内退出；
2. 退出后端口立即释放，后续实例可正常绑定；
3. 正常路径仍为优雅关停：scheduler 有界收尾（≤ 强退时限 −2s）→ `server.close()` → `exit(0)`。