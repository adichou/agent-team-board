# 设计 — BUG-20260914-013 集成测试泄漏 server/stub 进程：随机端口被残留监听者占用致跨轮次偶发失败（serve-stale T1 实证）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 主源：**BUG-20260907-017**（看板服务版本过旧自愈，`atb list` 核验存在，done）。该修复引入
  `scripts/tests/serve-stale.test.mjs`：随机选端口不做占用预检（T1 34100–39099、T2 34600+、T3 35100+、T5 35600+），
  且 spawn 的服务/stub 收尾只 fire-and-forget `kill()` 不等退出；T2/T3/T5 无 try/finally，断言中途失败即泄漏
  （当年实证即 T5 场景的 `old-server.mjs` stub 残留监听 38804）。
- 辅源一：**REQ-20260906-003**（Codex 后台自动派发，核验存在，done）。引入 `dispatch-api.test.mjs` 的
  `startServer/stop()`：SIGTERM 后最多等 5s 即放行、不校验退出结果。
- 辅源二：**BUG-20260908-003**（SIGTERM 后可能滞留不退，核验存在，done）。修复将服务端优雅关停强退兜底
  `ATB_SHUTDOWN_FORCE_MS` 缺省定为 20s（`server.mjs`）——与测试侧 5s 等待窗口不匹配，形成「5s 内未退 → 静默泄漏」。

三处叠加：泄漏长期累积（2026-09-08 起 atb-api-* 残留）+ 随机端口无预检 → 跨文件/跨轮次端口碰撞偶发失败
（round3 serve-stale T1 命中 38804 冒牌 health）。

## 根因分析

1. **收尾不确定**：serve-stale T2/T3/T5 断言链无 try/finally，失败路径进程无人回收；`kill()` 不等待退出，
   server.mjs 优雅关停可能等 keep-alive 连接（强退兜底最长 20s）——发完信号就走的测试已在日志里宣告通过，
   进程却还活着。dispatch-api `stop()` 同理且明确存在 5s/20s 失配窗口。
2. **选端口无预检**：各测试文件在共享随机段（20000–50999）内裸 `Math.random()` 选端口，不做占用探测；
   段内既有测试泄漏也有第三方应用（Doubao 49182/49853、clash 33331），碰撞概率随残留数量上升。
3. **聚合层无兜底**：run-all.mjs 逐文件 spawnSync 后不做任何残留检测，跨文件、跨轮次污染无阻断。
4. **失败不可诊断**：waitHealth 就绪判据仅 `status===200 && json.ok`，命中冒牌 health 即误判就绪，
   最终以「health 应含数字 pid」误导收场，真实原因（端口被占）被掩盖。

## 方案

**开源选型（REQ-20260909-015）**：自研（无合适库的原因）。所需能力是 10–30 行量级的进程/端口原语
（listen 探测、SIGTERM→有界等待→SIGKILL、lsof/ps 残留扫描），Node 内置 `net`/`child_process` 即可表达；
引入 testcontainers/portfinder 类库换不来超出内置 API 的价值，且本仓测试基建零运行时依赖是既有约束。未引入
任何开源库，不创建 licenses.md。

### 1. 新增共享测试基建 `scripts/tests/lib/test-process.mjs`

- `probePortFree(port, host)`：net 短暂 bind 探测端口空闲（不 connect，避免对残留进程产生请求噪音）。
- `pickFreePort({ min, max, tries, host })`：随机候选 + 占用预检重选；全占则 3s 内抛错，信息含「无可用端口/
  端口被占」与区间（期望行为 2、4）。
- `stopChild(child, { timeoutMs })` / `stopPid(pid, { timeoutMs })`：SIGTERM → 有界等待退出 → 超时 SIGKILL →
  再有界等待；仍存活则抛错（确定性收尾，期望行为 1）。对已退出 pid 幂等。
- `httpGetJson(port, pathname)`、`waitHealth(port, { expectPid, timeoutMs })`：就绪判据可选校验
  `json.pid === expectPid`；`ok:true` 但 pid 不符时记为「命中非目标服务」，超时报错直指端口被占/残留进程
  （期望行为 4，消除 T1 误导失败）。
- `listTestResidue({ ranges, pluginRoot, tmpDir })`：lsof 枚举测试端口段（缺省 20000–50999 并集）监听者，
  ps 取命令行、lsof 取 cwd，按三重标记判定测试残留——node 进程 且 监听在段内 且（命令行含 `atb-` 临时
  目录标记 / `old-server.mjs` / 任意 `scripts/server.mjs` 或 `scripts/atb.mjs` 或 cwd 在 os.tmpdir() 下）。
  lsof 不可用时回退 ps 纯标记扫描（只回收带 argv 标记者）。
- `sweepTestResidue({ label, log })`：检测 → SIGTERM/SIGKILL 确定性回收 → 醒目报告清理明细；非 node 监听者
  （第三方应用）仅提示不杀；排除自身 pid（期望行为 3）。

### 2. `serve-stale.test.mjs` 加固

T1/T2/T3/T5 端口全部改 `pickFreePort`（区间不变）；T1 `waitHealth` 附 `expectPid`；T2/T3/T5 整体 try/finally，
finally 中 `stopChild`/`stopPid` 确定性回收（含 atb serve 拉起的新服务 pid）与临时目录清理。T3「不误杀」、
T5「老服务重启」语义不变。

### 3. `dispatch-api.test.mjs` 收尾修复

`startServer` env 增加 `ATB_SHUTDOWN_FORCE_MS=8000`（服务端强退兜底与测试等待上限对齐，保持快速测试）；
`stop()` 改走 `stopChild`（有界等待 + SIGKILL 兜底 + 失败抛错），消除「5s 内未退 → 静默泄漏」窗口。
T5 直接 kill 的路径保持（其断言已含 15s 有界等待）。

### 4. `run-all.mjs` 聚合层兜底

改为 async 执行各测试文件（spawn + 180s 超时，语义与原 spawnSync 一致）；**每个文件结束后**
`sweepTestResidue({ label: f })` 清理/醒目报告遗留测试进程；run 结束再 sweep 一次，总摘要输出
「清理测试残留 N 个」，阻断跨文件、跨轮次污染。

## 风险与边界

- run-all 改 async 必须保持退出码与超时语义：以等价 spawn + 定时 kill 重写，default-port.test.mjs 对
  run-all 的既有断言（枚举 `*.test.mjs`、注册 test script）不受影响。
- sweep 误杀面：三重标记（node + 测试端口段 + argv/cwd 标记）限定，缺任何一环不动手；第三方监听者只提示。
  理论残余风险：用户恰好在 20000–50999 段手工跑本插件 board 实例且 argv 命中 `scripts/server.mjs`——
  sweep 会回收并醒目打印（本地测试运行器语境下可接受，日志可追溯）。
- 不改 server.mjs 关停行为（BUG-20260908-003 语义保持），只对齐测试侧等待上限。

## 实施记录（2026-09-14，run-20260914-238）

- 新增 `scripts/tests/lib/test-process.mjs`（pickFreePort / probePortFree / stopChild / stopPid /
  httpGetJson / waitHealth(expectPid) / listTestResidue / sweepTestResidue）。实测发现并修复 macOS
  `/var → /private/var` 符号链接差异：cwd 判定同时接受 os.tmpdir() 与其 realpath（C7b 回归覆盖）。
- `scripts/tests/serve-stale.test.mjs`：T1/T2/T3/T5 端口 pickFreePort 预检；T1 waitHealth 附
  expectPid；T2/T3/T5 整体 try/finally，finally 中 stopChild/stopPid 确定性回收 + 临时目录清理。
- `scripts/tests/dispatch-api.test.mjs`：startServer env 增 `ATB_SHUTDOWN_FORCE_MS=8000`；stop() 改
  stopChild（12s 有界等待覆盖 8s 强退兜底，超时 SIGKILL，仍存活抛错）。
- `scripts/tests/run-all.mjs`：改 async spawn（180s 超时语义等价），每文件结束与 run 结束各
  sweepTestResidue 兜底，摘要输出清理计数。
- 新增 `scripts/tests/bug-leak-residue-20260914-013.test.mjs`（C1–C9 + C7b，11 用例）。
- 现场验证：本机存在 2026-09-08 起泄漏的 7 个 atb-api-*/atb-mapi-* server 进程（Bug 现象实证），
  listTestResidue 全部检出、sweepTestResidue 全部确定性回收；run-all×3 后 lsof/ps 快照零测试残留，
  第三方监听（Doubao/clash）未被触碰。
