# 设计 — BUG-20260925-002 文档编写中 AI 校对的建议接收后点击刷新，又会再提示，但修改后报错。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260924-006（文档编写流程优化——③ AI 校对建议侧栏的接受 / 拒绝决断
  从一开始就实现为 `pf.chkDecisions` 页面内存会话态，注释明确「不持久化」；整页刷新 /
  切换版本重建 `state.pf` 后清零，且再次接受按 before 文本定位失败即报「过期」，经
  `atb list` 核验该单真实存在）。

## 根因分析

1. **决断只存页面内存**：`scripts/web/build.js` 的 `defaultPf` 中 `chkDecisions`
   （键 `runId|file|idx` → accepted / rejected / stale）仅存于页面内存。整页刷新
   （`applyPendingRestore`）与切换版本（`selectVersion`）均置 `state.pf = null`，重进
   文档编写页以 `defaultPf` 重建后 `chkDecisions` 归 null，全部决断（含已接受 / 已拒绝 /
   过期）清零——建议重新以「待处理」提示，「待处理 N 项」回涨，④ AI 翻译门禁回退。
2. **再次接受命中过期路径**：`acceptChkSuggestion` 经 `applyChkSuggestion` 按
   「该行包含 before / 全文 indexOf before」定位替换；建议首次接受成功后原文已被替换为
   after，决断丢失后再次应用找不到 before → 返回 stale，被一律当成「建议基于的文本已
   变化」报失败，无法区分「此前已应用」与「原文确被人工改过」。

## 方案

决断持久化落在**服务端校对执行账本**（`runtime/docs-check/runs/<runId>/run.json` 的
`decisions` 字段，键 `file|idx` → accepted / rejected / stale；runId 隐含于所在 run），
不选浏览器本地存储：本地存储只救单浏览器，换浏览器 / 换机器仍丢，且账本本就是校对
结论的事实源，决断随 run 落盘口径一致（runtime 应用数据，不进 git）。

1. **账本与接口**（`scripts/lib/docs-check-store.mjs` + `scripts/server.mjs`）：
   - `createCheckRun` 初始化 `decisions: {}`；`checkRunView` 透出 `decisions` 副本。
   - 新增 `recordCheckDecision(dataDir, { verId, runId, file, idx, decision })`：
     校验 decision 三值、run 属本版本、file 在 run 账本、idx 在该文件 issues 拆行数内
     （拆行口径与前端 `splitProofreadIssues` 一致：按换行拆、trim、去空行）、仅 run
     已收尾（done）可记；后写覆盖（同一建议以最后一次决断为准）。
   - 新增 `POST /api/build/docs-check/decision`（body：id / runId / file / idx /
     decision）落库并回 `checkRunView`。
   - 新 run 旧决断口径**维持 runId 绑定、不带入新 run**（现有口径，不扩大改动）；
     新增 `supersededCheckDecisionCount(dataDir, verId, currentRunId)`：同版本当前 run
     之前最近一个有决断的 run 的决断条数，随 `publish-plan` / `docs-proofread/current` /
     `docs-proofread/start` / `docs-summary/current` 的 docsCheck 视图透出
     （`supersededDecided`），供前端提示「上一轮决断不带入本轮」。
2. **前端**（`scripts/web/build.js`）：
   - 新增纯函数 `seedChkDecisions(pf)`：以 `plan.docsCheck.decisions`（服务端事实源）
     重建 `runId|file|idx` 键的会话决断表，本会话同 runId 的既有决断覆盖其上（防并发
     未落库丢失）；换 run（新 runId）旧键自然丢弃。在 `ensurePublishPlan` 拉取成功、
     `startProofread` 启动成功、`summaryPoll` docsCheck 变化三处替换 `pf.plan(.docsCheck)`
     后调用——整页刷新 / 版版切换重进即重播种，决断不丢、门禁不回退。
   - 接受 / 拒绝 / 过期决断产生时经 `persistChkDecision` POST 落库；持久化失败不阻塞
     会话内决断（优雅降级回旧行为，并有第 3 条兜底）。
   - 新增纯函数 `alreadyAppliedChk(content, s)`：接受定位失败（stale）时区分两种情况——
     after 非空且按同定位口径（有行号查该行、行号超界收敛末行；无行号查全文）能找到
     after ⇒ 判「此前已应用」，标记 accepted 并给非失败反馈（✓ 已应用过，无需重复操作），
     不再误报过期；after 为空（删除型）无法从内容可靠区分，保守走过期口径（保护不回退）。
     原文确被人工改过（找不到 before 也找不到 after）仍标记过期不覆盖，既有保护不变。
   - 侧栏在 `supersededDecided > 0` 时显示可感知说明：上一轮已处理 N 条决断随新一轮
     校对失效，本轮结论需逐条重新接受或拒绝。
3. **i18n**（`scripts/web/i18n.js`）：新增「已应用过」toast（静态）与「上一轮决断失效」
   说明（动态计数）两条词条，中英同步。

**开源选型（REQ-20260909-015）**：本修复只涉及自有前后端小改（账本字段 + 1 个 POST 接口
+ 前端播种 / 识别纯函数），无合适可直接复用的开源库需求，不引入新依赖、不 vendor；
未使用开源库，不创建 licenses.md。

## 风险与边界

- `recordCheckDecision` 仅接受 done run：running / failed run 的决断不入账（UI 本就只
  在 done 后逐条决断）；旧数据 run（无 decisions 字段）首次落库时补 `{}`，兼容不迁移。
- 决断后写覆盖为有意口径（同一建议以最后一次为准）；UI 已决断条目幂等不再出按钮，
  覆盖仅在「已应用识别」等内部路径发生。
- `alreadyAppliedChk` 的 after 全文 / 行内包含判定存在极小误判面（after 恰为他处已有
  文本），后果仅为「按已应用处理 + 非失败提示」，不覆盖任何内容，风险可接受。
- 持久化失败降级：会话内行为与修复前一致（内存决断），刷新后由已应用识别兜底不误报。
- 不改 ④ 门禁计数口径本身（`chkPendingCount` 语义不变，只是决断来源持久化）。
