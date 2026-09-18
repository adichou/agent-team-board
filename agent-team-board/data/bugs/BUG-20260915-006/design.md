# 设计 — BUG-20260915-006 default-port 测试以 800ms HTTP 探活判定端口占用不可靠，面板触发核验时必现假失败

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260905-003（把 Status Board 默认端口改为 8888 时引入 default-port.test.mjs，其 `portBusy()` 即采用 HTTP 探活判占用策略；后续补充的 V6/V7 跳过护栏延续同一策略，未改变不可靠的判定本质）

## 根因分析

（登记时已定位并实证，修复阶段复核行号即可）

`scripts/tests/default-port.test.mjs`：

- `portBusy(port)`：HTTP GET `/api/health`，800ms 超时；**error/timeout 一律 resolve(false)（判「未占用」**），仅收到 HTTP 响应才判「占用」。占用者只要响应慢于 800ms 就被误判为空闲。
- 两处消费点都被这个误判打穿：
  - V6 跳过护栏（`if (await portBusy(8888)) skip`）：面板核验时服务端 `spawnSync` 跑 `npm test` 阻塞了 8888 上的看板服务自身（`confirm-store.mjs` `runProjectTests` 的同步 spawn），护栏必失效 → 自起服务 EADDRINUSE（stdio ignore，静默死）→ `waitHealth` 8s 探不到 → 断言失败；
  - V7 的 `port8888Busy` 预检：服务空闲但偶发响应慢（health 要聚合项目列表、前端 2s 轮询）→ 预检 false → 「不应再占 8888」断言未跳过 → 结尾探活命中真服务 → 失败。

实证：同一份文件，面板触发挂 V6、终端空闲挂 V7、终端多数时候全绿——结果随环境抖动，非被测代码回归。

## 方案

**开源选型（REQ-20260909-015）**：无合适库（Node 内置 `net` 模块的 bind 探测即标准做法，几十行以内，引入依赖成本高于自研）。

方向（开发阶段细化并补测试）：

1. 新增 `portOccupied(port)`：`net.createServer().listen(port, '127.0.0.1')`——`EADDRINUSE` → 已占用；listening → 立即 `close()` 并判空闲。判定不依赖占用者协议/响应速度。
2. V6：`portOccupied(8888)` 为真 → 跳过（保留现有提示语）；为假 → 起服务断言 `port=8888`。
3. V7：`port8888Busy` 预检与结尾「不应再占 8888」断言均改用 `portOccupied`。
4. `waitHealth`/探活语义保留 HTTP（探「服务健康」仍合理），仅**占用判定**换 bind。

## 风险与边界

- bind 探测存在极小竞态窗口（探测与真实占用者同时 bind）；对测试场景可接受，可在用例注释说明；
- 本修复不动服务端 `spawnSync` 阻塞问题（核验期间面板无响应属另一体验问题，如需治理另立需求：改异步 spawn + 进度上报）；
- 修复合入后，BUG-20260914-020 的「确认并继续」应能通过测试关卡——可作为端到端验证场景。

## 实施记录（2026-09-15）

**例外授权留痕**：`atb claim BUG-20260915-006` 被项目级挂起拦截（BUG-20260914-020 待人工确认，暂停期间禁止认领），形成死锁（020 确认需测试全绿 → V6 假失败需本单修复 → 本单认领需挂起解除）。经用户在会话中明确选择「授权例外开发」，按 dev 收尾规则「认领受阻后的明确例外授权」分支实施；未解除 020 挂起、未代替任何人工确认。源码编辑经认领锁校验放行（当时 `impl.lock` 尚在 24h 有效期内）。

**TDD 过程**：

1. 红：新增 V9 用例引用尚不存在的 `portOccupied` → `✗ V9 … portOccupied is not defined`（1/9 失败，其余不受影响）；
2. 绿：`scripts/tests/default-port.test.mjs` 新增 `net` 导入与 `portOccupied()`（`net.createServer().listen(port, host)`：`EADDRINUSE` → true；listening → close 后 false）；V6 跳过护栏、V7 的 `port8888Busy` 预检 / 7737 占用检查 / 「不应再占 8888」断言共 3 处判定点由 `portBusy` 切换为 `portOccupied`；`portBusy` 保留给 `waitHealth` 作健康等待语义（探「服务可应答」而非「端口占用」）；V9 用临时 dummy server 自证占用/空闲两分支；
3. 稳定性：看板服务运行中（8888 被占）单跑本文件 10 次全绿（10/10），V6/V7 稳定走跳过分支；
4. 全量 `npm test`（240 文件）通过（结果见 test-report.md）。

**改动面**：仅 `scripts/tests/default-port.test.mjs` 单文件，不涉服务端与业务代码。

