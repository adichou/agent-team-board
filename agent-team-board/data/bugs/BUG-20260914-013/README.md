# BUG-20260914-013 集成测试泄漏 server/stub 进程：随机端口被残留监听者占用致跨轮次偶发失败（serve-stale T1 实证）

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：BUG-20260907-017（引入 serve-stale.test.mjs：随机端口无占用预检 + 服务收尾 fire-and-forget 不等退出）；辅 REQ-20260906-003（引入 dispatch-api.test.mjs 的 stop：SIGTERM 后最多等 5s 即放行不校验）、BUG-20260908-003（服务端优雅关停强退兜底缺省 20s，与测试侧 5s 等待失配成泄漏窗口）
- 创建：2026-09-14T05:31:26.846Z

## 现象

现象：run-all 全量第 3 轮 serve-stale.test.mjs T1「/api/health 返回 pid 与 startedAt」失败，报「health 应含数字 pid」：T1 随机端口（34100-39099）命中了此前轮次泄漏的 atb-stale-s5 old-server.mjs stub（监听 38804，health 返回 ok:true 但无 pid/startedAt），waitHealth 误判就绪。排查发现进程泄漏长期存在：2026-09-08 起即有 atb-api-* 临时目录 server.mjs 残留（3 个），当日 3 轮 run-all 又新增泄漏 atb-stale-s2/s3 server 与 s5 old-server stub 多个；全部监听 127.0.0.1:31000-50999 共享随机端口段。成因（初步）：serve-stale T2/T3/T5 与部分 api 测试对 spawn 的 server 只 fire-and-forget SIGTERM（server.mjs 优雅退出可能等待 keep-alive 连接关闭而滞留），断言中途失败时 finally 前的进程无人回收；随机选端口不做占用预检，跨文件/跨轮次碰撞即偶发失败。建议：测试收尾 kill 后等待退出（带超时兜底 SIGKILL）、选端口前探测可用性或监听 0 端口转交、run-all 每文件结束后清理遗留子进程。证据：docs/agent-team-board/dispatch/runs/run-20260914-228/run-all-round3.log（body-limit 3 轮全过，仅 serve-stale T1 失败）；清理前后 lsof 快照见 test-report.md。

## 复现步骤

涉及代码：`scripts/tests/serve-stale.test.mjs`、`scripts/tests/run-all.mjs`、`scripts/tests/dispatch-api.test.mjs`、`scripts/server.mjs`（关停路径）。

### 方法一：确定性复现「随机端口命中残留监听者」（最小改动）

1. 起一个复刻泄漏 stub 行为的冒牌 health 服务，占住 serve-stale T1 端口段（34100–39099，见 `serve-stale.test.mjs:98` `34100 + Math.floor(Math.random() * 5000)`）内的固定端口，如 38804（当年泄漏 stub 实际监听端口）：
   ```bash
   node -e "require('http').createServer((q,s)=>{s.end(JSON.stringify({ok:true,port:38804}))}).listen(38804,'127.0.0.1',()=>console.log('stub listening 38804'))"
   ```
   其行为与 run-all 第 3 轮泄漏的 atb-stale-s5 `old-server.mjs` stub 一致：`/api/health` 返回 200 + `{ok:true}` 但无 pid/startedAt。
2. 临时把 `scripts/tests/serve-stale.test.mjs:98` 的 `const port = 34100 + Math.floor(Math.random() * 5000);` 固定为 `const port = 38804;`（仅复现用，验证后还原）。
3. 运行 `node scripts/tests/serve-stale.test.mjs`。
4. 观察：T1 失败 `AssertionError [ERR_ASSERTION]: health 应含数字 pid`（`serve-stale.test.mjs:102`）——`waitHealth`（`serve-stale.test.mjs:36-48`，就绪判据仅 `status===200 && r.json.ok`）命中冒牌 stub 的 `ok:true` 误判就绪；T1 自己 spawn 的真服务因 EADDRINUSE 起不来。与 `docs/agent-team-board/dispatch/runs/run-20260914-228/run-all-round3.log:2609-2622` 的现场失败完全一致。

### 方法二：泄漏累积 → 跨轮次偶发（自然复现）

1. 制造一次断言中途失败：serve-stale 的 T2（`serve-stale.test.mjs:115-142`）、T3（145-166）、T5（177-221）均无 try/finally，断言在收尾 kill 前抛错即泄漏子进程。例如临时改坏 T5 某断言跑一次（当年实证即 T5 场景的 `old-server.mjs` stub 残留监听 38804）。
2. 检查残留：
   ```bash
   lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(3[1-9][0-9]{3}|4[0-9]{4}|50[0-9]{3})'
   ps aux | grep -E 'atb-stale-|atb-api-' | grep -v grep
   ```
   可见残留监听者（2026-09-08 起即有 3 个 atb-api-* 临时目录 server.mjs 残留；2026-09-14 当日 3 轮 run-all 又新增 atb-stale-s2/s3 server 与 s5 stub 多个）。
3. 连续跑 `npm test`（`node scripts/tests/run-all.mjs`）多轮：serve-stale T1/T2/T3/T5（34100–40599 段）与 dispatch-api（`dispatch-api.test.mjs:52/350`，20000–40999 段，两段重叠）的随机端口一旦命中残留监听者即偶发失败。实证：round3 全量 225 文件仅 serve-stale T1 失败；run-all-round4-clean.log（清理后）同用例全过，证明偶发性与泄漏相关性。

补充（2026-09-14 复核快照）：当前 31000–50999 段未见 atb 测试残留监听，但段内存在第三方应用监听（Doubao 49182/49853、clash 33331）——共享段随机选端口不做占用预检，即使无测试泄漏也有碰撞风险。

## 期望行为

1. 测试收尾确定性：spawn 的 server/stub 一律「kill → 有界等待退出（超时兜底 SIGKILL）」，并置于 try/finally（或等价机制）保证断言失败路径也回收。现状两处缺口：serve-stale T2/T3/T5 无 try/finally；dispatch-api 的 `srv.stop()`（`dispatch-api.test.mjs:92-95`）SIGTERM 后最多等 5s 即放行、不校验结果——而 server.mjs 优雅关停强退兜底缺省 20s（`ATB_SHUTDOWN_FORCE_MS`，`server.mjs:3119`），存在「5s 内未退 → 静默泄漏」窗口，须消除。
2. 端口防碰撞：随机选端口前先探测可用性，被占则重选；或监听 0 端口由系统分配后转交实际端口。
3. 聚合层兜底：run-all.mjs 在每个测试文件结束后检测（并清理或醒目报告）遗留的测试子进程，阻断跨文件、跨轮次污染。
4. 失败可诊断：端口被占/就绪探测命中非目标进程时，报错应指向真实原因（端口冲突/非目标 health 响应），而非「health 应含数字 pid」这类误导性信息（可选强化：waitHealth 就绪判据附加 pid/startedAt 校验）。

## 验收说明

1. 确定性回归：按「复现步骤·方法一」占住端口后运行 serve-stale.test.mjs，用例不再以「health 应含数字 pid」误导失败——期望自动换端口后全绿，或快速失败并明确报告端口被占（具体策略以开发阶段方案为准）。
2. 无泄漏：`node scripts/tests/run-all.mjs` 全量通过后，lsof/ps 快照与 run-all 前对比，31000–50999 段（含 dispatch-api 20000–40999 段）无新增测试残留监听/进程。
3. 失败路径也回收：人为使 serve-stale 任一用例中途失败一次，收尾后同样无残留子进程。
4. 稳定性：serve-stale.test.mjs 连续 ≥5 轮通过；run-all 连续 ≥3 轮无本 Bug 款偶发失败。
5. 不破坏既有语义：T3「服务不旧不误杀」、T5「老服务被定位重启」等行为保持（serve-stale 全绿），其余测试文件回归通过。
