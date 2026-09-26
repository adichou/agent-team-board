# 设计 — BUG-20260926-002 文档编写中的整体审查阶段已经不需要，请在流程各种去除。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260921-012（经 `atb list` 核验存在）——文档编写三阶段模型与「整体审查完结」
  提交门禁（canCommit = canFinalize && 完结有效）、完结核对对话框、`v.review.finalized` 固化
  均由该需求引入；REQ-20260924-001 在其上叠加只读自动检查（宿主完结对核对话框）；
  BUG-20260926-001 已把完结入口落阶段条 ③（本单在其之上整体去除）。

## 根因分析

三阶段模型把「整体审查完结」设计成提交前的人工收口动作，但该阶段：

1. 不修改任何内容——逐文件人工审查（①② 阶段）已对全部文件内容把关；
2. 其自动检查（REQ-20260924-001）只读、不设门禁，不承担放行职责；
3. 却叠加了一道人工确认 + 一道提交门禁（`canCommit = canFinalize && finalizedOk`），并引入
   完结快照（langsKey / customDocsKey / 内容指纹）失效回退的额外复杂度。

属流程冗余（多一次确认、多一层门禁与失效回退逻辑），非数据错误。

## 方案

**开源选型（REQ-20260909-015）**：本单为纯删除性重构（去除流程阶段与门禁叠加），不新增任何
功能面，无合适/必要的开源库可引入，不创建 licenses.md。

### 定稿结论（README「待确认」四项）

1. **「运行自动检查」去向：随完结对核对话框一并去除**。`POST /api/build/docs/review-checks`
   端点、`scripts/lib/docs-review-checks.mjs` 纯函数库、相关前端动作与词条同批删除，不残留
   死接口 / 无入口能力。理由：该检查唯一宿主是完结核对对话框（REQ-20260924-001），定位是
   「人工完结前核对」——完结阶段取消后失去流程位置；只读不设门禁，去除不弱化任何门禁；
   质量把关由更强口径承载（逐文件人工审查 + 五步 ③ AI 校对，校对提示词含链接有效性核查；
   语言一致性由逐文件审查与翻译基准约束）。对话框内「AI 校对」入口本就与五步 ③ 并存
   （REQ-20260924-006），随对话框移除后由五步 ③ 与右侧校对建议栏承载，能力不回退。
2. **历史数据兼容：忽略口径**。求值侧（evaluateDocsFlow）与前端 normalizeFlowEval 不再读取
   `v.review.finalized`，旧版本记录中残留的完结快照成为不被读取的历史字段，打开 / 审核 /
   提交均不受影响（提交门禁只看全审 + scopeStale / 基准变更，与完结字段无关）；不主动改写
   历史记录，下一次人工「通过审核」重写 v.review 时自然收敛。不新增迁移逻辑。
3. **根文档与 skill 同步：纳入本单**。根第一层 README / AGENTS / DESIGN / FEATURES 中
   「三阶段 / 整体审查完结后解锁提交」表述随两阶段口径更新（skills/ 无涉及，grep 核验）；
   根第一层发布文档无认领锁可直接改，且不随收口提交（REQ-20260923-002），差异保留在工作区
   由人工 / 发布文档流程处理。
4. **测试范围**：新增 `scripts/tests/bug-20260926-002.test.mjs`（测试先行）；随新口径更新
   既有断言——req-20260924-001（review-checks / 完结对核对话框）、req-20260921-012 / 008、
   bug-20260922-002（canFinalize / finalized / recordDocsFinalize / finalize 端点）、
   bug-20260926-001（阶段条 ③ 入口三态）、bug-20260921-012 / 013 / 017、bug-20260925-006
   （editFromProofread 关完结对话框）、req-20260924-004 / 006、bug-20260925-001 / 004、
   bug-20260921-004、req-20260922-002 / 003、req-20260921-010、req-20260920-003、
   build-serve 等按涉及面更新；`npm test` 全量通过。

### 实施要点

- **门禁回归**（publish-flow.evaluateDocsFlow）：移除 `canFinalize` / `finalized` 求值与
  `canCommit = finalizedOk` 叠加，`canCommit = allReviewed`（REQ-20260921-008 原「全部已审核」
  门禁；scopeStale / 基准变更天然使文件回退非 reviewed 态，无需另加条件，不放宽也不新增）。
- **后端设施移除**：server 删 `POST /api/build/docs/finalize` 与 `POST /api/build/docs/review-checks`
  两个端点；build-store 删 `recordDocsFinalize`；提交端点删完结缺口错误分支（全审即放行）。
- **前端移除**（build.js / style.css）：openFinalize / closeFinalize / confirmFinalize /
  runReviewChecks / renderFinalizeModal / editFromProofread 及 `data-pf-finalize*` /
  `data-pf-checks` / `data-proof-edit` 绑定、完结终态标识、`.bld-stage-fin` / `.bld-finalize-*`
  样式；阶段条回归两段纯展示（①②）；门禁条 / 提交 title / toast / 基准变更尾句去「整体审查」
  提法；翻译跳过提示改「直接进行提交」。
- **文案与词典**（i18n.js）：随界面删除清理 EN / EN_DYNAMIC 词条，改动处中英同步，跑 i18n 测试。
- **CLI 帮助**（atb.mjs / docs-check-store.mjs 注释与口径句）：summary / translate / docscheck
  帮助文本去「整体审查完结」提法，docscheck 结果指向右侧校对建议栏。
- **不回退清单**：逐文件「审查」对话框、五步操作条及各自门禁、③ AI 校对建议栏与决断落库、
  基准变更 / 范围变化审核失效回退（独立于完结，保留）、AI 翻译解锁门禁、加载 / 失败态口径、
  窄屏 flex-wrap 与深浅色主题。

## 风险与边界

- 提交门禁只弱化「完结叠加」这一层，不放宽「全部已审核」；未审内容仍提交不出。
- 旧版本（含 finalized 快照）与新代码共存：读取忽略口径保证不报错（设计结论 2）。
- 删除 review-checks 属能力去除而非降级：无界面残留、无死接口，测试同步收口。
- 收口边界：根第一层文档差异留在工作区（REQ-20260923-002），条目文档随 doc 组提交。
