# 测试用例 — REQ-20260831-001 /dev 先出实现方案并置「待对齐」，人工对齐后再实施

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> P1–P8 由 `scripts/tests/pending-alignment.test.mjs` 覆盖（core 直调 + 真实起 server + 子进程钩子实测）；P9 回归。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| P1 | 状态机：`pending-alignment` 入 STATES；边 accepted→pending-alignment、pending-alignment→in-progress 存在；accepted→in-progress 直达边已移除 | P0 | ✓ |
| P2 | claim 新语义：accepted → pending-alignment（owner+锁+history）；同 owner 幂等（含锁幂等）；异 owner 冲突 | P0 | ✓ |
| P3 | 流转：pending-alignment → in-progress 可达且历史可溯；submitted→in-progress 等仍拒绝 | P0 | ✓ |
| P4 | server 人工边：POST status pending-alignment→in-progress 200；accepted→in-progress 403 | P0 | ✓ |
| P5 | 钩子：bash 模式拦截 `atb status <ID> in-progress`（以及 accepted/done）与 curl 同目标；claim/report 放行 | P0 | ✓ |
| P6 | 前端静态：app.js 五列 STATE_LABEL 含「待对齐」与「对齐确认」按钮；style.css 新列色（紫） | P1 | ✓ |
| P7 | 旧数据兼容：预置旧 in-progress 条目，list/show 正常输出不受迁移影响 | P0 | ✓ |
| P8 | 流程文档：dev.md 两阶段（方案停待对齐、人工确认后实施、loop 闸门与批量对齐条款）；SKILL.md 同口径 | P0 | ✓ |
| P9 | 回归：layout（修订为五列）/ multi-project / file-board / copy-id / traceability 全绿 | P0 | ✓ |

## 执行记录（2026-09-01）

- P1–P8：`node scripts/tests/pending-alignment.test.mjs` 全绿（先红后绿：初跑 7 败）。P4/P5 为真实 server 与子进程钩子实测。
- P9：五套既有测试全绿（layout 契约按五列演进修订：repeat(5, minmax(176px,1fr))，合计 972px 保持 <980 无横向溢出承诺）。
- 看板前端新增第五列「待对齐」与抽屉「▶ 对齐确认」按钮；accepted 卡片提示文案改为引导 /dev 出方案。
- loop 语义变更：出方案闸门后，loop 对每个 accepted 条目只走阶段一（停在待对齐），批量对齐须用户会话明确同意。
