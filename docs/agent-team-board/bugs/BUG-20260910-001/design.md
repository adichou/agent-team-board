# 设计 — BUG-20260910-001 批量完善的提示词还有 zcode 的词语，请修复，一并排查下其他类似地方的实现

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260909-011（提示词通用化只改了生成层 `buildRefinePrompt` / `generatePrompt`，未处理存量账本冻结文本；BUG-20260909-017 补的展示层归一 `normalizePromptModelLine` 只覆盖旧模型行，未覆盖执行端段与领取前缀——两个遗留叠加形成本 Bug）。已核验存在（atb list / scripts/tests/agent-generic-20260909-011.test.mjs、bug-model-line-20260909-017.test.mjs）。

## 根因分析

1. **账本冻结 + 归一缺口**：批次创建时 `prompt` 冻结进 `batch.json`。REQ-20260909-011 通用化生成层后，存量账本仍是旧口径文本；BUG-20260909-017 的展示层归一 `normalizePromptModelLine`（`scripts/lib/task-settings.mjs`）只整行替换「子代理模型配置：…（来自设置「批量任务」…）」，不处理「执行 Agent：zcode。在 Zcode 本项目新建会话…general-purpose 子 Agent…」段、「子代理会话命名统一为：<批次号>-refine-<序号>」行与 `--by zcode-refine-` 领取前缀。
2. **批量开发侧完全无归一**：`/api/batch/create`（server.mjs）、`/api/batch/prompt`、`/api/batch/current`（前端「提示词」页签 `#batchPrompt` 数据源）、CLI `atb batch create`（幂等回显）与 `batch summary`（`batchPublicView`）全部返回**原始** `b.prompt`——BUG-20260909-017 的展示归一只做在批量完善路径。存量开发批次 `batch-20260908-018~020` 冻结旧模型行、`batch-20260909-021~025` 冻结 REQ-20260909-005 时代点名 `codex exec --model / model_reasoning_effort` 的旧跟随行，均原样透出。
3. **存量变体盘点**（`refine/batches/*/batch.json` 全量扫描）：
   - 变体 A（RFB-20260908-001~007）：「每轮新启动一个 general-purpose 子 Agent，按执行流程完善本批一个**待接受**条目的文档。」+ `--by zcode-refine-` 领取行；
   - 变体 B（RFB-20260908-008~016、018~022，zcode）：「每轮新启动一个子 Agent…」+「执行 Agent：zcode。在 Zcode 本项目新建会话粘贴本提示词，每轮新启动一个 general-purpose 子 Agent 派发一项，」+「子代理会话命名统一为：<批次号>-refine-<序号>，与主调度会话区分。」（行序存在「执行 Agent 行在前/在后」两种）；
   - 变体 C（RFB-20260909-017，codex）：「执行 Agent：codex。在 codex 会话中执行本提示词；…」+「子会话命名统一为：<条目编号>（如 …）…」+「codex 口径：领取/回执命令在子会话内执行…」。

## 方案

沿用 BUG-20260909-017 的**展示/回显层归一、账本不回写**原则（处置口径见「风险与边界」）。无开源库引入（纯文本逐行归一，自研；无合适库——项目内既定归一模式即本文件级实现）。

### 1. 归一函数（`scripts/lib/task-settings.mjs`）

新增 `normalizePromptForDisplay(prompt)`（`normalizePromptModelLine` 保留为模型行归一的内部一步，既有调用点全部切换到新函数）：

- R1 旧模型行（既有）：`/^子代理模型配置：.*来自设置「批量任务」.*$/` → `FOLLOW_SESSION_PROMPT_LINE`；
- R2 旧跟随行（新）：以「子代理模型与智能/推理档位：跟随主调度会话」开头且不等于现行 `FOLLOW_SESSION_PROMPT_LINE`（点名 `codex exec` 的 REQ-20260909-005 旧措辞）→ 整行替换为 `FOLLOW_SESSION_PROMPT_LINE`；
- R3 执行端段（新，逐行）：
  - `/^每轮新启动一个( general-purpose)? 子 Agent，按执行流程完善本批一个[待已]接受条目的文档。$/` → 「在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善本批」；其后紧邻的首个非删除行若为「子代理会话命名…」行，则保持两行拆分（与现行 `buildRefinePrompt` 逐字一致），否则输出单行完整句「…完善本批一个已接受条目的文档。」；
  - `/^执行 Agent：\S+。/` 开头且含「派发一项」的行 → 删除（zcode/codex 变体均覆盖）；
  - `/^子代理会话命名统一为：.*-refine-<序号>，与主调度会话区分。$/` 与 `/^子会话命名统一为：<条目编号>/` → 「一个已接受条目的文档。子代理会话命名统一为：<条目编号>（与主调度会话区分）。」（非相邻变体落到句尾时不带前缀句，仅输出命名行）；
  - `/^codex 口径：领取\/回执命令在子会话内执行（工作目录用 --dir .*）指定）；$/` → 「领取/回执命令在子代理会话内执行（工作目录用 --dir 指定）。」；
- R4 领取前缀（新，字符串级）：`--by zcode-refine-` / `--by codex-refine-` → `--by refine-`（前缀仅为会话标识字符串，不影响锁与账本语义——与 REQ-20260909-011 固定单一通用前缀同口径）。

幂等：对现行 `buildRefinePrompt` / `generatePrompt` 输出不做任何改动；非字符串原样透传。归一后全文不含 `zcode|Zcode|codex|Codex|general-purpose` 字样。

### 2. 透出点切换（全部过 `normalizePromptForDisplay`，新建路径幂等无回归）

批量完善：`refineBatchPublicView`（refine-store.mjs）、`/api/refine/create`（server.mjs）、CLI `refine create`（atb.mjs）——原 `normalizePromptModelLine` 调用升级。
批量开发：`/api/batch/create`、`/api/batch/prompt`、`/api/batch/current`（server.mjs）、CLI `batch create` 与 `batchPublicView`/`batch summary`（atb.mjs）——原始 `b.prompt` 全部改过归一。

### 3. 类似地方处置结论（README 排查清单逐项）

1. 批量开发透出接口：**修**（上文 2）。
2. oncall 派单提示词（「复制到 Zcode 本项目新会话发送」、`--mode zcode`）：**不修**。oncall 双模式（zcode 手动粘贴 / codex 服务端执行）是真实功能分叉，`--mode zcode` 输出的提示词确实要复制到 Zcode 会话发送，文案是对真实操作的准确指引而非残留；通用化反而丢失操作指向。
3. worker-spec 插件源 `skills/agent-team-board/worker-spec.md`：**修**——标题去「Zcode worker」、适用行与领取示例 `--by zcode-batch-<批次尾号>-<序号>` 通用化为 `--by batch-<批次尾号>-<序号>`（与 refine 侧 `refine-` 通用前缀同口径，前缀仅为会话标识不影响锁与账本），使后续批次快照不再带执行端字样。项目内按批冻结的存量快照 `docs/agent-team-board/dispatch/worker-spec.md` **不动**（按批冻结的历史事实源）。
4. 插件命令/技能文档：`skills/agent-team-board/SKILL.md` 约 81-82 行「启动时选执行 Agent（zcode / codex）→ …按 Agent 差异化的主调度提示词」为 REQ-20260909-011 已移除的旧功能描述：**修**（改为现行通用口径）；`commands/dev.md` 14 行 claim 示例 `--by zcode-<任务关键词>`：**修**为中性语义名示例。SKILL.md 约 107 行会话名约定（`zcode-login-view` 等为「工具/语义名」示例而非执行端绑定，且明示两种工具名对等）：**保留不修**。
5. README 第 58-62 条排除项（app.js 内部兼容映射/深链/UI 提示文案、锁 kind、测试夹具）：维持排除，不改。

## 风险与边界

- **存量账本处置（README「待确认」→ 定论：不回写）**：批次账本是冻结的历史事实源，记录当轮真实派发口径；回写历史账本违背账本语义且无必要——展示/回显层已全部归一。沿用 BUG-20260909-017 同一处置（其测试已固化「账本文件不回写」断言）。
- **在途执行不受影响**：`--by` owner 与提示词前缀仅为会话标识字符串；`zcode-refine-*` 旧前缀 run 与新前缀 run 的领取/回执互认不受归一影响（`releaseRefineLockIf` 按 runId/owner 匹配，回执按 runId）。归一只发生在展示/回显出口，不触碰领取、回执、核对逻辑。
- **误替换边界**：R1-R3 均为冻结提示词的整行精确形态匹配（存量全量扫描验证），不按子串模糊替换；R4 仅替换 `--by ` 后的前缀字面量，不碰其余文本。现行输出幂等（不匹配任何规则）。
- 测试：新增 `scripts/tests/prompt-legacy-words-20260910-001.test.mjs`（三变体归一、幂等、账本不回写、refine/develop 全透出链路、插件源契约、旧前缀 run 回执互认）；回归 `bug-model-line-20260909-017`、`agent-generic-20260909-011`、`model-follow-session-20260909-005` 及 refine/batch 既有测试。
