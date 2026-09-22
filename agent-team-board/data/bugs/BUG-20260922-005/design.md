# 设计 — BUG-20260922-005 并发 npm test 实例互相误杀对方测试 server：run-all 文件级残留清理无法区分他实例在用进程，ECONNREFUSED 偶发

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260914-013（引入 run-all 每文件结束的 sweepTestResidue 兜底与「node + server.mjs + cwd 临时目录 + 监听段」残留判定，未考虑并发实例的在用 server 同样命中判定）。单号经 `atb show` 核验存在（done）。

## 根因分析

两层：

1. **跨实例互杀（ECONNREFUSED 族）**：run-all.mjs 串行逐文件，但每文件结束调用 sweepTestResidue；classify() 无法区分「上一轮遗留」与「另一并发实例正在使用的 server」（测试 spawn server 普遍 cwd=临时目录）。看板确认/核验任务内嵌 npm test、终端手工 npm test、服务重启中断任务的孤儿测试进程（BUG-20260922-004）三者任意重叠即触发互杀。
2. **单实例偶发（ECONNRESET 族，2026-09-22 14 时补充证据）**：单实例全量中 req-20260922-005.test.mjs 以未捕获 read ECONNRESET 崩溃整文件（连接建立后被断开，异常未被捕获）。负载下测试 server 中途死亡 + 用例级请求助手无瞬时错误重试。

## 方案

**A. run-all 单实例互斥（治本，消除互杀前提）**——新建 `scripts/tests/lib/run-gate.mjs`：

- 锁文件 `<os.tmpdir()>/atb-run-all-<sha1(测试目录绝对路径)前 10 位>.lock`（按套件分键：同套件互斥，不同仓库副本共存），内容 `{pid, startedAt, suite}`。
- 启动时获取：无锁即建（O_EXCL 原子创建）；有锁且持有 pid 存活 → **等待**（每 2s 轮询，等待上限默认 20 分钟，环境变量 `ATB_RUNALL_LOCK_WAIT_MS` 可调以便测试），等不到快速失败并输出持有者 pid / 启动时间与明确指引；有锁但 pid 已死（陈旧锁）→ 接管覆写。
- 正常退出 / 异常 / SIGINT / SIGTERM 尽力释放（finally + 信号处理，残留陈旧锁由 pid 存活判定自愈）。

**D. 聚合层文件级重试一次（治标，覆盖两类瞬时偶发）**——run-all.mjs：

- 单文件首跑失败（exit≠0）→ 先对该文件做一次 sweepTestResidue（清理首跑可能泄漏的 server，提高重试成功率）→ 重试一次；重试通过标记 `✓ f（重试 1 次后通过，瞬时偶发 BUG-20260922-005）`，仍失败按原口径计入 failed（真实回归跑两次仍失败，不掩盖）。每次尝试独立享有 180s 文件超时。摘要输出重试计数，可观测不静默。

**B（sweep 收窄）不做**：A 落地后并发实例不复存在，文件级 sweep 只会清到「本 run 上一文件泄漏的 server」与「run 开始前的陈旧残留」，正是 BUG-20260914-013 的原有目的，保留不动。

**C（中断任务终止其 detached npm test 进程组）不在本单**：属确认任务进程生命周期管理，与确认记录并发写回退（BUG-20260922-004）同源同修，避免本单范围扩散；A 的等待语义已使孤儿实例不再造成互杀（新 run 等孤儿跑完再执行）。

**自研，无新增依赖**（node 内置 fs/os/crypto/child_process 即可；不适用开源选型：所需为 30 行级进程/文件锁原语，无合适库分形态且引入成本高于自研）。

## 风险与边界

- 等待上限内真死锁（持有者 hang 住不退）：20 分钟后快速失败并给出持有者 pid，人工可按 pid 清理；pid 存活判定防误接管活实例。
- 重试可能轻微延长真实失败的全量时长（该文件跑两次）；仅重试一次、摘要可见。
- 锁按测试目录分键：同一仓库的插件缓存副本与本仓库各自独立，不互相阻塞。
- 不改变 sweep 的判定规则与清理力度（BUG-20260914-013 回归面零变化）。

## 用例

见 [test-cases.md](./test-cases.md)。

## 实施记录（zcode-run-gate，2026-09-22）

- 新增 `scripts/tests/lib/run-gate.mjs`：`acquireRunLock`（O_EXCL 原子建锁；持有者存活→轮询等待至上限后抛错，消息含持有者 pid/启动时间/指引；陈旧锁（pid 已死或损坏）移除接管；release 只删仍属本实例的锁）、`lockPathFor`（`<tmp>/atb-run-all-<sha1(套件目录)前10>.lock`，按套件分键）、`installGateSignalRelease`（SIGINT/SIGTERM 尽力释放，双保险：残留陈旧锁由下一轮 pid 存活判定自愈）、`runFileWithRetry`（首跑失败→提示+`<file>#retry` sweep→重试一次，结果带 retried 标记）。
- `scripts/tests/run-all.mjs`：启动先取锁（等待上限 `ATB_RUNALL_LOCK_WAIT_MS`，默认 20 分钟；超时 exit=2 与测试失败 exit=1 区分，未执行任何文件）；主循环改用 `runFileWithRetry`（重试通过输出「✓ …（重试 1 次后通过，瞬时偶发 BUG-20260922-005）」并计入摘要「重试后通过 N 个」；仍失败照常计入 failed）；finally 释放锁；既有文件间 sweep 与 run-end sweep 原样保留（BUG-20260914-013 回归面零变化）。
- 新增 `scripts/tests/bug-20260922-005.test.mjs`（L1/L1b/L2/L3/L4 共 6 用例，先跑红后转绿；L2 用小等待上限 spawn 真实 run-all 验证 exit=2、输出含持有者 pid、未执行任何测试文件）。
- 验证：bug-leak-residue-20260914-013 回归全绿；全量 `npm test` **333 文件失败 0、零重试触发**（新闸门自身在真实全量下工作正常）。
