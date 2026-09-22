# BUG-20260922-005 并发 npm test 实例互相误杀对方测试 server：run-all 文件级残留清理无法区分他实例在用进程，ECONNREFUSED 偶发

- 状态：以看板实时记录为准
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：BUG-20260914-013（引入 run-all 文件级 sweepTestResidue 兜底，残留判定未考虑并发实例在用 server）
- 创建：2026-09-22T13:35:27.428Z

## 现象

现象：全量 npm test 偶发失败，每轮不同的测试文件以裸 connect ECONNREFUSED（随机端口）失败——2026-09-22 实测多轮：batch-abort-view / batch-serve / bug-async-verify-20260915-008 / bug-build-candidate-occupied-20260914-004 / bug-leak-residue-20260914-013 / req-20260920-004（C2）/ req-20260921-015（B1），全部单独重跑通过，第三轮全量 330 文件 0 失败。失败用例均为 server 已通过 health 就绪后在后续请求时连接被拒（用例体内直连报错，非 waitHealth 的超时文案），即 server 进程中途死亡。机制（代码核实）：run-all.mjs 串行逐文件执行，但每个文件结束后调用 sweepTestResidue（run-all.mjs:43）；test-process.mjs classify()（186-192 行）把「node + scripts/server.mjs 入口 + cwd 在系统临时目录 + 监听 20000-50999」判为测试残留——无法区分上一轮遗留与另一并发实例正在使用的 server。测试 spawn server 普遍以 cwd=临时目录（如 req-20260920-004 spawnOnPort cwd:projA）。当两个 npm test 实例重叠（看板确认/核验任务内嵌 npm test + 终端手工 npm test + 服务重启中断任务的孤儿测试进程，见 BUG-20260922-004），先结束文件的 sweep 即误杀另一实例在用 server。影响：收口确认的 npm test 复验被偶发失败反复阻塞（REQ-20260921-007 今日多次确认被拒均因此）。建议修复方向：A. run-all 单实例互斥（lockfile，第二实例快速失败并说明）；B. sweep 收窄（仅 run 结束清理，或只杀启动时间早于本轮 run 启动的进程，或给测试 server 注入运行轮次标记 env 只杀无标记/旧标记者）；C. 看板侧保证中断任务确定性终止其 detached npm test 进程组（与 BUG-20260922-004 同源）。三管齐下或至少 A+B。

补充证据（2026-09-22 14:2x）：单实例（无并发）全量中 req-20260922-005.test.mjs 以**未捕获 read ECONNRESET** 崩溃整文件（node:internal/process/esm_loader triggerUncaughtException，Node v17.8.0）——连接建立后中途被断开且异常未被用例捕获，说明除互杀机制外还存在第二种诱因（负载下 server 中途死亡 / 流错误未绑定处理器把整文件打挂）。修复面应增加：D. 测试侧 HTTP 请求对瞬时连接错误（ECONNRESET / ECONNREFUSED）具备重试韧性（公共请求助手层），未捕获异常不应使整文件崩溃。该文件单独重跑 11/11 通过。

## 复现步骤

1.

## 期望行为
