# 设计 — REQ-20260914-001 自动提交不完整时挂起条目并暂停队列，人工确认后恢复开发

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

本次排查发现 14 个未完整提交条目，其中 13 单已补交、1 单按另一任务回退。详见 [排查记录](../../commit-recovery-20260914.md)。当前自动提交允许文档成功后继续后续条目，导致混合修改持续累积。

## 方案

需求阶段约束（尚未实施；具体接口与迁移方案在开发前补齐）：

1. 将「执行完成」「提交完整」「人工验收」分开判断。提交完整性是当前条目收尾和后续派发的前置条件。
2. 复用现有持久化挂起与人工确认基础设施，增加提交归属/完整性阻塞原因，守卫覆盖所有分析与开发入口；分析决策与提交核验分别记录阻塞类型。
3. 人工界面展示具体差异和补交计划，确认绑定内容指纹；后端核验并执行恢复，不允许单纯清除标志跳过验证。
4. 提交失败保留已有 hash 及待处理文件，恢复操作幂等；历史部分成功记录需要识别与迁移，不能默认为完整。
5. 沿用当前工作目录，不采用 worktree；不自动猜测归属，不引入额外合并步骤。
6. BUG-20260914-010 正在由 BUG-20260914-014 回退，新流程不得依赖其被撤下的提醒代码。

7. AI 分析使用同一挂起/恢复机制：持久化问题、背景、选项及影响、必答约束、答案草稿和确认版本，界面按阻塞类型展示分析表单。
8. 分析确认后将人工答案传回当前任务继续分析，不直接跳到下一条；未决问题清零且分析收尾成功才恢复队列。草稿保存不视为确认，失败重试保留有效答案，过期版本必须重新确认。
9. 分析确认不替代需求接受、开发授权或人工验收；推荐选项、生成文档和部分分析结果均不构成完成依据。

## 实施记录（开发阶段补齐）

- **账本与状态机**：新增 `scripts/lib/confirm-states.mjs`（自包含原语，`<dataDir>/confirms/confirms.json` + 条目目录 `confirmations.md` 人读留痕，`.gitignore` 排除；状态 waiting → resolved（开发闭环）/ confirmed → closed-done（分析闭环），新一轮声明归档历史轮次）与 `scripts/lib/confirm-store.mjs`（业务编排：声明/核验/保持挂起/作答/确认/历史恢复视图/测试运行）。
- **开发侧闭环**：`batch.finishRun` 在回执核验通过后判定 `commitIncompleteReason(autoCommit)`（failed / pendingManual / heldGroups / 无法确认完整的 skipped）→ 声明挂起记录 + `pauseRequested=true` 持久化暂停 + impl.lock 转 `attentionKind='confirm'`（不释放执行权；核验/补交/恢复入口不经实施锁，无死锁）。人工「确认并继续」＝指纹核验（脏→脏内容变=过期；脏→clean=识别终端补交）→ `gitFlow.supplementCommitForRun` 授权补交（`fix: 人工确认补交 <单号>`，幂等）→ 完整性 + `npm test` 复验（无测试脚本按声明范围跳过）→ resolved；服务端编排 `batch.resumeAfterConfirm` 解除暂停恢复派发。分组提交失败时 auto-commit 保留已成功 hash（C02）。
- **守卫**：`batch.nextItem`（先于 pauseRequested，notice 指明阻塞条目）/ `core.claim`（项目级挂起防呆，任何 owner）/ `createBatch`（attention 同口径）统一拒绝；恢复领取（显式）也不绕过 waiting 挂起，取消队列须终止任务。分析侧 `nextRefineItem` 先于 currentRun 判定 waiting 挂起。
- **分析侧闭环**：worker `atb refine hold <RUN-ID> --reason --question… [--background]` 声明（队列暂停；done 回执在有未决问题时被拒，C15）；人工作答/草稿 → 确认（必答齐备 + `questionsVersion`（轮次+声明时间+文档指纹）未过期，C19）→ `refine.resumeAfterAnalysisConfirm`（当前运行 interrupted + 条目重排队首 + retryItems + 解除暂停），下一次领取以 `continuation.questions` 回传答案（C18）；done 收尾时记录 closed-done。重新声明归档旧轮开新轮（旧确认自然过期）。
- **服务端与界面**：`/api/confirms`（清单含历史恢复视图）/ `/:id`（详情含逐文件状态）/ `/:id/diff` / `/:id/(answer|verify|keep|continue)`（人工专属，state-guard (2d)/(3c) 拦 Agent；`atb confirm list|show` 与 `atb refine hold` 放行）。任务页（AI 分析 / AI 开发抽屉）顶部「待人工确认」置顶卡片（标注 AI 分析/AI 开发 + 阻塞类型，部分提交显示「部分提交，开发未完成」）+ 统一侧拉确认面板（提交核验 / 分析表单按 blockType 分形态）+ 队列区暂停横幅 + 看板行徽标；核验中按钮禁用（「正在核验提交与测试…」），失败逐项列因可重试，成功显示补交 hash 且不自动验收 done。
- **历史恢复（C14）**：`legacyConfirmViews` 盘点 `dispatch/runs/*/auto-commit.json` 中 phase=reported 且待人工路径当前仍在工作区的旧账本，物化为只读「历史恢复」卡片走同一确认闭环；已补交的不呈现。
- **行为演进**：自动提交不完整（含暂扣/失败）不再允许队列继续（此前 D8/C1 口径），next/check 返回 stop·paused 并指向确认入口——存量用例预期已同步更新。
- **自研说明（REQ-20260909-015）**：无合适库——本需求是与看板自有账本（holds/refine/batch impl.lock/pauseRequested、git 归因快照）深度耦合的编排层（状态机 + 守卫 + 指纹绑定 + 授权补交），npm 生态无可直接复用的成品；未引入第三方依赖，无需 licenses.md。


**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界

- 人工确认过期、任务在其他会话修改、服务中断恢复时，以最新文件/提交证据重新核验。
- 队列暂停不得锁死当前单的补交与核验入口；禁止后续任务继续放大混合修改。
- 需求登记不等于实现完成，全部测试用例当前均待实施。
