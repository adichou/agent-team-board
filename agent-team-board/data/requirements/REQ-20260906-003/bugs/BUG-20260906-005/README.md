# BUG-20260906-005 Codex 依赖全部阻塞时错误显示队列已空

- 状态：in-progress（已修复，待人工确认完成）
- 归属需求：REQ-20260906-003
- 创建：2026-09-06T06:40:04.101Z

## 现象

独立验收复测（2026-09-06），优先级 P2，探针 C-A2。

已有 accepted 候选但依赖未满足，调度器 waiting.kind=empty，界面显示队列已空而没有依赖原因。

## 复现步骤

隔离项目建立 accepted 条目并让它依赖 submitted 前置条目；启用假 CLI 调度器后查看 status。

## 期望行为

显示依赖阻塞及需完成的前置条目，和空队列明确区分。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/lib/scheduler.mjs:selectCandidate；scripts/web/app.js:CX_WAITING_LABEL

## 修复记录（2026-09-06）

- 根因：`selectCandidate` 把「依赖未满足被过滤」与「无任何 accepted 候选」同归为 `waiting.kind='empty'`，UI 的 `CX_WAITING_LABEL.empty` 文案为「队列已空：等待已接受条目」，依赖阻塞被误报为空队列。
- 修复：`selectCandidate` 过滤时收集仅因依赖未满足被排除的已接受条目，无候选时优先返回 `{ kind:'deps-blocked', count, items:[{id,title,unsatisfied}] }`（列表截前 3 项、每项前置截前 5 个防载荷膨胀，count 保留真实总数）；scope 勾选模式下仍保持 `scope-empty` 语义；`app.js` 新增 `cxDepBlockedText`，显示「依赖阻塞：N 项已接受条目因前置条目未完成暂不派发 —— <条目> ← 前置未完成：<前置 ID>，这与队列已空不同：前置条目完成人工验收后将自动继续派发」，动态值逐一经 `esc()` 转义。
- 验证：新增 scheduler D18（依赖阻塞 waiting=deps-blocked 而非 empty、指出前置、阻塞期间不调模型、前置 done 后自动派发原条目）与 codex-ui U11（文案契约 + 空队列文案不得混入依赖语义）；对抗探针 C-A2 转绿；全量 `npm test` 仅 detail-close-btn T2 失败（既有在途，见 BUG-20260906-011~013/016~018，与本修复无关）。

## 关联（引入来源）

- 引入来源：REQ-20260906-003（Scheduler `selectCandidate` 首版实现把依赖未满足的候选静默过滤后与真正无候选统一返回 `empty`，未区分依赖阻塞与空队列；`CX_WAITING_LABEL` 也只有 `empty` 一种「无候选」文案）
