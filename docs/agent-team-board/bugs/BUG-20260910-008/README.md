# BUG-20260910-008 批量完善提示词中要针对自动转入计划的配置进行处理

- 状态：以看板机器状态为准（本文仅完善说明）。
- 归属：独立 Bug（非 UI——现象与修复均在 CLI 提示词/文案层，不涉及界面，无需 ui-demo.html）。
- 创建：2026-09-10T03:35:05.867Z
- 引入来源：REQ-20260909-010（「完善完成后自动转入计划」引入系统侧 accepted → planned 流转，未联动更新 REQ-20260908-020 时代的「条目全程保持 accepted／不要修改 status.json」固定约束行；编号经 `atb list` 核验存在，详见 design.md）

## 现象

1、提示词中包含“条目全程保持 accepted（已接受）；不要修改业务源码；不要修改条目 status.json；”，这在自动转入计划开关打开时，会导致部分 Agent（如 codex）暂停后续的完善操作。提示词要针对这块进行优化，确保没打开自动转入计划开关时无法修改状态，打开时支持修改状态，不会暂停完善动作

代码核对（scripts/ 下现状）：

- **提示词约束行是固定文案，不感知开关状态**：主调度提示词 `buildRefinePrompt`（`scripts/lib/refine-store.mjs` 约 400–401 行）与 codex 单项提示词 `buildRefineWorkerPrompt`（同文件约 426–427 行）均输出固定的「条目全程保持 accepted（已接受）／条目保持 accepted（已接受）：…不要改 status.json…」约束，未提及「完善完成后自动转入计划」配置——无论开关开闭，冻结进批次账本的提示词是同一句。CLI 回显同口径：`scripts/atb.mjs` 的 refine usage（约 569 行「条目保持已接受」）与 `refine create` 输出行（约 603 行「条目保持 accepted（已接受），不占实施互斥」）。
- **开关打开时系统会合法地改状态**：REQ-20260909-010 落地后，`refine done` 核验通过时由回执处理逻辑内部把条目 accepted → planned（`autoPlanRefinedItem`，`by: 'system'`，写 status.json 与 history；zcode 路径 `finishRefineRun`、codex 路径 server 侧 `settle` 同口径），CLI 输出「已自动转入计划：<ID>（accepted → planned，进入批量开发候选）」。这是系统行为而非 Agent 操作（不经 CLI status、不触 state-guard 拦截面）。
- **冲突点**：开关打开时，执行 Agent 被提示词约束「条目全程保持 accepted／不要修改 status.json」，却观察到回执后条目变为 planned——严格遵循指令的 Agent（如 codex）会把这一状态变化当作约束被违反，从而暂停后续完善动作（等待人工说明），批次推进中断；而该状态变化实为用户开启配置后授权的系统流转。done 核验本身允许 accepted | planned 两态（人工提前移入计划仍可回执），提示词口径未同步。
- **现场证据**：当前项目 `docs/agent-team-board/tasks/settings.json` 已配置 `refine.autoPlanAfterDone: true`（开关开启），而进行中的完善批次 RFB-20260909-022 冻结的提示词仍只含「硬性约束：条目全程保持 accepted（已接受）；不要修改业务源码；不要修改条目 status.json；」，无任何自动转入计划说明——两态确实并存。codex 侧暂停的具体形态（询问后停 / 直接停轮）依 Agent 与版本而异，待确认。

## 复现步骤

前置：Node 环境；命令在仓库根执行。准备一个含 agent-team-board 数据的项目，至少 2 条已接受且未完善的条目。

1. 开启开关：看板「设置 → 批量任务 → 完善完成后自动转入计划」勾选并保存（等价于 `docs/agent-team-board/tasks/settings.json` 的 `refine.autoPlanAfterDone: true`）。
2. 创建完善批次：`node scripts/atb.mjs refine create`——回显的「主调度提示词」含固定约束行「硬性约束：条目全程保持 accepted（已接受）；不要修改业务源码；不要修改条目 status.json；…」，与开关状态无关，不含自动转入计划的任何说明（本步可稳定复现，当前项目 RFB-20260909-022 批次账本即此形态）。
3. 将该提示词粘贴到执行 Agent 会话（如 codex）执行：子代理 `atb refine next` 领取第 1 条、补全文档后 `node scripts/atb.mjs refine done <RUN-ID> --summary "…"`。
4. 观察回执：done 成功，随后输出「已自动转入计划：<ID>（accepted → planned，进入批量开发候选）」；条目 status.json 变为 planned，history 记「完善后自动转入计划（<RUN-ID>）」（系统写入）。
5. 观察执行 Agent：提示词约束「条目全程保持 accepted」与观察到的「条目已变 planned」冲突，codex 等严格 Agent 在此暂停后续完善操作（不再继续 refine check / 派发下一条），批次推进中断。第 5 步为报告的 Agent 行为，具体暂停形态待确认；本地可稳定复现的是第 2、4 步的提示词与回执输出。
6. 对照（开关关闭）：`refine.autoPlanAfterDone` 保持默认 false 重复步骤 2–4：done 输出「未开启自动转入计划：需人工移入计划（设置 → 批量任务 → 完善完成后自动转入计划）」，条目保持 accepted，与提示词约束一致，Agent 正常推进——冲突仅在开关打开时出现。

## 期望行为

批量完善提示词及相关回显文案针对「完善完成后自动转入计划」开关分态处理：

1. **开关关闭（默认）**：口径不变——提示词仍明确「条目全程保持 accepted（已接受）；不要修改条目 status.json」，Agent 不得修改条目状态，现有行为零回归。
2. **开关打开**：提示词明确说明——done 回执核验通过后，系统（非 Agent）会自动把条目 accepted → planned；Agent 看到「已自动转入计划」输出或条目变为 planned 均属预期系统行为，不得据此暂停、中止或等待人工确认，应按流程继续 refine check / 派发下一条。
3. **Agent 纪律不放宽**：无论开关状态，Agent 自身仍不得修改 status.json、不得执行 `atb status <ID> accepted|planned|done`（state-guard 拦截规则不变）；「打开时支持修改状态」指系统侧自动流转被提示词承认并告知，不是授权 Agent 改状态。
4. **覆盖提示词生成/回显链路**：`buildRefinePrompt` / `buildRefineWorkerPrompt`（scripts/lib/refine-store.mjs）及 `refine create` 的 CLI 回显、usage 文案按开关分态；批次账本冻结的存量提示词经 `normalizePromptForDisplay`（scripts/lib/task-settings.mjs）展示层归一到新文案（沿 BUG-20260910-001「展示层归一、账本不回写」口径），归一需幂等。
5. **批次进行中切换开关的口径**（提示词按创建时冻结还是按展示/领取时实时状态归一）待确认，由 design.md 给出结论。
6. 本 Bug 仅处理提示词/文案层；不改变 `refine done` 与自动转入计划本身的行为与输出语义（属 REQ-20260909-010 范围）。

## 验收说明

- [ ] 开关关闭：`refine create` 回显提示词与现状一致（含「条目全程保持 accepted」约束行），Agent 不可修改条目状态，既有 refine-* / task-settings 相关测试零回归。
- [ ] 开关打开：回显提示词含自动转入计划说明——done 后系统自动 accepted → planned 属预期，Agent 不暂停后续完善；同时仍明确 Agent 自身不得改状态（不改 status.json、不执行 `atb status <ID> planned` 等）。
- [ ] 两态提示词生成与展示层归一均有自动化测试覆盖（buildRefinePrompt / buildRefineWorkerPrompt / normalizePromptForDisplay，归一对现行输出幂等、不回写批次账本）。
- [ ] 存量未结束批次（如本项 RFB-20260909-022 冻结的旧提示词）经展示/回显层归一到新文案；已冻结 prompt 原文不被改写。
- [ ] 实测验证：开关打开状态下，用受影响 Agent（codex）执行一个含 ≥2 条目的完善批次，全部条目推进不被中断；无法在该环境实测时记录等价验证方式（待确认）。
- [ ] 不修改 `refine done` / `autoPlanRefinedItem` 的流转行为与输出语义；state-guard 拦截规则与 HUMAN_ONLY_TO 语义不变。
- [ ] 开发阶段补充 design.md（含批次进行中切换开关的口径结论、引入来源归因）与 test-cases.md 并通过相关测试。

## 关联（引入来源）

- 初步归因（终判以 design.md 为准）：REQ-20260909-010「完善完成后自动转入计划」引入系统侧 accepted → planned 流转，未联动更新提示词中 REQ-20260908-020 时代的「条目全程保持 accepted／不要修改 status.json」固定约束行，开关打开时两者口径冲突。
- REQ-20260908-020：完善面向已接受单、全程保持 accepted 的口径（约束行出处）。
- REQ-20260909-011：提示词单一通用版（buildRefinePrompt 现行形态出处）。
- BUG-20260910-001：冻结提示词展示层全量归一的先例口径（本 Bug 修复沿用）。
