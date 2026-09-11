# 测试报告 — BUG-20260908-003 Status Board 收到 SIGTERM 后可能滞留不退，端口被占导致后续实例无法启动

- 时间：2026-09-08T03:44:25.367Z
- 执行者：zcode-batch-013-1
- 测试框架：node:assert 进程级+源码契约测试
- 覆盖率：90%

## 总结

shutdownServer 兜底强退 setTimeout 提前到任何 await 之前注册（缺省 20s 不变，ATB_SHUTDOWN_FORCE_MS 可收紧）；scheduler 收尾 Promise.race 有界（强退时限−2s 余量）；server.close 后 closeIdleConnections 防滞留 keep-alive 连接拖住回调。新增 shutdown-forced-exit.test.mjs 三用例（源码顺序契约/正常 SIGTERM 退出且端口释放/挂起连接下按时限强退），先红后绿；全量回归 83 文件 0 失败。引入来源：REQ-20260906-003（atb list 核验）。

## 明细

（可粘贴命令输出、失败用例说明等）
