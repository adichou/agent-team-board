# 测试报告 — BUG-20260915-006 default-port 测试以 800ms HTTP 探活判定端口占用不可靠，面板触发核验时必现假失败

- 时间：2026-09-15T00:57:39.405Z
- 执行者：zcode-port-bind
- 测试框架：node:test（自研 node 脚本：单文件 9 用例 + 全量 npm test 240 文件）
- 覆盖率：未统计

## 总结

TDD 红绿完成：新增 portOccupied() 真实 bind 探测（EADDRINUSE=占用），V6/V7 三处占用判定点由 800ms HTTP 探活切换为 bind 探测，portBusy 仅保留 waitHealth 健康等待语义；新增 V9 自证占用/空闲两分支。验证：看板服务运行中单跑 10/10 全绿（V6/V7 稳定跳过）、全量 npm test 240 文件 0 失败。引入来源：REQ-20260905-003（引入 default-port.test.mjs 及 HTTP 探活策略）。例外授权：认领被项目挂起阻塞，经用户授权按认领受阻例外分支实施（详见 design.md 实施记录）

## 明细

（可粘贴命令输出、失败用例说明等）
