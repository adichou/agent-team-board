# 设计 — REQ-20260906-024 Codex 派发模型配置：项目默认、单项覆盖、续跑固定与异常提示

状态：已实施（待人工验收）。业务与 UI 约定见 [README](README.md)，验收用例见 [test-cases](test-cases.md)。

## 实施记录（2026-09-07）

按上文设计落地，代码分布与关键取舍：

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 纯规则 | `scripts/lib/codex-model-config.mjs`（新增） | 形态校验（长度/控制字符/选项注入）、`normalizeModelSelection`、TOML 子集提取器（只提取 model/model_reasoning_effort/model_provider/profile，解析不了的行不猜）、多层继承解析（用户 config.toml → profile 表/文件 → 项目 .codex/config.toml，来源如实标注）、`effectiveSelection`（本项 explicit > 项目 explicit > inherit）、目录校验（已知模型不支持强度 → 拒绝；未知 → 允许但标 unverified）、快照构造（非敏感字段 + 配置指纹 sha256 前 16 位 + 解析时间 + CLI 版本）、模型失败分类（model-missing/model-denied/effort-unsupported） |
| 只读能力 | 同上 `loadModelCatalog` | `codex debug models`（已在本机 codex-cli 0.153.4 验证为只读 JSON 目录能力）；30s TTL 缓存；失败如实返回原因 |
| 执行器 | `scripts/lib/codex-adapter.mjs` | `buildExecArgs` 增有类型 `model`/`reasoningEffort`（成对校验，缺一即全部不传并抛错；`--model <id>` + `-c model_reasoning_effort="<e>"` TOML 编码）；`classifyFailure` 挂接模型分类（泛化 HTTP 400/404/429 仍归 unknown） |
| 存储 | `scripts/lib/dispatch-store.mjs` | settings.codex.modelSelection（归一化校验）与 lastVerification（非敏感白名单字段）；条目策略 `loadItemModelSelection/saveItemModelSelection`（经 batch.saveItemPolicyFields 合并写 policies.json，保留 dependsOn 等字段；setDependencies 反向亦保留模型字段）；run.modelSnapshot/modelConfirmed/supersedes；`dispatch/pending.json` 待处理账本（addModelPending 同条目+同分类+同指纹合并去重；resolveModelPending 仅在上报成功后调用） |
| 调度 | `scripts/lib/scheduler.mjs` | `resolveModelForItem`（导出；启动前解析；失败 kind=config-unresolved）；startRunForItem 先解析再预留（失败不创建运行不认领，暂停执行器 + 登记待处理）；spawnAttempt 一律取 run.modelSnapshot（new/resume/retry 不重解析）；settleAttempt 模型类失败 → failed + 待处理 + 暂停（不降级不连带队列）；resumeItem 要求快照存在（M15）且提供方身份未变（M05）；`retryItemWithConfig`（终态执行换配置重试：保存本项策略 → 新解析 → 新 run + supersedes 链；过期 runId/重复点击被 hub/互斥/latest 核对拦截）；onEvent 捕获运行时 model 回显（M17：不一致 → 待处理 + 暂停）；reported 收尾自动 resolve 待处理 |
| 服务 | `scripts/server.mjs` | `POST /api/dispatch/preflight/model` 携带 modelSelection 走同一解析/参数构造（M07），结果绑定模型/强度/指纹持久化到 lastVerification；`GET /api/dispatch/codex/models`（?refresh=1 绕缓存）；`GET /api/dispatch/codex/model-inherit`（层与来源展示）；`GET /api/dispatch/pending`；`POST /api/dispatch/codex/retry-item`；`/api/item/:id/policy` 增读/写 modelSelection（与依赖互不清空）；条目详情带 lastCodexRun.model 与 modelPending 标记 |
| Web | `scripts/web/app.js`、`index.html`、`style.css` | Codex 面板「模型与推理强度」区块（配置方式/继承只读展示+刷新/可搜索 datalist 模型输入/强度档位提示与不兼容清空提示/验证过期标注）；顶栏 `#cxPendingBadge` 待处理计数（点击进 Codex 页）；卡片「模型配置待处理」标记；面板待处理区；执行详情模型快照/运行时确认值/supersedes/「历史记录未记录」+「以新配置重试本项」表单（旁列目标参数、双击禁用）；条目设置内「Codex 模型」折叠区 |

数据形态：

- `settings.codex.modelSelection`：`{mode:'inherit'}` 或 `{mode:'explicit', modelId, reasoningEffort}`（缺省继承；旧项目无字段即继承）。
- `run.modelSnapshot`：`{mode, modelId, reasoningEffort, provider, source, sources, cliVersion, configFingerprint, resolvedAt, catalog:{known,effortSupported,defaultEffort}, verification:'unverified'}`；不含任何密钥类字段。
- `policies.json` 条目：`{dependsOn?, modelSelection?}` 两字段互保留。
- `dispatch/pending.json`：`{requestId, itemId, runId|null, kind, summary, logRef, configFingerprint, status, createdAt/updatedAt/resolvedAt}`。

与设计的偏差说明：

- 提供方标识取自配置层 `model_provider` 键（缺省不猜，快照 provider=null 时跳过恢复核对），未再单独请求 doctor。
- 目录能力采用 `codex debug models`（设计允许的只读能力），不再依赖 `codex doctor --json`（其 config.load 仅证明可解析，不吐有效模型值）。
- M18（隔离项目真实模型请求证据）未在本次实施中执行：真实验证按约定仅由用户明确点击触发，避免替用户消耗模型请求；按钮/接口/记录链路已就绪并经假 CLI 验证。


## 1. 复用边界

扩展现有 dispatch-store、scheduler、codex-adapter、codex-preflight、server 的 dispatch 接口和 Web Codex 面板。配置解析抽为纯规则与只读能力读取两部分；调度器不承担模型智能路由。

实施前核对 REQ-20260906-003 及其后续修复的最新代码。已有 extraArgs 只是底层扩展点，HTTP 不接收任意 CLI 参数；提供有类型的模型与推理强度字段。

## 2. 设置与配置快照

建议字段（具体命名与既有 schema 对齐）：

| 存储 | 字段与语义 |
| --- | --- |
| 项目 settings.codex.modelSelection | mode 为 inherit/explicit；explicit 包含 modelId 与 reasoningEffort |
| 条目执行策略 | 同构 modelSelection；缺省为 inherit，复用共用策略存储且保留 dependsOn 等其他字段 |
| run.modelSnapshot | 解析后的 modelId、reasoningEffort、提供方标识、来源、解析时间、CLI 版本、配置版本/指纹；不得包含密钥 |
| run 的尝试记录 | 快照引用、threadId、尝试序号；主动变更时保存前一 runId 和变更原因 |
| 待处理记录 | requestId、项目、itemId、可空 runId、原因分类、摘要、日志引用、配置版本和处理状态 |

优先级：已存在的运行快照用于原执行；新执行按本项 explicit > 项目 explicit > 本机有效配置解析。本项指定时必须得到完整且合法的模型/强度组合；不得直接继承另一个模型的不兼容强度。

继承解析必须基于启动时实际 CLI、cwd、CODEX_HOME、适用 profile/项目/受管理配置。优先使用版本已验证的只读配置解析能力；模型与强度缺省值须来自可验证的实际能力。不能自行正则拼接 TOML 或将全局配置简单等同有效配置。无法解析时返回可诊断错误，由用户显式选择后继续。

本机有效配置的解析不等于账户可用性验证。列表应保留来源及时间；指定模型不在已加载列表中时允许提交待验证 ID，真实验证失败则阻止相关执行。强度未知时也不能冒充兼容检查通过。

快照只保存所需非敏感字段，不复制本机 config.toml 或 auth 文件。沿用本机认证；若提供方身份变化使旧模型语义不再一致，原配置恢复应暂停核对，不能悄然改用另一个提供方。

## 3. 启动、验证与恢复

1. 在原子预留与实施互斥规则内读取最新条目/项目设置，解析并落盘快照，核对配置版本后启动；失败不得把预留当成已认领成功。
2. adapter 根据有类型字段生成参数数组：--model 指定模型，-c 指定 model_reasoning_effort；exec 与 exec resume 均通过本机 help/能力检查验证。提示词仍走 stdin，不开放 shell 拼接。
3. 对模型 ID 做长度、控制字符和选项注入校验；强度按当前模型能力校验。TOML 值使用正确编码；明确传入模型和强度，避免只覆盖其一改变其他模型默认值。
4. 自动续跑、网络重试和重启后的原项恢复都从 run 快照取参数。模型是否可用由实际错误反馈与预检判断；不会用自动切换模型处理错误。
5. 配置可达验证与正式运行使用同一解析/参数构造逻辑。请求携带配置指纹，响应仅适用于该配置；配置、CLI、提供方或继承源变化后旧结果标记过期。仅明确的验证按钮触发最小模型请求，不能触发 claim 或实际实施。
6. 用户主动变更模型时，先确认旧执行及工具已停止、owner/工作区符合恢复条件，再创建关联的新 run 和快照。同项有有效会话时用确切 ID；确需新上下文时按既有新尝试流程记录。原运行与验证证据不覆写。
7. 旧运行缺快照时不猜测历史模型。展示缺失原因，让用户为后续恢复建立一次新的明确配置记录；原历史字段保留缺失。

快照记载的是请求配置。若运行时能返回实际模型标识，单独保存作核对；运行时未返回时显示“按记录配置请求，实际模型未返回”，不能把推断包装成服务端确认。请求与返回不一致时记录异常并暂停后续派发。

## 4. 错误、暂停与提示

错误分类优先使用实际结构化信息，无法获得时再结合受控日志诊断。至少区分配置未解析、模型不存在/不可用、无模型权限、强度不兼容、认证、额度与暂时网络问题。证据不足时显示原始诊断引用及“原因待核对”，不能将所有 400/404/429 统一归为模型问题。

确定的模型/配置问题暂停当前项目的 Codex 取单；共用账户认证、额度或 CLI 故障沿用执行器的既有环境暂停范围。待处理记录与进程状态分开：收到错误即可提示，但实际停止/收尾确认前不能启用恢复或释放实施锁。原执行结束后的等待不额外占用模型请求。

待处理请求绑定项目、条目、runId（启动前可空）、配置版本和唯一 requestId。关闭抽屉只关闭展示；修复并执行成功的恢复操作才更新处理状态。重复、过期的恢复请求不得启动新任务；服务重启恢复未处理记录。多个相同错误可合并显示，保留对应运行入口。

设置保存、模型验证、恢复启动各为独立操作。以新配置重试按钮旁明确列出目标和参数，用户操作即可提交，服务端仍验证版本及互斥；禁用双击期间按钮并提供启动/失败反馈。空闲队列或待处理状态不产生自动验证循环。

## 5. UI 与兼容迁移

沿用现有 Codex 抽屉、条目执行设置和运行详情组件；顶栏新增轻量的当前项目待处理计数入口，与批量实施入口调整兼容。提示及字段详见 README，不新增命令行窗口。

settings/条目策略/运行 schema 向后兼容：缺项目配置视为 inherit；新增字段的保存保留共用计数器、依赖、Zcode 数据及未知兼容字段。执行账本状态不写入条目 status.json。

模型能力发现即便采用只读 App Server 接口，也只作为辅助探测；执行仍由 exec adapter 完成。通用用户问答、原生实时审批和系统通知不作为本期验收条件。

## 6. 验证与参考

先为配置优先级和快照稳定性建立行为测试，再接参数构造、假 CLI 错误与恢复集成测试，最后验证 UI 和隔离项目真实模型请求。真实验证必须覆盖所选择的模型/强度，不以现有账户的单次默认模型成功替代所有组合支持。

- [Codex 配置优先级与推理强度](https://learn.chatgpt.com/docs/config-file/config-basic)：CLI 显式覆盖、项目与用户配置层。
- [Codex 非交互执行](https://learn.chatgpt.com/docs/non-interactive-mode)：exec 事件与确切会话 ID 恢复。
- CLI 参数及能力以实施环境实际版本为准，不硬编码本次讨论时本机的模型名称。
