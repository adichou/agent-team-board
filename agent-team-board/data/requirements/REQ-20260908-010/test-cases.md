# 测试用例 — REQ-20260908-010 批量实施应改名为批量开发，方案应优化为提供一个已计划的状态分类，按照已计划的单自动串行处理。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 状态流转合法边：accepted → planned（人工）、planned → in-progress（claim 认领即实施）、planned → accepted（移出计划）均成功，`pushHistory` 留痕 | P0 | 通过（planned-state S1） |
| 2 | 状态流转非法边：planned → done、planned → submitted、submitted → planned 均被 `TRANSITIONS` 拒绝并报「非法流转」 | P0 | 通过（planned-state S2） |
| 3 | `claim()` 接受 planned 条目：认领后状态变 in-progress、占用项目实施互斥锁（他人/他调度器认领同项目被拒，锁属主放行） | P0 | 通过（planned-state S3） |
| 4 | 单个置计划 UI：已接受条目详情页出现「改为已计划」按钮，点击后免二次确认，卡片与详情状态标签即时变「已计划」 | P1 | 通过（planned-state S10 + drawer 既有回归） |
| 5 | 批量移出计划 UI：已计划档勾选 ≥2 项（均未进入开发中）→「移出计划」→ 全部变回已接受，`acceptResult` 区域展示成功清单 | P0 | 通过（planned-state S11） |
| 6 | 移出计划保护：勾选集合中含 in-progress 条目时，该条不可勾选（或操作被拒绝）并提示「已进入开发中，不能移出计划」；其余成功项不受影响 | P0 | 通过（planned-state S11：in-progress 无选择框且 removeFromPlan 过滤） |
| 7 | 批量移出计划含失败项时：成功/失败分列反馈，不因单项失败回滚全部（对齐批量接受行为） | P1 | 通过（removeFromPlan 逐条 catch，对齐 acceptItems） |
| 8 | 开发启动按钮：任务模块可选 zcode / codex 模式；未选模式时启动按钮不可用；启动后按钮切换为停止/暂停后续 | P0 | 通过（planned-state S12） |
| 9 | 最旧优先取单：构造多个 planned 条目（创建时间不同），启动后第一个被处理的单为创建时间最早者；处理完上报释放占用后自动取下一最旧项 | P0 | 通过（planned-state S5/S6；scheduler D1 更新为纯创建时间序） |
| 10 | 实时获取：调度运行中把新的 accepted 条目置为 planned，无需重启/新建批次，当前项完成后该新条目被后续取到 | P0 | 通过（planned-state S6：nextItem 吸收新置计划条目） |
| 11 | 处理中状态反馈：被取到的单状态变「开发中」（in-progress），任务面板「当前条目」展示其编号与执行器 | P1 | 既有批次/执行面板行为保留（batch current/records 回归通过） |
| 12 | 队列已空：所有 planned 处理完（或无 planned）时展示等待提示（等待已计划条目），不创建虚假执行记录 | P1 | 通过（planned-state S13 文案 + scheduler D2 空队列不派发回归） |
| 13 | 选单口径收敛：`atb list --json` 候选、Zcode 调度、Codex 调度对新口径一致——planned 可派，accepted 不再被自动派发（手工 `/dev <id>` 对 planned 可用；对 accepted 的行为按 design 定案验证） | P0 | 通过（planned-state S5/S13；手工 claim accepted 仍合法，属人工兜底通道） |
| 14 | state-guard 守卫：无认领锁时 Agent 执行 `atb status <ID> planned`（或写 status.json 改 planned）被拦截，退出码 2 且提示人工专属操作指引 | P0 | 通过（planned-state S4） |
| 15 | state-guard 放行：有效认领锁期间开发类操作不被误拦（回归） | P1 | 通过（code-guard.test.mjs 既有回归全绿） |
| 16 | 改名检查：`scripts/web/index.html` 与 `scripts/web/app.js` 面向用户的文案无「批量实施」残留（grep 校验）；代码内部标识符（implGo、/api/batch/*）不受影响、接口回归通过 | P1 | 通过（planned-state S16） |
| 17 | 筛选档与标签：需求列表出现「已计划」档（或按定案的档位划分），planned 条目出现在对应档；五档排序/搜索/勾选行为（REQ-20260908-002、BUG-20260907-016 回归）不破坏 | P1 | 通过（planned-state S9/S17 + list-sort/impl-entry-ui 更新后回归） |
| 18 | 存量兼容：升级前已存在的 accepted / in-progress / done 条目与未结束批次账本在升级后正常展示、可继续流转/跑完；老 `status.json` 无需迁移 | P0 | 通过（pending-alignment/batch-* 回归；未结束批次剩余 accepted 候选按「出局」收尾，需人工置计划后走新流程，见 design 实施记录） |
| 19 | 依赖策略回归：`dependsOn` 未满足的 planned 条目暂不派发并提示依赖阻塞（BUG-20260906-005 口径），依赖完成后自动可派 | P1 | 通过（scheduler D1 依赖用例随口径更新后回归） |
| 20 | 端到端链路：已接受 → 已计划 → 开发启动（codex 模式）→ 开发中 → report（待测试）→ 人工确认完成，全链状态与看板展示正确 | P0 | 通过（planned-state S7/S8：API 置计划→claim→report→/api/board 展示） |
| 21 | 需求完善（REQ-20260907-003）回归：submitted 层面的完善批次不受新状态影响 | P2 | 通过（refine-* 测试回归全绿） |

自动化落点：新增 `scripts/tests/planned-state.test.mjs`（S1–S17 覆盖上表），并同步更新既有
`scheduler.test.mjs`、`impl-entry-ui.test.mjs`、`impl-scope.test.mjs`、`batch-*.test.mjs`、
`pending-alignment.test.mjs` 等对旧「accepted 选单」口径的断言为新「planned 选单」口径。

说明：

- 用例 9 的「最旧」按创建时间定义；「需求优先于 Bug」规则是否保留待 design 定案（见 design.md 待确认项），定案后补充对应断言。
- 用例 8、11 的 zcode 模式只验证「提示词就绪/待启动」状态与复制流程；Zcode 会话真实运行不作为自动化断言（复制成功 ≠ 启动成功，见 `docs/agent-team-board/batch-execution.md` §3）。
- 用例 14、15 依赖 `scripts/state-guard.mjs` 的拦截清单同步更新，先于 UI 放开实现（见 design.md 风险）。
