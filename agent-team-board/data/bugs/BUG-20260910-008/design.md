# 设计 — BUG-20260910-008 批量完善提示词中要针对自动转入计划的配置进行处理

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260909-010**「支持需求完善后自动转入计划，提供配置，默认是手动」（编号经 `atb list` 核验存在，in-progress）
- 关联（约束行与归一口径出处，均经 `atb list` 核验）：
  - REQ-20260908-020「重构批量流程和任务管理」——「条目全程保持 accepted／不要修改 status.json」固定约束行出处；
  - REQ-20260909-011「优化批量完善和批量开发的提示词…」——buildRefinePrompt 现行单一通用版形态出处；
  - BUG-20260910-001「批量完善的提示词还有 zcode 的词语…」——冻结提示词「展示层归一、账本不回写」先例口径（本修复沿用）。

## 根因分析

REQ-20260909-010 落地系统侧流转（done 回执核验通过后由 `autoPlanRefinedItem` 以 `by: 'system'` 把条目 accepted → planned），但未联动更新提示词层：`buildRefinePrompt`（主调度）与 `buildRefineWorkerPrompt`（codex 单项）仍输出 REQ-20260908-020 时代的固定约束行「条目全程保持 accepted（已接受）；…不要修改条目 status.json」，且不感知 `refine.autoPlanAfterDone` 开关。开关打开时，严格遵循指令的执行 Agent（如 codex）观察到回执后条目变为 planned，会将其判定为「约束被违反」，进而暂停后续完善操作（等待人工说明），批次推进中断——而该状态变化实为用户开启配置后授权的系统流转。CLI 回显（refine usage 与 `refine create` 输出行）同口径冻结/输出，均不分态。

## 方案

**开源选型（REQ-20260909-015）**：本修复为纯文案/提示词分态与展示层归一逻辑，无第三方库可用场景；自研理由：无合适库（问题域为项目自有提示词协议）。

### 1. 两态约束文案唯一事实源（scripts/lib/task-settings.mjs）

新增导出常量：`REFINE_SCHEDULER_KEEP_ACCEPTED_LINE`（OFF，逐字保留现状约束行）、`REFINE_SCHEDULER_AUTO_PLAN_LINES`（ON，多行段）、`REFINE_WORKER_KEEP_ACCEPTED_LINE` / `REFINE_WORKER_AUTO_PLAN_LINES`（codex 单项第 3 条两态）。常量定义在 task-settings 而非 refine-store：refine-store 依赖 task-settings，反向定义会环引；生成层与展示归一层共用同一常量，避免文案漂移。

ON 文案要点（对准 Bug 现象）：完善期间条目保持 accepted；开启「完善完成后自动转入计划」——done 回执核验通过后**系统（非 Agent）**自动 accepted → planned（回显「已自动转入计划」）；看到该输出或条目变为 planned **均属预期系统行为，不要据此暂停、中止或等待人工确认**，照常 refine check / 继续派发下一个子代理；同时 Agent 纪律不放宽（不改业务源码、不改 status.json、**不执行 atb status**——「打开时支持修改状态」指系统流转被提示词承认，不是授权 Agent 改状态）。ON 段首行与 OFF 行文案不同、形态互不为前缀，归一双向替换无歧义。

### 2. 生成层按开关分态（scripts/lib/refine-store.mjs）

- `buildRefinePrompt` / `buildRefineWorkerPrompt` 新增 `autoPlan = false` 参数（缺省 OFF＝现状零回归，直连旧调用不受影响）。
- `createRefineBatch` 与 `newCodexRefineRun` 经新增导出 `refineAutoPlanOn(dataDir)`（`autoPlanAfterRefineDone(loadTaskSettings(dataDir))`，异常按关闭）实时读取开关后传入，创建/派发时按当时状态冻结提示词。

### 3. 展示/回显层归一（normalizePromptForDisplay 扩展，沿 BUG-20260910-001「展示层归一、账本不回写」）

`normalizePromptForDisplay(prompt, { autoPlan = null } = {})`：`true` → OFF 约束行（主调度/worker 两形态，含存量冻结原文）整段替换为 ON 文案；`false` → ON 文案归一回 OFF 行；缺省 → 不触碰约束行（既有调用形态与开发侧提示词零回归）。替换按整行连续序列精确匹配，对现行生成输出两方向幂等。

**批次进行中切换开关的口径结论（README 期望行为第 5 点）**：**展示/回显层按实时开关状态归一，不按创建时冻结态**。理由：自动流转发生在 done 回执时点、按**当时**设置生效——只有展示文案与该时点实际系统行为一致，才能在「创建后中途开/关开关」场景下继续防止 Agent 误判暂停；若按创建时冻结态展示，中途打开开关会原样复现本 Bug 冲突。账本冻结原文（batch.json 的 prompt、run 的 prompt.md）永不回写，历史事实源不动。

### 4. 透出链路接入

- CLI（scripts/atb.mjs）：`refine create` 回显 prompt 与输出行分态（关闭输出行与现状逐字一致；开启附「完善后自动转入计划已开启：done 回执后系统自动 accepted → planned（…属预期系统行为，Agent 不得据此暂停）」）；`refine pause` JSON publicView 同步分态；REFINE_USAGE 补两态静态说明。
- 数据层：`refineSummary` 经 `refineBatchPublicView(batch, { autoPlan: refineAutoPlanOn(dataDir) })` 实时分态（server `/api/refine/current`、CLI `refine summary` 的数据源随之生效）；server `/api/refine/create` 直接传同参。
- `refineBatchPublicView(b)` 缺省行为不变（不传选项＝不触碰约束行），存量调用零回归。

### 5. 明确不动项（边界）

不改变 `refine done` / `autoPlanRefinedItem` 的流转行为与输出语义（REQ-20260909-010 范围）；`HUMAN_ONLY_TO` 与 state-guard 拦截规则不变；不写任何 status.json；不回写批次/运行账本。

## 风险与边界

- **文案分叉维护**：两态文案以 task-settings 常量为唯一事实源，生成与归一共用；测试对常量与关键词双断言，防漂移。
- **归一误伤面**：替换按整行精确匹配，开发侧 generatePrompt 不含完善约束行、且其调用不传 autoPlan——已加回归用例（C2）。
- **实时归一与冻结原文的偏差**：展示文案可能领先/滞后于账本冻结原文（如中途关开关后展示剥除说明）——与 done 时点实际系统行为一致优先，账本原文保留可追溯（D2/D3 断言不回写）。
- **受影响 Agent 实测**：本环境无 codex Agent 会话可实测；等价验证＝自动化用例 E2：开启开关完整跑 2 条目批次（done 输出「已自动转入计划」、条目转 planned、check 保持 continue、第二条可继续领取至收工）+ ON 提示词含「不要据此暂停、中止或等待人工确认」指令（D1）。真实 Agent 行为层面的确认留待人工在使用中复核。
