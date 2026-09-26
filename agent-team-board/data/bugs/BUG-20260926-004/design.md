# 设计 — BUG-20260926-004 发布范围变化（scopeStale）后逐文件通过审核永不生效，审查与提交门禁互相死锁

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260921-008（发布模块的文档编写页面优化，已核验存在、状态 done）。该单引入了逐文件「通过审核」机制（`recordDocsReview` 固化审核时点内容 hash）与四态求值判定 `approved = !scopeStale && !!rec && diskHash != null && rec.hash === diskHash`（scripts/lib/publish-flow.mjs:605，由提交 `01db0bf` 落地）——scopeStale 期间 `approved` 恒为假，逐文件重新审核永远无法生效；而 scopeStale 的唯一解除途径是「重新提交文档」（`recordDocsCommit` 是唯一写 `scopeStale: false` 的位置，scripts/lib/build-store.mjs:447），提交又被「全部文件已审核」门禁（`canCommit = allReviewed`）拦住。三个条件互相咬合，死锁闭环在此成形。

组合引入说明（同一闭环的另两个承重件，均合理、本单不改其语义）：

- REQ-20260920-003（构建和发布流程整改，已核验存在）：引入 scopeStale 机制本身——范围变化标记 `markDocsScopeStale`、「仅重新提交可清除」语义，产品口径合理；
- BUG-20260926-002（已核验存在）：提交门禁回归「全部已审核即放行」时，注释假设「scopeStale / 基准变更天然使文件回退非 reviewed 态，全部已审核即含无失效源」（publish-flow.mjs:644-645）——该假设隐含「回退后可重新审核恢复」，而重新审核实际被 `!scopeStale` 判定阻断，假设不成立且无测试覆盖恢复路径（req-20260921-015.test.mjs 等仅断言 scopeStale 置位，不断言可恢复）。

## 根因分析

死锁链条（以 BLD-20260926-004 登记时真实数据验证，探针脚本对真实 version.json 调 `evaluateDocsFlow` 复算）：

1. **触发**：版本 BLD-20260923-001 的 11 个发布文档此前已全部通过审核并提交（docs commit `f1d15c7`，磁盘内容 sha256 与 `review.files` 固化 hash 逐文件一致）。2026-09-26 在「合并入 main」步隔离分析点「一键加入所有依赖提交」→ `markDocsScopeStale`（build-store.mjs:345）置 `docs.scopeStale = true`，原因「补入依赖提交：…」。
2. **失效**：`evaluateDocsFlow`（publish-flow.mjs:605）`approved = !scopeStale && …` —— scopeStale 期间无论 hash 是否一致，全部文件判非「已审核」，回退 summarized / translated / pending；求值结果 reviewedCount = 0/11、canCommit = false（真实复算确认）。
3. **假恢复**：审查对话框逐文件点「通过审核」→ POST `/api/build/docs/review`（server.mjs:2988）成功记录 hash（不报错）→ 前端 toast「✓ … 已通过审核（0/11）」→ 用返回 docsFlow 重渲染后状态与点击前完全相同（`approved` 仍被 `!scopeStale` 压死）。界面表现为「点击没有响应」。
4. **死锁**：scopeStale 仅 `recordDocsCommit`（build-store.mjs:447，重新提交文档）可清除；提交端点（server.mjs:3042）要求 `canCommit`（全部已审核）才放行；而第 2 步决定 scopeStale 期间文件永远无法变为已审核。三步互咬：审查解不了提交的锁，提交解不了审查的锁。merge 门禁（evaluateDocsState → needs-rewrite，publish-flow.mjs:690）同样被压住，版本整体卡死在文档编写步。

缺陷本质：`!scopeStale` 作为「已审核」判定的**必要条件**，把「范围变化后需重新核对」这一过程性要求，错误实现成了「重新核对动作本身无效」——门禁校验点放错了层（应该在提交时点校验「审核基于最新范围」，而不是在求值时点让审核操作永远失败）。

## 方案（用户已选定方案 1）

**scopeStale 的门禁语义收敛到提交时点校验，审查对话框不受其阻断。**

1. **求值侧（scripts/lib/publish-flow.mjs `evaluateDocsFlow`）**：`approved` 判定去掉 `!scopeStale` 必要条件（恢复为 `!!rec && diskHash != null && rec.hash === diskHash`），scopeStale 不再压死逐文件审核状态；`canCommit` 在 `allReviewed` 基础上叠加提交时点范围一致性校验——全部审核记录的时点（`review.files[file].at`）晚于最近一次范围变化时点（可在 `markDocsScopeStale` 时记录 `docs.scopeChangedAt`，与既有 `staleReason` 并列），且提交端点复算通过；审核过程中范围再变则 `canCommit = false`，missing 中如实给出「审核后范围又变化」的缺口说明。
2. **提交侧（scripts/lib/build-store.mjs / server.mjs `/api/build/docs/commit`）**：`recordDocsCommit` 清除 scopeStale 的既有行为不变；提交前置校验在既有 canCommit 之外复核「审核基于当前范围」（防御求值与提交之间的窗口期），失败时报错文案如实指向「重新审查」而非「逐文件通过审核后再提交」的死循环提示。
3. **展示侧（scripts/web/build.js）**：scopeStale 期间审查对话框保留失效提示横幅（如「发布范围已变化，请重新逐文件核对后提交」）；toast 计数口径与求值结果一致（修复「已通过审核（0/11）」矛盾形态——审核生效后计数应前进）。
4. **不改**：scopeStale 标记与 `staleReason` 溯源、`markDocsScopeStale` 触发点、merge 步 needs-rewrite 门禁、「发布范围变化 → 文档需重新核对」产品口径、BUG-20260926-002 的提交门禁简化（不回叠加整体审查完结条件）。

**开源选型（REQ-20260909-015）**：本单为产品自身状态机逻辑修复，评估过无成熟开源库可复用（看板私有领域模型，无可引用的通用库），维持自研，不引入新依赖，不创建 licenses.md。

## 风险与边界

- **门禁强度变化评估**：修复后「已审核」不再隐含「无失效源」，靠提交时点的「审核时点晚于范围变化时点」校验补位——需保证该校验不可绕过（端点侧复算，不依赖前端 docsFlow 快照）；若实现为「提交时重算范围指纹对比 scopeChangedAt 基线」，需与既有 `publishScopeFingerprint` 口径对齐，避免两套指纹打架。
- **历史数据兼容**：存量 scopeStale 版本（如 BLD-20260923-001）没有 `scopeChangedAt` 字段——缺失时回退为「审核记录均视为基于旧范围」，即仍需重新逐文件审核一次才能提交（安全侧倾斜），或以 `updatedAt` / docs 提交时间兜底，实现时定稿并在测试覆盖。
- **并发窗口**：审核与范围变化并发（一键加入进行中同时点通过审核）——范围变化落盘在后时，提交时点校验必须能识别（以落盘时点为准），防「审核旧范围、提交新范围」。
- **测试先行**：scripts/tests/ 新增 `bug-20260926-004.test.mjs`（先红）：①scopeStale 下逐文件审核可恢复、全审后 canCommit = true、提交清除 scopeStale；②审核后再变范围 → canCommit 回落 false、提交拦截文案如实；③存量无 scopeChangedAt 数据的回退行为；④scope 未变化的既有流程回归。
