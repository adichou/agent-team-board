# 设计 — REQ-20260906-002 Zcode 批量实施：轻量主调度、每单新子 Agent 与文件化回执

状态：设计稿，尚未实施。业务与界面以 [README](README.md) 为准，公共约束见 [共用协议](../../batch-execution.md#5-共用执行协议拟新增)。

## 1. 架构和责任

`看板创建批次 → 用户发送主调度提示词 → 新 worker 自选一项并实施 → 短回执 → helper 核对 → 主调度继续或停止`。

主调度不加载实施细节；worker 读取项目指令、atb skill、本条 README/design/test-cases，执行单项 TDD。不得把原 `/dev loop` 作为 worker 的入口。选单、去重、依赖、锁、计数与回执验证使用确定性代码，避免由主模型读取整批历史推断。

worker 默认使用 Zcode 内置 general-purpose；可增加受支持的专用角色 `atb-single-item` 固定说明，但须检查安装版本与角色加载是否生效。可用外置规范路径作为兼容入口，不把自定义角色配置误当作已加载。子 Agent 保留必要 AGENTS.md 和 skill 规则，不要求其嵌套派发其他子 Agent。

## 2. 拟新增接口

以下均为实现契约示意，当前 CLI 尚无这些子命令。正式命名落地后同步帮助、模板和测试。

| 入口 | 调用者 | 行为 |
| --- | --- | --- |
| batch create | 看板 | 创建有限候选快照、配置上限、返回批次标识及短启动提示词；重试请求幂等 |
| batch next | worker | 核对暂停标记、候选和依赖，原子预留一项；仅向 worker 返回单项规范与路径 |
| batch check | 主调度 | 校验回执与账本、上报证据，返回当前项、计数及 nextAction，最多 2 KiB |
| batch pause | 看板 | 设置停止后续领取的标记，不伪称已杀死原生工具 |
| batch resume-summary | 看板/新主调度 | 输出当前执行和恢复限制；不隐式重派失联项 |
| run finish/block | worker | 原子写入结果、简短原因、详细记录引用；不修改业务状态为 blocked |
| report 的运行关联 | worker | 由现有受控上报逻辑关联 runId、owner 与本次报告，保留旧调用兼容性 |

HTTP 接口绑定规范化 project，复用现有本地服务；返回错误时不得把其他项目的账本或提示词混入当前面板。

## 3. 数据、幂等与状态

`dispatch/batches/<batchId>/batch.json` 保存候选 ID 快照、上限、模式、创建时刻、当前 runId、暂停请求和计数；`dispatch/runs/<runId>/run.json` 保存执行账本，`receipt.json` 保存最终回执。实现时明确临时文件清理与局部忽略规则，所有 JSON 经 CLI/服务函数维护。

批次阶段为 `prepared/running/paused/needs_attention/finished`。这些不改变条目状态机。新批次不能吸收未来 accepted 条目；上限只限制候选数，不承诺上下文恒定。依赖未满足的候选记为受阻，worker 优先执行本快照中的可实施项；全无可实施候选时返回 stop 和计数，不重复派空 worker。

runId 是一次执行尝试，不冒充原生子会话 ID。运行时能提供 childSessionId/toolCallId 时记录其实际值；不能获取时置空，以工具调用记录、独立 runId 和回执核验逐项调用，禁止编造会话 ID。

项目互斥锁覆盖“预留 → 认领 → 实施 → 收尾核对”。条目仍通过 `atb claim` 转为 in-progress，预留后在锁内复查状态，避免选单与认领之间的竞态。预留成功但尚未认领即启动失败时，可在确认无执行后释放预留；认领后的失败保持业务 in-progress。

扩展 `atb claim` 的项目互斥检查以覆盖手工入口；不能仅给自动调度器加锁。已有未知在办执行默认阻塞，提示核对。报告后业务仍待验收，但不再占据实施锁。

重复创建请求返回同一批次；同一 runId 的回执处理幂等，计数仅增加一次。恢复保持原 owner，不以锁超时或更换主会话为理由强制接管；需要 owner 交接时使用专门、可审计的人工恢复路径，不能手改 status.json。

## 4. 上下文载荷合同

- 主提示词只含项目真实绝对路径、batchId、规范引用和控制规则；不嵌入整个 skill、全部候选或历史日志。
- worker 初始输入只携带当前批次入口，不主动复制主会话历史；系统实际如何注入父上下文需在真实 Zcode 验证中记录。
- worker 最终只回传 version/batchId/runId/itemId/result/reportRef；异常增加短 reason 和 safeToContinue。缺字段、越界大小、错误编码或未知状态都不能被当成功。
- 回执和 batch check 响应分别不超过 2 KiB，完整数据以受控引用查询；不得截断 JSON 本体。长路径可映射 reportRef，再由服务校验解析到当前项目内。
- 主调度只在 worker 返回后核对一次。需要进度时由看板读取账本；正常聊天不轮询任务、读取完整报告或输出阶段性大总结。
- 插件控制的输入输出计量可稳定复现；原生系统提示、模型内部压缩等不能靠输出字节数推断精确 token。测量和记录事实，不声明未经测量的节省率。

## 5. 失败、暂停和续接

普通冲突：worker 换选同批另一条。文档依赖不明：记录阻塞，跳过该项；环境错误：停止批次，保留未领条目。代码失败：保存改动和报告草稿，未确认安全前不继续下一项。

暂停后续仅设置控制标记；worker 在领取前、认领前及完成后检查。正在执行的工具需用户通过 Zcode 原生停止。没有可靠停止证据时显示 needs_attention，不释放实施占用；不要通过强杀整个 Zcode 来实现取消。

主会话退出后，新主会话读取摘要；核对当前项是否已有新 report、原子 Agent 是否仍运行、项目占用与工作区是否一致。当前项已上报则去重收尾；仍在运行则等待；状态未知则请求人工核对。更换上下文不会自动重置已处理清单。

## 6. 影响面与实施顺序

候选模块：scripts/lib 下新增共用批次/执行账本 helper；scripts/atb.mjs 和 server.mjs 增加受控入口；web/app.js/style.css 增加面板与依赖设置；commands/skills 增加轻量入口和 worker 规范；现有 core claim/report 增加兼容的执行关联。

先实现纯数据与锁合同，跑单测红绿；再接假 worker 端到端；再接界面；最后验证真实 Zcode 三项批次。共用模块只实现一次，供 Codex 需求复用。实现前须 claim 本需求，不以编写此设计稿代替认领。

## 7. 实施记录（2026-09-06，zcode-batch-dispatch）

### 7.1 落地清单

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 共用核心 | `scripts/lib/batch.mjs`（新增，约 600 行） | 批次/运行账本（`dispatch/batches|runs/`）、候选选单（req→bug、创建时间、编号）、依赖策略与环校验、回执协议（≤2KiB、幂等、证据核对）、批次 check（≤2KiB）、暂停/摘要/记录分页、`generatePrompt`（§6 模板填充）、`ensureDispatch`（含 worker-spec 快照与 .gitignore 局部忽略） |
| 状态机扩展 | `scripts/lib/core.mjs` | `claim` 增加项目实施互斥检查（`.locks/impl.lock`，锁属主本人放行）；`report` 增加运行关联（`lastReport.runId`，旧调用兼容 null）；导出 `acquireLock/releaseLock/readImplLockIfExists` 供 batch 复用 |
| CLI | `scripts/atb.mjs` | `batch create/next/check/summary/pause/records`、`run receipt/release`；`report --run --by`。`--json` 输出纯 JSON（载荷可测）；summary 视图不含 candidates 全队列 |
| worker 规范 | `skills/agent-team-board/worker-spec.md` → 创建批次时快照到 `<dataDir>/dispatch/worker-spec.md` | 单项流程（next→claim→TDD→report --run→receipt→回执一行 JSON）、约束与收尾路径 |
| 服务 | `scripts/server.mjs` | `/api/batch/create|prompt|current|pause|records`、`/api/item/:id/policy`（GET/POST，校验错误 400 带 errors），全部绑定 `?project=` |
| 前端 | `scripts/web/index.html` `app.js` `style.css` | 顶栏「⚡ 批量实施」（top-actions flex-wrap）；批次抽屉（≤720px、窄屏铺满、Zcode/Codex 模式页签、创建表单/提示词块/重新复制/续接提示词/暂停/记录分页/待核对提示）；条目详情折叠「批量执行设置」（依赖多选+搜索+就地校验反馈+最近执行）；随 2s 主轮询签名刷新 |
| 文档 | SKILL.md CLI 速查、本条 test-cases.md 结果 | — |

### 7.2 关键实现决策

1. **实施互斥锁**：`.locks/impl.lock` 在「预留→认领→实施→回执收尾」全程持有（跨进程 O_EXCL 文件锁，无超时自动接管——异常一律 needs_attention 走人工核对）。`core.claim` 对所有入口（手工/batch worker）做同锁检查：持锁他人被拒、锁属主本人放行。别名路径因落到同一物理锁文件不能绕过（Z04b 已测）。
2. **幂等与防重放**：同批次重复 create 返回同一批次（剩余项>0 或在途才算未结束）；同 runId 相同回执幂等、不同回执拒绝；`reported` 证据核对要求 in-progress + owner 一致 + `lastReport.runId === runId` + report 时间 ≥ run 创建时间 + reportRef 在条目目录内存在（Z10 四类伪造全拒）。
3. **停止语义**：`failed+safeToContinue=false`（环境错误）与「在途 run 未收尾」都使 nextAction=needs_attention 且 next 拒绝领取；仅余依赖受阻项返回 stop=blocked 不派空 worker；暂停只挡领取、不碰在途。
4. **载荷合同**：`batch next` 只返回单项规范（无队列）；`check` 响应构造上 ≤2KiB 并有运行时断言；reason ≤200 字（超长拒绝、正文落盘）；`atb batch summary` 输出经 `batchPublicView` 剥离 candidates。
5. **UI 层级**：批量抽屉与其遮罩 z=19/20 且 DOM 置于条目抽屉之前——同 z 下后画者在上，条目详情可叠开在批量抽屉之上（浏览器实测发现并修复了初版 z=18 被遮罩挡住点击的 bug）。

### 7.3 与 REQ-20260906-003 的并行协调（重要）

本需求实施期间，REQ-20260906-003（Codex 自动派发）被另一会话并行认领并落地了 `codex-adapter/dispatch-store/execution-verifier/scheduler` 四个模块及其 Codex 面板 UI。协调结果：

- **policies.json 结构冲突已由本侧对齐**：对方为 `{items:{id:{dependsOn}}}`、本侧初版为 `{deps:...}`，会互相清空。已将 batch.mjs 读写统一到 `items` 结构（读取兼容旧 deps），两边测试套件同时绿。
- **settings.json**：两侧均为读-改-写全量 JSON，保留未知键，计数器与 codex 配置共存（已核对对方 saveSettings 展开语义）。
- **runId 不撞名**：本侧 `run-YYYYMMDD-NNN`（计数器），对方 `run-YYYYMMDD-HHMMSS-hex`；`batchRuns()` 按 batchId 过滤，账本互不串读。
- **遗留差异（留给后续统一）**：对方调度器未接入本侧 impl.lock（其并发用进程内 hub）；对方未消费 `core.claim` 的互斥检查语义外的部分。若后续要求「Codex runner 与 Zcode 批次/手工共用同一把项目实施互斥」，需在 REQ-20260906-003 侧接入 `readImplLockIfExists`/impl.lock（属其认领范围，本侧未越界修改）。

### 7.4 未验证项（如实）

- **Z17 载荷基线对比 / Z18 真实 Zcode 三项批次 / Z19 父上下文注入边界**：需要用户在 Zcode 本项目新建主调度会话、逐项派发真实子 Agent 才能见证；自动化测试以假 worker 覆盖协议与账本，不能替代。
- **360px 截图**：IAB 截图捕获在视口调整后持续故障，以几何校验（抽屉宽=视口宽、顶栏换行无遮挡）替代；541px 档有成功截图。
- 回归基线：33 个测试文件仅 `detail-close-btn.test.mjs` T2 失败——该测试先于本需求存在且属 REQ-20260906-005（已接受未认领）的预置用例，非本需求引入。
