# BUG-20260910-012 scheduler-unclaimed.test.mjs 间歇失败（等待运行结算超时，HEAD 基线可复现）

- 状态：以看板机器状态为准（本文仅完善说明）。
- 归属：独立 Bug（引入来源见 design.md，修复阶段归因）。
- 创建：2026-09-10T05:34:53.743Z

## 现象

全量测试时 `scripts/tests/scheduler-unclaimed.test.mjs` 间歇失败：断言报 `AssertionError: 等待运行结算超时`。该信息来自测试自带的 `waitFor`（5 秒预算，`scripts/tests/scheduler-unclaimed.test.mjs` 第 13–19 行），测试内共三处调用共用同一文案（第 45 行等待 run 进入终态、第 47 行等待 disable 后 `status().current` 清空、第 64 行等待后续条目 `agentCompletedAt`），登记时未逐点记录实际卡在哪一处，待确认。

登记时排查记录（实施 REQ-20260910-012 期间发现）：

- 该测试只 import `scripts/lib/core.mjs`、`dispatch-store.mjs`、`scheduler.mjs`，与该需求的界面布局改动（`scripts/web/*`、`electron/shell-css.mjs`）无关。
- 在干净 HEAD 基线（git worktree detach）连跑 4 次 4 次失败；用户工作区 3 次 2 次失败——既有 flaky/失败，非该条目引入。
- 测试按 `no-report` / `no-thread` / `timeout-sleep` 三种模式轮转，全链路使用真实定时等待（调度器 `tickMs: 25`；`timeout-sleep` 模式 `timeoutMs: 150`、`cancelGraceMs: 50`、`settleMs: 50`；续跑重派另有真实 `setTimeout`），怀疑时序敏感（机器负载 / Node 17 定时器精度），待专项排查。

2026-09-10 完善时复核：本机空闲直连 `node scripts/tests/scheduler-unclaimed.test.mjs` 连跑 3 次均通过（Node v17.8.0，macOS arm64）——失败与机器负载相关，空闲时不易复现，符合「间歇失败」定性。

## 复现步骤

1. 环境：macOS（darwin arm64）+ Node v17.8.0（项目 `package.json` 无 `engines` 声明，实际开发机为 17.8.0；其他 Node 版本下的表现待确认）。
2. 首选路径（更易复现）：运行全量 `npm test`（= `node scripts/tests/run-all.mjs`，按文件名顺序执行，该文件位于 144 个测试中的第 117 位，跑至该文件时机器已积累了大量子进程与定时器活动），重复多次。登记时在干净 HEAD worktree 上连跑 4 次 4 次失败；用户工作区 3 次 2 次失败。
3. 备选路径（直连）：`node scripts/tests/scheduler-unclaimed.test.mjs` 循环执行（如连跑 10 次）。空闲机器可能连续通过（2026-09-10 本机 3/3 通过）；在机器存在其他负载（编译、并行跑另一轮全量测试）时更接近登记时的失败条件。
4. 预期失败形态：进程非零退出，输出 `AssertionError [ERR_ASSERTION]: 等待运行结算超时`（`waitFor` 内 `assert.ok`，测试文件第 16 行）；失败可能出现在三处等待之一（见「现象」），具体卡点待开发阶段定位（待确认）。

## 期望行为

- 该测试在项目常规运行方式（直连执行与全量 `npm test`）与常规开发机负载下稳定通过：连跑多次（建议 ≥10 次，含机器有负载场景）均退出码 0，不再出现「等待运行结算超时」断言失败。
- 修复不得削弱测试语义，以下断言全部保留：单 run 尝试预算（`no-report` 模式 2 次尝试、其余 1 次）、执行器不能伪造认领（条目状态保持 planned）、重新开启后不得自动重派失败项、重启后不得丢失失败记录、失败项不得阻止其他条目正常派发。
- 修复方向二选一（由开发阶段 design.md 归因定案，登记阶段不定论）：若根因在测试侧（固定 5s 等待预算对高负载机器不足、依赖真实定时器），应改为对时序抖动鲁棒的等待策略（放宽预算或事件驱动），且不引入过长等待拖慢全量测试；若根因在调度器/结算逻辑（`scripts/lib/scheduler.mjs` 的 timeout/cancel/settle 时序），须修复业务逻辑并附根因证据与回归测试。
- 不改动调度器生产默认参数（`tickMs`/`timeoutMs`/`cancelGraceMs`/`settleMs` 等默认值），除非 design.md 论证必要并明确记录。

## 界面展示

不涉及界面改动：本 Bug 现象是纯测试时序断言失败，修复面在 `scripts/tests/scheduler-unclaimed.test.mjs`（测试等待策略）与可能的 `scripts/lib/scheduler.mjs`（定时/结算逻辑），不触碰 `scripts/web/*` 与 `electron/*` 界面代码，界面无布局、交互、状态反馈变化——无需 ui-demo.html。说明：看板启发式以「现象 + 期望行为」文本命中 UI 词表判定 UI 单；本条现象文本中的「布局」一词出自「与本次界面布局改动无关」的排除性描述，系误命中，按「不涉及界面改动」兜底口径声明。

## 验收说明

- [ ] `node scripts/tests/scheduler-unclaimed.test.mjs` 连跑 ≥10 次全部退出码 0，其中至少一轮在机器有负载时执行（如与一次全量 `npm test` 并行）。
- [ ] `npm test` 全量连续 ≥3 次不出现该文件失败；单文件仍在 run-all 的 180s 超时上限内完成。
- [ ] 三种模式（no-report / no-thread / timeout-sleep）的既有断言语义逐条保留：有限尝试预算、不伪造认领、重新开启不自动重派、重启保留失败记录、后续条目可正常派发。
- [ ] 修复不改变调度器对外语义：生产默认参数不变（或变更已论证并记录于 design.md）；全量测试无其他新增失败。
- [ ] 根因归因写入 design.md（引入来源三选一：具体单号 / 未定位附排查过程 / 暂空，修复阶段必须归因，禁止编造），并附复现数据（运行次数、环境、失败断言位置）。
