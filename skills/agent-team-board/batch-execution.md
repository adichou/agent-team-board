# 批量任务详解：批量开发 / 批量完善 / hold 与确认闭环

> 本文是 agent-team-board 批量任务的机制详解（Zcode 与 Codex 双执行器通用）。
> 流程铁律与命令速查见同目录 [SKILL.md](SKILL.md)；worker 单项执行规范见
> [worker-spec.md](worker-spec.md)（批次创建时快照到项目 `agent-team-board/runtime/dispatch/worker-spec.md`）。
> 执行账本位于项目 `agent-team-board/runtime/dispatch/`（应用数据，本地留存不进 git）。

## 1. 两条执行路径

| 对比项 | Zcode 批量开发 | Codex 自动派发 |
| --- | --- | --- |
| 用户启动动作 | 任务模块「开发启动」选 zcode：创建批次并复制提示词，在 Zcode 新会话中发送 | 任务模块「开发启动」选 codex：开启当前项目的 Codex 自动派发 |
| 调度者 | Zcode 主会话（只派发与收短回执） | 看板后台服务（普通进程，无调度聊天上下文） |
| 执行单位 | 每项一个全新子 Agent（模型档位跟随主会话） | 每项一个新的 `codex exec --json` 会话 |
| 工作记录 | 条目文档 + 批次执行账本；子 Agent 返回短回执 | 条目文档 + 执行事件 + 日志 + 最终回复 |
| 接收后续新增 | 批次运行中新置计划的条目自动并入队列 | 自动派发开启期间继续接收新置计划条目 |
| 中断恢复 | 新调度会话读取批次摘要，核对后续接 | 服务重启先核对执行记录，再按会话 ID 恢复 |

## 2. 共同业务规则

1. 需求与 Bug 状态机：`submitted → accepted → planned → in-progress → done`。只有人能接受、置计划与确认完成；Agent 经 `atb claim` / `atb report` 认领与上报，不直接写条目状态文件（`runtime/status/<ID>.json`，直写被钩子拦截）。
2. 只从 `planned` 队列取新工作，创建时间最旧优先（Bug 与需求同序）。accepted 不自动派发，需人工「移入计划」。父子归属不自动等同执行依赖。
3. 每个项目同一时间只允许一个实施任务：Zcode 批次、Codex 派发与手工 `atb claim` 共用实施互斥锁（`runtime/.locks/impl.lock`）。
4. `report` 后即释放实施占用可派下一项；条目保持 `in-progress` 待人工验收，等待验收不占并发名额。
5. 测试报告必须区分已验证 / 未验证 / 阻塞项。进程退出、子 Agent 一句「完成」、一次 `turn.completed` 都不能单独证明需求完成。
6. 独立会话不等于独立代码副本：共享工作目录、串行执行，尊重现有改动，不自动清空工作区、切分支、丢弃改动或提交代码。失败遗留改动是否可继续必须明确判定；无法判断时挂起该项目。
7. 调度记录是执行账本，条目状态以看板为准。恢复时交叉核对，不依据一份旧回执自动重派、抢锁或伪造上报。

## 3. Zcode 批量开发流程

1. 看板接受本批条目并补清前置依赖（人工置计划）。
2. 任务模块「开发启动」选 zcode：批次创建冻结当前全部可实施候选（无上限；运行中新置计划条目领取时自动并入）。完整清单留 `runtime/dispatch/batches/<batchId>/batch.json`，提示词只含项目、批次标识、规范路径与短指令。
3. 在 Zcode 新建项目会话粘贴提示词。收到运行登记后批次才显示「执行中」；复制成功不算启动成功。
4. 主会话每轮只启动一个子 Agent：子 Agent 读 worker 规范后自行 `batch next` 领取一项，认领、实施、测试并上报，然后结束（不再派发子 Agent）。
5. 主会话收短回执（≤2 KiB），调用 `atb batch check` 最小核对，按 `continue / stop / needs_attention` 决定下一步；不读完整队列、源码、测试日志或整份报告。
6. 批次范围处理完或全部受阻即停止，不空轮询。「暂停后续」只阻止领取下一项；已在运行的子 Agent 在 Zcode 原生界面停止。

主会话上下文约束：选单交给子 Agent；详细规范走 worker-spec 路径引用；每项只回最终回执，长错误与测试输出落盘 `runtime/dispatch/runs/<runId>/`；调度摘要只含当前项、计数、下一步与报告引用。

## 4. Codex 自动派发流程

1. 「批量开发 → Codex 自动派发」先完成运行环境检查（CLI、模型配置、登录、项目读写与所需工具）。默认关闭，不因置计划擅自启动。
2. 用户「开发启动」（codex）后，服务串行从已计划队列取单（最旧优先），用 CLI 路径 + 参数数组 + 明确工作目录启动 `codex exec --json`；不经 `open` / Terminal / AppleScript / `.command`。
3. 不同条目各自新会话；同一条目多轮或故障恢复只用已记录的会话 ID，不用 `resume --last`，不 fork 继承上一项历史。
4. 服务持续保存事件与错误日志；看板展示当前条目、阶段、报告、最终回复与失败原因。没有日志不能推断进程已死或任务已完成。
5. 满足完成证据、`report` 关联与进程收尾条件后才释放占用并派下一项。
6. 关闭「自动派发」只停止领取新任务；「停止当前执行」显式取消当前项（先显示停止中，确认后已中断）。

收尾纪律：正常结束、取消、超时、启动失败与服务关闭都有明确收尾分支；只终止本调度器确认归其所有的进程，不按程序名误杀用户会话；先请求中断再强制回收（校验 PID 归属防复用）；收尾未确认时保留项目占用提示人工。执行结果一律在 Status Board 查看（事件、最终回复、报告、错误原因）。

## 5. 共用执行协议

### 存储与标识

执行账本在 `agent-team-board/runtime/dispatch/`：`settings.json`、`policies.json`、`batches/<batchId>/`、`runs/<runId>/`（应用数据，不进版本控制）。批次、执行尝试、条目分别使用 `batchId`、`runId`、REQ/BUG 编号，三者不混用。

执行占用使用原子获取的项目锁与条目认领锁（`runtime/.locks/`）。执行记录至少含：项目真实路径、执行器、条目编号、owner、尝试次数、批次、时间、会话 ID、运行阶段、取消请求、报告引用与恢复原因；Codex 另存进程归属信息。条目文档（`data/` 下 README/design/test-cases/test-report）继续作为可审阅用户数据随 git 提交。

所有执行账本由受控 CLI / 服务函数维护，Agent 不手写 JSON；保存采用原子替换或追加日志，恢复后按序核对。

### 依赖与互斥

依赖规则存 `runtime/dispatch/policies.json`（`dependsOn: [条目编号]`，默认要求已 done）。详情页「批量执行设置」提供依赖选择，保存时校验存在性 / 自依赖 / 环；未配置时不从父子归属推断依赖。人工文档存在未结构化依赖时 worker 上报阻塞，不自行忽略。

一个项目只运行一个调度模式（Zcode 批次或 Codex 派发），冲突显示持有者与当前项，不静默抢占。手工实施同样过 `atb claim` 互斥检查；已有 `in-progress` 且无有效上报的未知执行先核对再放行。

### 状态与回执

运行阶段：`reserved`、`starting`、`running`、`reported`、`blocked`、`failed`、`interrupted`、`cleanup_pending` —— 属执行账本，不写入条目 status。空队列是调度结果，不创建虚假条目或成功执行。

回执（`atb run receipt`）与主会话核对响应各限 UTF-8 ≤2 KiB；错误正文落盘后引用，不截断出畸形 JSON。核对响应只含当前执行、计数、异常引用与 `nextAction: continue|stop|needs_attention`。每项只产生一份最终回执与一次最小核对。

`reported` 必须关联本次 `runId`、owner、条目、报告文件与上报时间，排除旧报告重放；核对摘要不能替代真实测试或人工验收。

### 失败与重试

未认领前的冲突可换单（`atb run release`）；环境级错误暂停项目或执行器，不整批领取后逐一标失败。可恢复故障默认自动重试 2 次（退避并记录尝试），重试前核对原进程、条目 owner 与工作区改动。实施失败或信息不足不无条件重跑；转人工后可继续其他不受影响条目。不能仅凭锁超时自动切换 owner 或把另一会话的工作当成本次成功。

### 待人工决策承接（hold）

blocked 回执适用于「依赖 / 信息缺失，可继续其他项」；「必须人工决策才能继续」走 **声明 → 持久呈现 → 人工决策 → 复工** 闭环：

- **声明**：worker `atb hold declare <ID> (--question 决策问题)… [--reason 短句] [--run RUN-ID]` 附问题清单，随后仍交 blocked 回执。声明落 `runtime/holds/`（执行账本），条目保持 in-progress。
- **呈现**：Status Board「⚠ 待人工确认（N）」持久聚合区（不随批次结束消失）；CLI `atb hold list` / `atb hold show`。
- **决策**：人工在聚合区补决策或终端 `atb hold answer`；作答留痕写 `runtime/holds/decisions/<ID>.md`（BUG-20260918-003 起属应用数据，不进 git）。作答为人工专属，Agent 调用被守卫拦截。
- **复工**：决策齐备后人工 `atb hold resume <ID>` —— 条目经专用通路 in-progress → planned（清 owner、释放锁、history 留痕），回到已计划队列重新取单。
- **防呆**：待决期间 `atb claim` 一律拒绝（含原 owner）；确认完成遇未答项默认拦截，人工显式越过（`--force` / 网页二次确认）留痕闭环。
- **作废与多轮**：`atb hold cancel` 作废当前声明（条目状态不变）；复工 / 作废后再声明开新一轮，旧轮归档于 runtime 决策留痕。

### 挂起确认承接（confirm）

自动提交不完整（分组失败 / 待人工路径）时项目级挂起：账本 `runtime/confirms/`，确认留痕 `runtime/confirms/confirmations/<ID>.md`（BUG-20260918-003 起属应用数据，不进 git）；Status Board 任务页「待人工确认」核对差异后「确认并继续」（核验 + 补交 + 测试通过后自动恢复队列）。核验 / 作答 / 确认并继续为人工专属；`atb confirm list|show` 只读呈现。

## 6. Zcode 调度提示词模板

批次创建时由系统生成（`atb batch create` 输出），要点：

```text
你是当前项目的批次调度员，只负责派发与接收短回执。
每轮新启动一个子 Agent（模型与推理档位跟随主会话），按执行规范
自行选择本批一个可实施条目，认领、实施、测试并上报；每个子代理
只做一项，不再派发子代理。主会话只接收短回执并调用最小核对入口，
nextAction=continue 启动下一个，stop 结束，needs_attention 等待人工。
不重复读取全队列与完整报告，收尾只给批次计数与异常入口；
不得代替人工接受需求或确认完成。
```
