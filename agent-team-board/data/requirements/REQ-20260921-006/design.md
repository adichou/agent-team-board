# 设计 — REQ-20260921-006 优化当前的 AI 分析，AI 开发，AI 完善，AI 总结的提示词，以提升提示词缓存命中率

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

四条流水线提示词均为代码内联拼接（事实源见 README 表格）。逐源核查结论与需求描述一致：

1. 动态值前置：`generatePrompt` 第 2 行即 `项目：<projectRoot>`；`buildRefinePrompt` 同；
   `buildRefineWorkerPrompt` 首两行内嵌条目编号/标题、第 3 行项目根+runId+条目目录+缺失原因；
   `buildDocSummaryPrompt` 首行内嵌计划号/版本号，随后项目路径/runId/关联清单；
   前端 `buildPrompt(v)` 首行内嵌版本号、第 2–3 行为当前名称/描述与逐条关联条目清单。
2. 条件行分叉：模型跟随行（FOLLOW_SESSION_PROMPT_LINE）按 modelSource/model/level 有无两态；
   完善约束段按 autoPlan 开关两态（OFF 单行 / ON 多行，常量见 task-settings）；AI 总结回执命令段与
   执行编号行按 runId 有无条件增删。

## 方案

（技术选型、接口设计、影响面）

### 统一结构：静态段在前 + 尾部「运行参数」区

四个生成器统一为两段式（不改函数签名、不改调用方）：

- **静态段（公共前缀）**：角色行、调度/执行规则、流程、写作约束、回执语义、演示质量门槛等
  不随调用变化的内容。其中随调用变化的实参一律以**占位符**出现在命令模板里
  （`<项目根>`、`<CLI 入口>`、`<RUN-ID>`、`<执行编号>`、`<文件名>` 等）。
- **尾部「运行参数」区**：以 `运行参数（随调用变化，命令占位符以本区实际值为准）：` 行开头，
  集中绑定项目根、atbPath、执行规范路径、条目编号/标题/目录/缺失原因、runId、计划号/版本号、
  默认语言文档清单、关联条目清单、当前版本名称/描述等动态值。

条件行按验收标准「移入参数区或统一恒定形态」收敛：

| 条件行 | 收敛方式 |
| ---- | ---- |
| 模型跟随行 | 移入参数区（有模型入参时在尾部输出；无模型入参不注入——直连调用行为不变） |
| autoPlan 分态约束段 | 整段移入参数区尾部「条目状态约束」小节（OFF 沿 `REFINE_SCHEDULER_KEEP_ACCEPTED_LINE` / `REFINE_WORKER_KEEP_ACCEPTED_LINE` 原行，ON 沿原段，常量不动；OFF 提示词全文仍无「自动转入计划」字样） |
| AI 总结 runId 条件行/回执段 | 统一恒定形态：回执命令段恒以 `<执行编号>` 占位符输出；runId 在参数区绑定（未提供时参数行注明） |

### 各生成器落点

| 生成器 | 文件 | 静态段要点 | 参数区绑定 |
| ---- | ---- | ---- | ---- |
| AI 开发主调度 `generatePrompt` | scripts/lib/batch.mjs | 角色行 + 实时取单/派发/短回执纪律（现行文案不动，仅去内插） | 项目、执行规范、调度核对入口（含 atbPath/projectRoot）、模型跟随行 |
| AI 分析主调度 `buildRefinePrompt` | scripts/lib/refine-store.mjs | 角色行 + 子代理流程（命令占位符化）+ 演示门槛/Bug 分支/待确认/回执语义 + `REFINE_DEMO_PERMIT_LINE` | 项目根、CLI 入口、模型跟随行、条目状态约束（autoPlan 分态段） |
| AI 分析单项 `buildRefineWorkerPrompt` | scripts/lib/refine-store.mjs | 会话命名指令（占位符）+ 补全要求 1–3（`<RUN-ID>` 占位）+ 禁令行 | 条目编号/标题、项目根（codex -C 说明随行）、执行编号、条目目录、缺失原因、CLI 入口、条目状态约束（含原「3.」约束行 + test-report/git commit 禁令续行） |
| AI 总结 `buildDocSummaryPrompt` | scripts/lib/publish-flow.mjs | 角色行 + 阶段说明（4 文档/4 类 × 1 恒定）+ 恒定回执命令段（`<执行编号>`/`<文件名>` 占位）+ 写作约束（README 链接提示 `README.md → CHANGELOG.md / FEATURES.md` 为默认语言恒定形态） | 项目路径、计划号/版本号、执行编号、CLI 入口、默认语言文档清单（语言集首语言 + 显示名）、关联范围清单 |
| AI 完善 `buildPrompt` | scripts/web/build.js（前端本地） | 任务句（版本号让位参数区）+ 综合要求 + 回答格式（`版本名称：<一行>` / `版本描述：<可多行>` 不动） | 看板版本、当前信息（名称/描述）、关联条目清单（编号 + commit 短 hash） |

### 兼容与零回归口径

- **语义不变**：各流程调度、领取（claim/next）、回执（done/fail/hold/release/check）、锁与账本字段
  均不动；只重组提示词文本。命令模板占位符化后实际值在参数区给出，Agent 执行的 CLI 实参不变。
- **存量账本**：冻结在 batch.json / refine run 记录里的旧提示词不回写；展示/回显层
  `normalizePromptForDisplay` 对新输出保持幂等（新行不命中任何旧形态整行规则、全文无「批次」等
  归一触发词），对旧冻结形态的既有归一规则不动；autoPlan 双向分态归一沿用原常量（整段连续行匹配，
  与新位置无关）。
- **接口形态**：`buildRefineWorkerPrompt` 的 `条目目录：`、`缺失原因：`、`执行编号：` 仍为整行
  稳定形态（移入参数区但行格式不变）；`parseAnswer` 的「版本名称：/版本描述：」约定不变。
- **依赖提示词形态的测试夹具同步更新**：bug-build-session-entry-20260913-005（AI 完善复制断言
  「请为看板版本 <ID>」改为新形态锚点）；其余既有断言均为包含式，随新组织自然满足。

**开源选型（REQ-20260909-015）**：本需求为纯文本组织重构，无合适开源库可用（自研理由：无库依赖）；
未引入任何依赖，不创建 licenses.md。

## 风险与边界

- 提示词是「接口」：占位符化命令要求 Agent 自行代入参数区的值——通过「占位符以本区实际值为准」
  显式指引降低误用风险；回执/锁/状态机不依赖提示词解析（服务端不解析提示词文本，仅透传展示）。
- 缓存命中率本身依赖 Agent 会话环境（项目内不可观测），验收以结构断言为准（README「待确认」已声明）。
- AI 翻译（buildDocTranslatePrompt）与官网写作（buildSiteWritingPrompt）不在本需求四条流水线范围内，
  不做重组（翻译提示词嵌入基准全文，天然逐次不同）。
