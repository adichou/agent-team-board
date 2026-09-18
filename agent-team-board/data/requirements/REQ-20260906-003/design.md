# 设计 — REQ-20260906-003 Codex 后台自动派发：每单独立会话、日志追踪与进程回收

状态：设计稿，尚未实施。业务、UI 与验收以 [README](README.md) 为准，共用协议见 [批量实施说明](../../batch-execution.md)。

## 1. 架构

在现有 Node 服务内增加 Scheduler、RunStore、CodexExecAdapter、ExecutionVerifier 四个职责清晰的模块。调度器不调用主模型：读取配置和队列，预留条目，启动执行器，消费事件，核对结果并收尾。worker 按现有 atb skill 单项实施。

- Scheduler：同项目互斥、全服务串行、稳定选单、依赖、重试、暂停及恢复；使用事件触发和有上限的轮询兜底，空队列不启动模型。
- RunStore：持久化意图、运行记录、关联、结果与日志偏移，原子更新并保证幂等。
- CodexExecAdapter：CLI 参数与输入、进程归属、事件解析、确切会话恢复、取消和收尾；不承担业务完成判断。
- ExecutionVerifier：核对新 report、runId/owner/条目和测试证据，确认执行资源停止；输出 reported/blocked/failed/cleanup_pending 等账本结果。

先实现 exec adapter，接口预留其他后端；不为一个需求同时实现 SDK 和 app-server 执行器。遇到共享 daemon 上仍活跃的 turn，可使用已验证的精确中断/查询机制；不因 CLI 是本次启动，就假定共享 daemon 也是本次所有。

## 2. 预检与运行配置

CLI 路径按显式配置、PATH、已安装桌面包内置路径依次探测，记录实际可执行路径和版本。用实际帮助/能力验证参数，避免复用过时选项。沿用用户配置的模型与登录，不把凭据放入提示词、命令参数、日志或看板接口。

静态预检包括 CLI 可执行、cwd、当前项目是否受支持、所需 atb skill 与工具入口、已配置权限。模型可达性使用用户明确触发的最小验证，并显示实际结果。非 Git 项目可在明确支持策略下工作，不静默执行 git init；--skip-git-repo-check 等兼容选项需能力验证并与 UI 提示一致。

默认参数：单项时限 60 分钟、可恢复网络重试最多 2 次、同项最多追加 2 轮、取消宽限期 10 秒、自动派发关闭、重启自动继续关闭。权限使用完成当前项目工作所需的配置；不把禁用所有审批/守卫当作默认实现。

## 3. 启动与会话协议

先持久化 runId、条目、owner、工作目录、配置快照和 `reserved` 意图，在项目互斥内复核 accepted。runner 启动失败时尚未认领，核对无副作用后释放预留；worker 启动成功后通过受控 claim 转为 in-progress。

使用 `spawn(executable, args, { cwd, env, stdio })`。提示词由服务根据真实条目生成，经 stdin 传入；项目路径和配置独立作为参数。不将来自 HTTP 的任意原始命令透传为执行器，不依赖 `.command`、open、Terminal 或 GUI 深链。

以 `--json` 消费 JSONL，使用事件行缓冲，处理跨 chunk、尾行、未知事件和非 JSON 诊断。拿到真实 thread.started 后立即持久化 threadId；最终回复与事件记录分开保存。运行时未给出 ID 时保留 null 和诊断信息，不从随机输出文本猜 ID。

每个新条目创建独立会话。恢复仅使用记录中的确切 threadId；禁止 `resume --last`。恢复沿用 runId/owner 的当前执行尝试，网络重试和新尝试均单独记录事件；若决定新建上下文接续同一项，则新 runId 关联前一尝试，并通过受控核对衔接，不能绕过异 owner 认领限制。

一轮结束但没有完整上报时，不直接派下一项；按已保存会话 ID有限续跑。续跑只提供缺失证据与本项路径，不注入其他需求历史。超过轮数或时限转 blocked/failed，业务状态保持 in-progress。

## 4. 完成证据与账本

共用 `dispatch/runs/<runId>/run.json`，另保存 `events.jsonl`、`stderr.log`、`final-message.md` 及可核对的测试结果引用。运行记录至少包含配置快照的非敏感部分、PID 与开始时间、线程 ID、尝试/续跑次数、取消请求和退出信息。

报告匹配必须覆盖本次 runId、owner、条目、时间和真实文件存在性。旧 test-report 占位文件和旧 agentCompletedAt 不能被当成新结果。测试失败或覆盖率未知必须如实写入报告；核对器不擅自把未测写成通过。

只有完成证据齐备并且执行已结束、受管后台工作已收尾，才把运行账本置 reported。该结果不把条目置 done；报告已写但进程仍运行时保持等待收尾。回调、重复事件和重启重放均不重复增加计数或创建新执行。

## 5. 取消、超时和进程所有权

每个 run 持有独立进程归属记录；能使用受管进程组时记录组与成员身份，不能按全局进程名清理。PID 必须与启动时间和本次归属匹配，旧记录中的 PID 被复用时禁止 kill。

停止请求先持久化并显示“停止中”。优先向对应执行/会话发送中断，等待 10 秒；仍存活的受管进程再做强制回收。取消控制路径不得阻塞日志读取，不能因 stdout 管道未读而让子进程死锁。

CLI 退出后继续核对本次工具/turn。如果执行依赖共享 daemon，不杀 daemon，针对本次 thread 精确核对与停止；没有可靠能力时进入 cleanup_pending 并保留项目实施锁。停止验收须确认没有延迟文件写入，不能只检查主 PID 消失。

关闭自动派发不杀当前项；显式停止当前才取消。服务正常关闭先停止新取单、取消受管执行、落盘和回收，再退出。异常崩溃/断电可能留下进程或状态不明的 turn，重启后进行核对；不宣称能在断电时执行清理代码。

Electron stopService 当前直接结束自建服务，需要增加与 scheduler 协调的关闭步骤；复用外部服务时仍不拥有它的生命周期。不能为了退出一个看板窗口终止其他项目或用户自己的任务。

## 6. 崩溃恢复与防重复

恢复覆盖以下窗口：预留后未启动、启动后未记 PID、会话已建立但未记 threadId、认领后未上报、report 已写但账本未更新、正在取消或等待收尾。

启动新进程前，查持久化意图、项目锁、进程/会话状态和条目 owner。可确定尚未执行且无副作用时重试；可确定仍在执行时接管观察或等待，不再启动；当前项已 report 时幂等核对；不确定时 needs_attention。孤立运行不得以“没有 ID”或“锁过期”自动重新派发。

短暂网络错误按退避（首期 5 秒、15 秒，可遵循服务端更长 Retry-After）最多重试配置次数；已产生副作用时先检查原 turn，不盲目重发。认证、额度和必需工具失败暂停执行器，避免不断领取队列。工作区不确定时暂停项目，后续无关任务也不能在同一脏状态上自动开始。

## 7. 日志与 UI 数据接口

设置、启停、取消、恢复入口绑定规范化项目与 runId，幂等处理重复点击。日志采用有界缓冲和文件背压，服务只保留当前摘要；接口用偏移或游标增量读取，历史分页。

完整日志文件保留在本机，不因 UI 摘要截短而丢失错误正文。磁盘写入失败应显示并暂停，不继续虚假记录成功；后续若引入日志保留策略，需显示范围且不得删除未完成运行证据。展示时进行 HTML 转义，敏感信息不通过配置回显或错误栈暴露。

普通 exec 的桌面侧栏不可见是已知本机行为。本期以看板展示为交付依据；桌面入口只有实际能力验证通过才启用，不依靠改写 sourceKinds、threadSource 或伪造客户端身份制造可见性。

## 8. 实施顺序

复用或先落地 Zcode 需求中的共用账本、互斥与依赖接口；完成假 CLI 的选单、进程与故障合同后接入真实 Codex。再完成面板、增量日志和 Electron 收尾，最后验证至少 3 项真实独立会话及一次取消/恢复。

候选改动涉及 scripts/server.mjs、scripts/lib/dispatch.mjs、共用调度模块、atb claim/report 的兼容关联、web UI 和 electron/service.mjs。实施前认领本需求；文档登记不授予源码实施状态。

## 9. 实施记录（2026-09-06，本会话落地）

### 9.1 模块与文件

| 模块 | 文件 | 职责 |
| ---- | ---- | ---- |
| RunStore | `scripts/lib/dispatch-store.mjs` | settings（codex 配置+共用计数器）、运行账本（runs/<runId>/run.json、events.jsonl、stderr.log、final-message.md、prompt.md）、增量日志（字节偏移）、impl.lock 封装 |
| CodexExecAdapter | `scripts/lib/codex-adapter.mjs` | 参数数组构造（`exec [--json -C 根 --output-last-message 文件 -]` / `exec resume <确切ID> …`，stdin 传提示词，禁 `--last`）、JSONL 行缓冲解析（跨 chunk/非 JSON/未知事件/无尾换行）、独立进程组 + `ps lstart` 启动时刻、取消（SIGINT 组中断→宽限→SIGKILL 组强杀）、超时、退出后同组残留工具回收、失败分类（auth/quota/network） |
| ExecutionVerifier | `scripts/lib/execution-verifier.mjs` | 完成证据核对：条目 in-progress、owner=单号（提示词约定）、agentCompletedAt/lastReport.at 晚于 startedAt、`--run` 关联（REQ-20260906-002 协议，缺失时按时间证据）、test-report.md 存在且非空；退出码 0 / turn.completed 单独不构成成功 |
| Scheduler | `scripts/lib/scheduler.mjs` | 选单（accepted、需求优先、创建早优先、依赖 done）、预留→持锁→后台执行→核对→收尾放锁→下一项；空队列仅本地轮询不调模型；续跑（默认追加 2 轮，仅用记录的 threadId）；网络退避重试（默认 [5s,15s]，仅会话 ID 已知时）；auth/quota/CLI 缺失/脏工作区暂停执行器；崩溃恢复（reserved/starting/running 窗口、PID+启动时刻核对、重启默认等待人工） |
| 服务接入 | `scripts/server.mjs` | `/api/dispatch/*`（settings/preflight/preflight/model/toggle/status/stop/resume-item/runs/log）、条目详情附 lastCodexRun、启动时对注册表项目做恢复核对、SIGTERM/SIGINT 优雅关停（停取单→取消受管执行→落账→退出） |
| Web UI | `scripts/web/app.js` + `style.css` | 共用「批量实施」抽屉内的 Codex 页（REQ-20260906-002 建壳）：开关、配置、静态预检与模型验证分层、当前执行（会话 ID/等待会话创建/停止中）、等待原因、执行记录分页、详情（摘要/执行日志/错误输出/最终回复/测试报告 + 增量加载）、恢复本项、桌面入口如实禁用 |
| Electron | `electron/service.mjs` + `main.mjs` | stopService 改为 SIGTERM→宽限→SIGKILL；壳退出先协调服务收尾再 quit；复用外部服务不 kill |

测试：`dispatch-store / codex-adapter / execution-verifier / scheduler / dispatch-api / codex-ui` 六个 `.test.mjs` + `fixtures/fake-codex.mjs`（假 CLI 行为矩阵，含守规 worker 真实调用 atb claim/report）。

### 9.2 与 REQ-20260906-002（Zcode 批量实施，另一会话并行开发）的收敛协调

两需求共用 `dispatch/` 规范，实施期间另一会话落地了 `scripts/lib/batch.mjs`。本会话按「共享源码串行协调」做了以下收敛（双方测试均绿）：

- **依赖策略**：policies.json 统一为其 `deps` schema；本模块 `saveItemPolicy/loadItemPolicy/depsSatisfied` 委托 `batch.mjs`（单一事实源），保留本层语义校验（existsIds/自依赖）。
- **项目实施互斥**：统一用 `.locks/impl.lock`（core.claim 侧 `assertNoImplConflict` 已检查）。本执行器 payload `{kind:'codex', owner:<单号>, runId, itemId, pid}`——owner 即 worker 认领名（单号），worker 的 `atb claim --by <单号>` 因此被互斥放行，其他手工/批次认领被拒。遵循「无超时自动接管」：恢复时仅当 kind=codex 且持有进程已死（PID 核对）才回收。
- **settings.json**：保留其 `counters`/`defaults` 共用字段，缺失补结构、绝不丢弃。
- **runs 目录**：双方 runId 格式不同（其计数器 `run-YYYYMMDD-NNN`，本执行器 `run-YYYYMMDD-HHMMSS-XXXX`），互不冲突；本模块扫描一律按 `executor==='codex-exec'` 过滤，其批次扫描按 batchId 过滤，双向隔离。
- **UI**：共用其批量实施抽屉（顶栏入口、Zcode/Codex 双页签），替换其为本需求预留的占位面板；其 `batch-ui.test.mjs` U5 占位断言已同步更新为已实施形态。

### 9.3 如实边界（不假称已保证）

- **桌面可见性**：普通 `codex exec` 会话不进桌面侧栏，本期 UI 明示「桌面入口未接通，请查看看板日志」，不提供假跳转。
- **逃逸进程组**：受管回收以「本次 spawn 的进程组」为归属边界；CLI 主动 detach 逃逸出组的工具进程无法按归属确认，不误杀也不假称零残留（README 范围与限制条款一致）。
- **共享 app-server/daemon**：exec 形态每轮 turn 在本进程内完成，无共享 daemon turn 归属；任何情况下不按进程名杀其他 Codex、不杀共享 app-server。
- **非 git 项目工作区核对**：无 `.git` 时无法判定脏状态，跳过探针（不静默 git init）。
- **真实链路验证（C22/C23）**：未消耗真实模型请求做 3 项连续执行与真实取消/恢复的全程见证，待用户在隔离项目人工触发；模型可达性验证按钮（真实最小 exec）已具备，由用户显式点击。

### 9.4 验证情况

- 单测/集成：六套新增测试全绿；与并行会话的三套 batch 测试、既有 electron-shell 等回归共存（全量 `npm test` 中仅 `detail-close-btn.test.mjs` T2 失败，属 REQ-20260906-005 会话在途工作与 002 批量抽屉头部的协调问题，非本需求改动引入）。
- 真机：看板服务已用新代码重启；浏览器实测 Codex 页（默认关、恢复提示、静态预检 6 项全绿——真实 CLI `codex-cli 0.153.1` 于 `/Applications/ChatGPT.app/Contents/Resources/codex`、分层标注正确）。

### 9.5 收尾阶段回归修复（停止后不自动重派）

浏览器验收后发现并修复一个竞态缺陷（回归测试 D16）：「停止当前执行」发出后，若 worker 尚未完成认领（条目仍 accepted），下一轮选单会为同一条目创建新 run；已排定的续跑定时器也可能复活本次 run。修复：

- 选单排除「最近一次运行为 interrupted」的条目——停止/关停中断过的项只能经人工「恢复本项」（确切会话 ID 续跑）或重新尝试接续；
- 续跑决策与定时器回调双重核对账本 `cancelRequested` 现值，停止请求一经持久化即不再续跑。

修复后独立复现脚本验证：停止后 runs 恒为 1、phase interrupted、attempts 仅 1 次、无残留进程；全量回归通过（除上述他会在途失败）。

### 9.6 Bug 修复：依赖全部阻塞误报「队列已空」（BUG-20260906-005，2026-09-06）

对抗验收探针 C-A2 发现：accepted 候选全部因依赖未满足被过滤时，`selectCandidate` 与真无候选同返回 `waiting.kind='empty'`，界面显示「队列已空」而无依赖原因。修复：

- `scheduler.mjs selectCandidate`：过滤管道重排（scope → 历史排除 → 依赖），收集仅因依赖未满足被排除的条目；无候选时优先级 `scope-empty` > `deps-blocked` > `empty`。`deps-blocked` 载荷 `{ count, items:[{id,title,unsatisfied}] }`（列表截前 3 项、每项前置截前 5 个，count 为真实总数）。语义等价性：三条件仍是 AND 过滤，cands 结果不变；scope 模式下保持 scope-empty 原语义。
- `web/app.js`：`cxWaitingText` 分派新函数 `cxDepBlockedText`——「依赖阻塞：N 项已接受条目因前置条目未完成暂不派发 —— <id 标题> ← 前置未完成：<前置 ID>。这与队列已空不同：前置条目完成人工验收后将自动继续派发」；动态值逐一经 `esc()`（置于 renderCxCurrent 之后定义，满足 U10 静态转义契约的检查范围约定）。
- 测试：scheduler D18（waiting=deps-blocked、unsatisfied 指向前置、阻塞期 spawnCount=0、前置 done 后自动派发原条目）；codex-ui U11（deps-blocked 文案契约、空队列文案不得混入依赖语义）。探针 C-A2 转绿；全量回归仅 detail-close-btn T2（他项在途，BUG-20260906-011~013/016~018）。

