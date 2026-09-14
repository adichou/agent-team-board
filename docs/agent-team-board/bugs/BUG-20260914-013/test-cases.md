# 测试用例 — BUG-20260914-013 集成测试泄漏 server/stub 进程

> 自动化载体：`scripts/tests/bug-leak-residue-20260914-013.test.mjs`（C1–C9）；
> 集成验收（A1–A4）由本条目执行过程落盘日志承载（见 test-report.md 引用的 run 目录）。

## C1 端口占用预检：pickFreePort 跳过被占端口

起一个 stub 监听端口 P（复刻泄漏 old-server 行为），`pickFreePort({min:P, max:P+1})` 应返回 P+1，且返回端口当下可绑定（二次探测空闲）。

## C2 端口全被占：pickFreePort 快速失败并明确报因

stub 占住 P 与 P+1，`pickFreePort({min:P, max:P+1, tries:8})` 应在 3s 内抛错，错误信息含「无可用端口/端口被占」字样与区间说明（而非就绪超时类的误导信息）。

## C3 stopChild 优雅路径

普通 node 子进程（SIGTERM 可退出）经 `stopChild` 收尾：快速返回、进程消失（`process.kill(pid,0)` 抛 ESRCH）。

## C4 stopChild 顽固进程 SIGKILL 兜底

忽略 SIGTERM 的子进程（`process.on('SIGTERM',()=>{})`）经 `stopChild(child,{timeoutMs:1200})` 收尾：在超时 + 有界强杀窗口内返回，进程最终消失。

## C5 stopPid 幂等

对已退出的 pid 调 `stopPid` 不抛错（复用 existing-check 幂等语义）。

## C6 waitHealth 非目标 health 诊断

- C6a 正常路径：stub 返回 `{ok:true, pid:X}`，`waitHealth(port,{expectPid:X})` 快速就绪。
- C6b 误导失败消除：无 pid 的 stub 占住端口（复刻 run-all round3 现场），`waitHealth(port,{expectPid:不可能值, timeoutMs:900})` 超时抛错，信息指向「命中非目标服务/端口被占」，而不是含糊的就绪超时。

## C7 sweep 检测并清理标记残留

spawn `node <tmp>/atb-leak-*/old-server.mjs` 监听测试端口段内端口：`listTestResidue` 应包含该 pid；`sweepTestResidue` 后进程消失。

## C8 sweep 不误杀无关监听者

无标记 `node -e` http 服务监听同段端口：`listTestResidue` 不含其 pid，`sweepTestResidue` 不杀它（测试自行回收）；第三方监听者（Doubao/clash）同理仅提示不杀。

## C9 源码契约回归（grep 契约，与 serve-stale T4 同实践）

- `serve-stale.test.mjs`：使用 `pickFreePort`、`stopChild`；`finally` 出现 ≥3 次（T2/T3/T5 失败路径回收）。
- `dispatch-api.test.mjs`：`stop()` 走 `stopChild`；`startServer` env 设置 `ATB_SHUTDOWN_FORCE_MS`（消除 5s 等待 vs 20s 强退的静默泄漏窗口）。
- `run-all.mjs`：每个测试文件结束后调用 `sweepTestResidue`。

## A1 确定性回归（复现方法一）

占住 T1 端口段内固定端口（38804）后运行 `serve-stale.test.mjs`：全绿（自动换端口），不再出现「health 应含数字 pid」误导失败。

## A2 无泄漏快照

`run-all.mjs` 全量通过后，lsof/ps 与 run 前对比，20000–50999 段无新增测试残留监听/进程。

## A3 失败路径也回收

人为使 serve-stale 用例中途失败（临时注入断言），收尾后无残留子进程（sweep 兜底可见清理记录）。

## A4 稳定性

serve-stale 连续 ≥5 轮通过；run-all 连续 ≥3 轮无本 Bug 款偶发失败；T3「不误杀」/T5「老服务重启」语义保持。
