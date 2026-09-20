# 测试报告 — BUG-20260914-007 body-limit.test.mjs 在 run-all 全量跑下偶发失败（单独运行通过）

- 时间：2026-09-14T05:35:13.014Z
- 执行者：zcode-batch-048-12
- 测试框架：node:assert/strict + 真实 server.mjs 集成 + 环境注入自检
- 覆盖率：100%

## 总结

body-limit 全量偶发失败修复（仅测试层）：启动就绪预算 6s→45s 且要求 health 200、server 退出快速失败并附 stderr 尾部诊断；请求带环节标签（健康检查/T1/T2/T3/超限后恢复），超时/连接错误可区分环节；传输类抖动默认重试 1 次且每次留痕，功能性失败不重试；注入旋钮 3 个（STARTUP_BUDGET_MS/REQ_TIMEOUT_MS/TRANSPORT_RETRIES）；新增 3 个确定性自检用例先红后绿，原 4 项功能断言语义不变；单独 3 连跑 + 全量 4 轮（含 1 轮 6 进程 CPU 压测）body-limit 全过、清理进程泄漏后全量 0 失败退出 0；第 3 轮 serve-stale T1 失败为预存进程泄漏所致，已登记 BUG-20260914-013；引入来源归因 BUG-20260907-004（design.md）

## 明细

改动仅 1 个文件：`scripts/tests/body-limit.test.mjs`（server.mjs 的 `BODY_MAX_BYTES=12MB` 与超限 400 JSON 行为零改动）。

### TDD（先红后绿）

- 红：先加入 3 个自检用例（helpers 未实现），`node scripts/tests/body-limit.test.mjs` → 主功能用例 ✓，3 个新用例 ✗（waitReady is not defined 等）。
- 绿：实现 `waitReady`/`req(带环节标签)`/`withTransportRetry` 并重接主用例 → 4/4 ✓，退出 0。

### 稳定性验证（验收 1/2）

| 轮次 | 方式 | 结果 |
| --- | --- | --- |
| 单独 3 连跑 | `node scripts/tests/body-limit.test.mjs` | 每轮 4/4 ✓、exit 0、无残留监听 |
| 全量 R1 | `node scripts/tests/run-all.mjs` | 225 文件失败 0，exit 0（2m46s） |
| 全量 R2（高负载） | 全量期间并发 6 个 CPU busy-loop 进程 | 225 文件失败 0，exit 0 |
| 全量 R3 | 全量 | body-limit ✓；serve-stale T1 ✗（与本条目无关，见下） |
| 全量 R4（清理泄漏后） | 全量 | 225 文件失败 0，exit 0 |

### 失败定位注入验证（验收 3/4）

- `ATB_TEST_BODY_LIMIT_STARTUP_BUDGET_MS=100` → `✗ … / 服务启动未就绪：100ms 内 /api/health 未返回 200（探测 1 次，最后错误：ECONNREFUSED）`——与请求超时明确区分。
- `ATB_TEST_BODY_LIMIT_REQ_TIMEOUT_MS=1 ATB_TEST_BODY_LIMIT_TRANSPORT_RETRIES=2` → 输出 `↻ T1 2MB 附件创建 疑似环境抖动（请求超时[T1 2MB 附件创建]：1ms 无响应），重试 1/2`、`重试 2/2` 后 `✗ … / 请求超时[T1 2MB 附件创建]：1ms 无响应`——重试留痕 + 环节标签。
- 非法注入值 → 加载期快速失败：`环境变量 ATB_TEST_BODY_LIMIT_REQ_TIMEOUT_MS 应为正整数（收到 abc）`。
- 自检用例（随全量常驻、确定性）：启动未就绪消息含 ECONNREFUSED/探测次数/退出信息/stderr 尾部且非 200 不算就绪；never-respond 本地服务 300ms 触发 `请求超时[T3 /api/new 超限 400]：300ms`；传输类失败重试 1 次留痕后成功、功能性失败（无 transport 标记）不重试无重试日志。

### 全量 R3 的 serve-stale T1 失败（无关本条目，已另立 Bug）

R3 中 `serve-stale.test.mjs` T1 报「health 应含数字 pid」：排查发现机器上残留多个泄漏的测试进程（2026-09-08 起的 atb-api-* server、当日各轮的 atb-stale-s2/s3 server 与 s5 old-server stub），其中泄漏 stub 监听 38804（health 返回 ok:true 无 pid），恰落入 T1 随机端口段 34100-39099 造成碰撞。清理全部泄漏进程后 R4 全量 0 失败。该预存问题已登记 **BUG-20260914-013**（submitted，待人工接受），泄漏进程已清理（用户自有 `scripts/server.mjs` 服务未动）。

### 日志

全量 4 轮完整日志：`docs/agent-team-board/dispatch/runs/run-20260914-228/run-all-round{1,2-stress,3,4-clean}.log`。
