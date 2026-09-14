# BUG-20260910-016 scheduler-unclaimed 测试在负载下偶发超时失败

- 状态：以看板机器状态为准（本文仅完善说明）。
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-10T07:52:26.550Z

## 现象

scheduler-unclaimed.test.mjs 第 64 行 waitFor 预算固定 5 秒：timeout-sleep 轮内先经历超时判定/取消宽限/结算再派发 worker-ok（子进程再串行跑 atb claim + atb report），机器负载高时 5 秒内完不成即断言「等待运行结算超时」。实测（2026-09-10）：git HEAD 纯基线 worktree 3 连跑 1 次失败、A/B 基线 2/3 失败，均与任何工作区改动无关；单独重跑即过。建议放宽该轮 waitFor 预算或拆分迭代。

2026-09-10 完善时复核（行号/机制与关联单核实，供开发阶段归因）：

- 行号按 git HEAD（提交 `0f84698`，仓库唯一提交）核验属实：HEAD 版 `waitFor` 预算固定 5000ms（第 13–19 行，`assert.ok` 在第 16 行），第 64 行正是第三处调用 `await waitFor(() => !!core.getItemDetail(d, next).agentCompletedAt)`——等待 timeout-sleep 轮重启后「后续可运行条目」的 `agentCompletedAt` 出现。
- 机制核实：HEAD 版测试对 timeout-sleep 模式全程使用 `timeoutMs: 150`（含重启后的 worker-ok 阶段）。重启后的 worker-ok run 需串行完成 3 个 node 子进程（fake-codex 自身启动 + `spawnSync` 的 `atb claim`、`atb report`，见 `scripts/tests/fixtures/fake-codex.mjs` worker-ok 分支）；负载下 150ms 内完不成即被调度器按超时强杀、run 落 `failed`（`scripts/lib/scheduler.mjs` 超时分支），`agentCompletedAt` 永不出现，第 64 行 `waitFor` 空转至 5s 预算耗尽断言。
- 与 BUG-20260910-012 的关系：012（登记 05:34）与本条（登记 07:52）指向同一测试文件、同一「等待运行结算超时」断言，属并行批次对同一 flaky 的两次独立登记。012 已于 2026-09-10 08:11 完成修复上报（状态 in-progress 待人工确认），修复已在当前未提交工作区：`waitFor` 预算 5s→15s 并加卡点标签；`timeoutMs` 分阶段（150ms 仅用于首个探针 run，重启/后续阶段 5000ms）。012 上报根因（150ms 时限误杀重启后 worker-ok run）与本条现象吻合，其验证数据含直连 15 连跑（其中 10 轮与全量测试并行施载）全过、全量 `npm test` 连续 3 次全绿。
- 本条晚于 012 登记、早于其修复上报；最终按重复登记合并还是独立验证修复，由开发阶段在 design.md 定案（禁止编造归因）。

## 复现步骤

1. 环境：macOS（darwin arm64）+ Node v17.8.0（项目 `package.json` 无 `engines` 声明，v17.8.0 为登记/完善时开发机实测版本；其他 Node 版本下的表现待确认）。
2. 基线前提（关键）：本条现象对应**未包含 BUG-20260910-012 修复**的代码形态。当前工作区已含 012 修复（`waitFor` 15s、timeout-sleep 重启阶段改用 5000ms 时限），直接跑当前树大概率通过。复现原始现象须在干净 HEAD 基线：`git worktree add --detach <path> HEAD`（HEAD 即 `0f84698`，该树下测试文件为修复前形态）。
3. 施加负载（接近登记时失败条件）：在基线 worktree 内与另一轮全量 `npm test` 并行执行、或同时进行编译等高 CPU 活动。空载时可能连续通过（登记实测为负载下 3 连跑 1 失败、A/B 基线 2/3 失败；012 完善时本机空载直连 3/3 通过）。
4. 运行方式二选一：
   - 直连：在基线 worktree 内循环执行 `node scripts/tests/scheduler-unclaimed.test.mjs`（如连跑 10 次）；
   - 全量：`npm test`（= `node scripts/tests/run-all.mjs`，顺序执行 `scripts/tests/*.test.mjs` 全部文件，单文件 180s 超时）重复多次——跑至该文件时机器已积累大量子进程与定时器活动，更易命中。
5. 预期失败形态：进程非零退出，输出 `AssertionError [ERR_ASSERTION]: 等待运行结算超时`（基线 `waitFor` 内 `assert.ok`，测试文件第 16 行）；卡点为 timeout-sleep 轮第 64 行等待（见「现象」复核第 2 点的机制），失败通常发生在 timeout-sleep 轮、no-report / no-thread 轮正常；单独重跑同文件通常即恢复（间歇性）。

## 期望行为

- 该测试在项目常规运行方式（直连执行与全量 `npm test`）与常规开发机负载下稳定通过：连跑多次（建议 ≥10 次，含机器有负载场景）均退出码 0，不再出现「等待运行结算超时」断言失败。
- 与 BUG-20260910-012 的重叠处理：修复/结项前必须先核对 012 的修复（waitFor 15s + timeoutMs 分阶段）是否已覆盖本条现象——若覆盖，以负载下连跑复测数据确认后按重复登记处理并在 design.md 记录归因；若复测仍能独立复现失败，须独立归因修复，不得直接引用 012 结论结项。
- 修复不得削弱测试语义，三种模式（no-report / no-thread / timeout-sleep）的既有断言全部保留：单 run 尝试预算（no-report 模式 2 次尝试、其余 1 次）、执行器不能伪造认领（条目状态保持 planned）、重新开启后不得自动重派失败项、重启后不得丢失失败记录、失败项不应阻止其他条目正常派发。
- 不改动调度器生产默认参数与逻辑（`scripts/lib/scheduler.mjs` 默认 `tickMs: 4000` / `cancelGraceMs: 10_000` / `settleMs: 1500` / `timeoutMs: 60 分钟`），除非 design.md 论证必要并明确记录。

## 验收说明

- [ ] 先决核对：design.md 完成与 BUG-20260910-012 的重叠归因（三选一，附证据）：完全同源且已由 012 修复覆盖 / 同源但 012 修复不充分 / 独立故障。
- [ ] 在包含 012 修复的当前工作树上：`node scripts/tests/scheduler-unclaimed.test.mjs` 连跑 ≥10 次全部退出码 0，其中至少 1 轮在机器有负载时执行（如与一次全量 `npm test` 并行）。
- [ ] `npm test` 全量连续 ≥3 次该文件不失败；单文件仍在 run-all 的 180s 超时上限内完成。
- [ ] 三种模式的断言语义逐条保留（有限尝试预算、不伪造认领、重开不自动重派、重启保留失败记录、失败不阻塞后续条目）；调度器生产逻辑与默认参数未改（或变更已论证并记录于 design.md）。
- [ ] 结项形态二选一并有据可查：若确认与 012 完全同源且已覆盖——结项说明引用 012 修复与验证/复测数据，不重复改动测试；若仍有独立失败点——附本条自己的复现-修复-回归数据（运行次数、环境、失败断言位置）。

