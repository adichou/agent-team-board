# BUG-20260909-017 批量完善的提示词中依然含有子代理模型配置的相关内容表述，应和批量开发一样保持一致。

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-09T12:57:40.260Z

## 现象

批量完善的主调度提示词中仍出现旧口径的固定模型配置行，与批量开发当前使用的「跟随主调度会话」指令不一致：

1. **在途完善批次账本冻结了旧行**：`docs/agent-team-board/refine/batches/RFB-20260909-022/batch.json`（状态 running，创建于 2026-09-09T01:00:47.586Z）的 `prompt` 第 4 行为：

   > 子代理模型配置：（默认） · 智能档位 high（来自设置「批量任务」，启动子代理时按此传递）。

   该行引用的「设置 → 批量任务」按 Agent 四路子代理模型配置已随 REQ-20260909-011 移除（设置保存入口 `scripts/server.mjs` /api/tasks/settings 的 agents / models 键保留但忽略、不落盘，仅完善流转开关生效），指向的配置已不存在；REQ-20260909-005 起两类批量任务的子代理模型应默认「跟随主调度会话」。

2. **同类存量账本均带旧行**：`docs/agent-team-board/refine/batches/` 下 RFB-20260908-008、010–015、RFB-20260909-016–022 共 14 个完善批次的 `prompt` 均为该旧行（其余更早批次无模型行）；而批量开发同期批次（`docs/agent-team-board/dispatch/batches/batch-20260909-023` 至 `batch-20260909-026`）的 `prompt` 均已是「子代理模型与智能/推理档位：跟随主调度会话——…」口径，两类任务提示词不一致。

3. **旧行持续透出给用户**：
   - 看板「批量完善」面板提示词块直接渲染账本冻结的 `batch.prompt`（`scripts/web/app.js` `#refinePrompt`，约第 3942 行），「复制提示词」按钮（`#refineRecopy`，约第 4106–4111 行）复制的也是该冻结文本；
   - CLI `atb refine create` 对未结束批次幂等返回在途批次并回显其 `prompt`（`scripts/atb.mjs` refine create 分支），同样打印旧行。

4. **源码层残留兼容分支**：`scripts/lib/refine-store.mjs` `buildRefinePrompt`（约第 364–368 行）与 `scripts/lib/batch.mjs` `generatePrompt`（约第 479–483 行）仍保留 `modelSource='manual'` / 直传 `model`/`level` 时生成同款「子代理模型配置：…（来自设置「批量任务」…）」旧行的分支。当前全部创建入口已固定传 `modelSource: 'follow'`（`scripts/atb.mjs` 第 585、792 行；`scripts/server.mjs` 第 1414、1599 行），新建批次不再触发该分支——旧行的实际暴露路径是存量/在途批次账本与上述展示/回显入口。

## 复现步骤

1. 打开项目看板（Status Board）→「批量完善」面板（或执行 `node scripts/atb.mjs refine summary --dir <项目根>`）。
2. 查看当前在途完善批次 RFB-20260909-022 的「主调度提示词」块，或点击「复制提示词」。
3. 观察提示词第 4 行（批次标识行之后）为「子代理模型配置：（默认） · 智能档位 high（来自设置「批量任务」，启动子代理时按此传递）。」，其中「（默认）」并非主调度会话实际模型，且指向的设置入口已不存在。
4. 对比「批量开发」面板任一 2026-09-09 下午创建的开发批次（如 batch-20260909-026）提示词：模型指令行为「子代理模型与智能/推理档位：跟随主调度会话——…」，两者不一致。
5. （账本级佐证）直接查看 `docs/agent-team-board/refine/batches/RFB-20260909-022/batch.json` 的 `prompt` 字段与 `docs/agent-team-board/dispatch/batches/batch-20260909-026/batch.json` 的 `prompt` 字段，比对模型指令行。

## 期望行为

- 批量完善与批量开发的主调度提示词模型指令行保持同一口径：默认注入 `scripts/lib/task-settings.mjs` 的 `FOLLOW_SESSION_PROMPT_LINE`（第 32–36 行，「子代理模型与智能/推理档位：跟随主调度会话——…」），不再出现「子代理模型配置：…（来自设置「批量任务」，启动子代理时按此传递）」表述。
- 用户从批量完善面板（提示词块 / 复制提示词）与 CLI `atb refine create` 回显拿到的在途批次提示词，与批量开发一致为「跟随主调度会话」指令；提示词不再指向已移除的设置「批量任务」按 Agent 模型配置。
- 新建完善批次的 `prompt` 直接生成正确口径（当前创建入口已传 `modelSource: 'follow'`，新建路径预期无回归）。
- 在途批次 RFB-20260909-022 及历史批次账本中已冻结的旧行如何处置（随修复重写账本 / 仅保证新建与展示口径正确 / 面板按当前口径重渲染）——具体方案**待确认**，由修复阶段在 design.md 确定，不强行编造处置方式。

## 验收说明

1. 看板「批量完善」面板在途批次的提示词块与「复制提示词」输出均不含「子代理模型配置」与「设置「批量任务」」字样，模型指令行与批量开发批次一致为「子代理模型与智能/推理档位：跟随主调度会话——…」。
2. `node scripts/atb.mjs refine create --dir <项目根>`（幂等返回在途批次时）回显的提示词同样满足第 1 条（或按 design.md 声明的处置口径处理存量账本，处置口径需在 design.md 明确）。
3. RFB-20260909-022 收尾后新建的完善批次，其 `docs/agent-team-board/refine/batches/<新批次>/batch.json` 的 `prompt` 含「跟随主调度会话」行且不含「子代理模型配置」字样。
4. 回归验证：批量开发提示词不受影响（`generatePrompt` `modelSource='follow'` 输出不变）；`scripts/tests/model-follow-session-20260909-005.test.mjs` 与 `scripts/tests/agent-generic-20260909-011.test.mjs` 相关断言通过；完善批次领取/回执/核对流程（`atb refine next/done/check`）行为不受提示词调整影响。
