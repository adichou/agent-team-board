# BUG-20260910-011 bug 的说明文档还是没有写上 ui Demo

- 状态：以看板机器状态为准（本文仅完善说明）。
- 归属：独立 Bug（非 UI——现象与修复均在完善流程/账本/提示词层，不改看板界面代码，无需 ui-demo.html，见「界面展示」节）。
- 创建：2026-09-10T04:47:28.806Z

## 现象

标题所指：**涉及 UI 的 Bug 条目经批量完善标记「已完善」后，说明文档里仍然没有 ui-demo.html 交互演示**。BUG-20260908-017 已定案「涉及 UI 的 Bug 与需求同等对待（界面展示节 + ui-demo.html 演示三查）」，但 2026-09-10 核验仍有成批 Bug 完善后缺演示，口径未落地。

现状实例（2026-09-10 核验，本仓库）：

- BUG-20260910-003 / 004 / 005 / 006 / 007 五个现象均为界面问题的 Bug，`refine/states.json` 均已置「已完善（refined）」，README 均有「界面展示」文字说明，但条目目录均**无 ui-demo.html**。其中 004/006/007 的 README 明确写「本轮按用户限定仅补 Bug markdown，未创建 HTML 文件」「本批用户允许 Bug 仅编辑条目 Markdown，因此本条不创建 HTML 演示」——执行端把旧提示词的收窄口径当成了用户限定。
- 对照组：同日新批次 RFB-20260910-023 下完善的 BUG-20260910-009（其领取时缺失原因含「涉及 UI 需界面展示」）与 BUG-20260910-010 均有 ui-demo.html——新旧批次对同类 Bug 行为不一致。

代码 / 账本核对（三条成因，均在 `scripts/lib/refine-store.mjs`）：

1. **长跑批次冻结了旧口径提示词**：批次账本 `refine/batches/RFB-20260909-022/batch.json`（创建于 2026-09-09T01:00Z，一直运行到 2026-09-10）的 `prompt` 字段 Bug 分支只有「Bug 补现象/复现步骤/期望行为/验收说明。」，硬性约束行写「只编辑条目目录下 markdown（**涉及 UI 的需求**可另建约定的 ui-demo.html）」——演示创建权限只给了需求。说明 BUG-20260908-017 的修复（现行 `buildRefinePrompt` 约 389–401 行已含「涉及 UI 的 Bug……同样须提供界面展示」「涉及 UI 的需求或 Bug 可另建」）落地晚于该批次创建，只对新批次生效；批次提示词按设计冻结不回写，BUG-20260910-001 的 `normalizePromptForDisplay` 展示层归一仅做词语替换，未覆盖此口径差异。003–007 正是在旧口径下完善并回执成功的。
2. **done 回执核验不校验文档完整性**：`finishRefineRun`（约 909–975 行）对 result=done 只核验 summary 非空且 ≤200 字、条目状态 accepted|planned、文档指纹相对冻结基线有变化（REQ-20260908-025「真实变更」口径），**不重跑 `analyzeItemDocs`**。实测（2026-09-10 本仓库执行）：`analyzeItemDocs` 对 003/004/006/007 报「涉及 UI 缺 ui-demo.html 演示」、对 005 报「涉及 UI 需界面展示」（complete:false），而五者均已被记「已完善」——完整性判定与完善标记矛盾，回执端无拦截。
3. **领取时缺失原因漏报 UI（启发式探测盲区）**：`uiDemoReasons`（约 186–201 行）的探测文本为 Bug 的 现象+期望行为 两节正文；条目登记未带 `--desc` 时两节为「（待补充）」/空，**标题中的 UI 关键词不参与探测**——RFB-20260909-022 账本里 BUG-20260910-007（标题「这里的操作按钮去掉中文…」）的冻结缺失原因仅 缺复现步骤/缺期望结果/缺验收说明，无任何 UI 演示提示，子代理仅凭领取输出无从得知需建演示（对照组 004 因创建时现象节已有含关键词正文，领取时带「涉及 UI 需界面展示」）。词表外界面词同样漏报：010（紫蓝色「边框」）领取时亦未报 UI，演示系执行端按新提示词主动补齐。另注：005 的界面展示节使用三级标题「### 界面展示、交互与状态反馈」，`sectionsOf` 只识别 `##` 二级节导致分析器视其为无节——节标题层级口径是否并入本 Bug 修复，待确认。

## 复现步骤

前置：本仓库 `/Users/adichou/Documents/src/agent-team-board`，Node 环境。

方式 A——账本证据复现（零改动）：

1. 查看 `docs/agent-team-board/refine/states.json`：BUG-20260910-003~007 均为 `"state": "refined"`；五者条目目录下均无 `ui-demo.html`。
2. 执行完整性分析（与 `analyzeItemDocs` 同口径）：
   `node -e "import('./scripts/lib/refine-store.mjs').then(m=>console.log(m.analyzeItemDocs('docs/agent-team-board/bugs/BUG-20260910-007','bug')))"` → 输出 `complete:false` 且含「涉及 UI 缺 ui-demo.html 演示」——「已完善」条目实际不完整。
3. 对照批次提示词：`refine/batches/RFB-20260909-022/batch.json` 的 `prompt`（Bug 分支与「只编辑条目目录下 markdown」约束行，均未给 Bug 演示口径）vs `refine/batches/RFB-20260910-023/batch.json` 同位置（含「涉及 UI 的 Bug……同样须提供界面展示」）——完善 003~007 所用的旧批次口径缺 Bug 演示要求。

方式 B——流程复现（重现「缺演示仍可记已完善」）：

1. 登记一个现象为界面问题的 Bug：标题含 UI 关键词（如「按钮置灰态缺失」），`--desc` 留空；人工接受（accepted）。
2. `node scripts/atb.mjs refine next --by <owner> --dir .` 领取：缺失原因只报四节缺失，无 UI 演示提示（现象/期望行为为占位文本，标题关键词不参与探测——成因 3）。
3. 子代理只补 现象/复现步骤/期望行为/验收说明 与「界面展示」文字节（含 UI 关键词、不含「不涉及界面改动」），不创建 ui-demo.html，回执 `refine done <RUN-ID> --summary "…"`。
4. 回执成功、`refine/states.json` 置 refined——尽管此时 `analyzeItemDocs` 对该条目报「涉及 UI 缺 ui-demo.html 演示」（成因 2：done 核验不查完整性）。「已完善」标记与完整性判定矛盾，即本 Bug。

## 期望行为

涉及 UI 的 Bug 完善后说明文档必须真正带上 ui-demo.html，「已完善」标记与完整性判定一致：

1. **done 回执核验增加完整性门槛**：`finishRefineRun` 对 result=done 重跑 `analyzeItemDocs`（或至少 UI 演示三查），仍报缺失原因时拒绝回执（提示继续补演示，或改用 `refine fail` 登记原因）；是否允许人工明示豁免及其记法（如条目内声明理由后放行）待确认，由 design.md 定案。
2. **领取时 UI 探测补漏**：探测文本纳入标题（及/或创建时的 `--desc` 原文）——标题含 UI 关键词的 Bug 领取时缺失原因应出现「涉及 UI 需界面展示」；具体探测范围与词表是否增补（如「边框」）待确认，由 design.md 定案。「### 界面展示」节标题层级识别口径是否一并统一，待确认。
3. **长跑批次口径同步**：冻结提示词原文不回写（沿 BUG-20260910-001「展示层归一、账本不回写」口径），但须让执行 Agent 感知最新口径——扩展 `normalizePromptForDisplay` 归一规则或在 `refine next` 领取输出附加最新口径行，方案待确认，由 design.md 定案。
4. **存量条目补齐**：已标「已完善」但缺演示的 BUG-20260910-003~007 的补齐方式（重新接受触发再完善 / 批量补演示 / 人工豁免并记录理由）待确认，由 design.md 给出方案；豁免不降低质量门槛，需求侧口径不受影响。
5. **零回归**：不涉及 UI 的 Bug（如 BUG-20260910-008 形态）与界面展示节声明「不涉及界面改动」的条目仍可正常 done；需求侧演示三查、指纹（v2）与既有 refine 流程行为不变。

## 界面展示

本 Bug 为完善流程/账本/提示词层缺陷：现象是条目文档与完善账本的状态矛盾，修复面在 `scripts/lib/refine-store.mjs`（回执核验、启发式探测、提示词归一）与存量条目文档补齐，不改看板界面代码（`scripts/web/` 的 index.html / app.js / style.css 均不在修复面），界面无布局、交互、状态反馈变化——不涉及界面改动，无需 ui-demo.html。

## 验收说明

- [ ] 端到端：按复现方式 B 重走——只补四节不建演示时 `refine done` 被拒并提示缺演示；补四节 + 合格 ui-demo.html（README 界面展示节链接 ./ui-demo.html，单文件、内联 CSS/JS、无外网依赖、无构建步骤、可交互、对照缺陷现象与修复后状态）后 done 成功、置已完善，`analyzeItemDocs` 判 complete。
- [ ] 回执核验新增完整性判定有自动化测试（finishRefineRun：缺演示拒绝 / 齐备通过 / summary 与状态校验不回归）。
- [ ] 不涉及 UI 的 Bug 与「不涉及界面改动」声明条目回归不受影响，可正常 done。
- [ ] 领取时缺失原因：标题含 UI 关键词、正文为占位的 Bug 报「涉及 UI 需界面展示」（按 design.md 定案的探测范围）；词表/层级识别若定案调整则同步测试。
- [ ] 修复落地时仍 running 的存量批次：执行 Agent 能感知 Bug 侧演示要求（按 design.md 定案机制验证）；批次账本冻结 prompt 原文不被改写。
- [ ] 存量 BUG-20260910-003~007 按 design.md 定案方式补齐（演示或记录在案的豁免），补齐后 `analyzeItemDocs` complete 或豁免留痕可查。
- [ ] 既有 refine 侧测试（`scripts/tests/refine-store.test.mjs` 等）零回归。

## 关联（引入来源）

- 初步归因（终判以修复阶段 design.md 为准）：BUG-20260908-017（Bug 侧 UI 演示要求）修复更新了提示词生成与 `analyzeItemDocs` 检查，但未覆盖三个既有面——①批次提示词按 REQ-20260908-020 设计在创建时冻结、长跑批次沿用旧口径（展示层归一仅 BUG-20260910-001 的词语级）；②`finishRefineRun` done 核验沿 REQ-20260908-020/025 口径只验「真实变更」不验完整性；③UI 关键词启发式（REQ-20260908-015）探测文本不含标题、占位正文漏报。三者叠加导致涉及 UI 的 Bug 完善后仍无 ui-demo.html 却被记「已完善」。
