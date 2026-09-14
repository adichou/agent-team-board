# BUG-20260910-001 批量完善的提示词还有 zcode 的词语，请修复，一并排查下其他类似地方的实现

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-09T16:00:28.578Z

## 现象

REQ-20260909-011 已将批量完善主调度提示词通用化（单一版本、不按执行 Agent 分叉），但用户实际拿到的提示词仍含 zcode 专属词语：

1. **在途完善批次账本冻结了 zcode 旧口径提示词**：`docs/agent-team-board/refine/batches/RFB-20260909-022/batch.json`（状态 running，创建于 2026-09-09T01:00:47.586Z，早于 REQ-20260909-011 落地）的 `prompt` 字段含三处 zcode 字样：

   > 执行 Agent：zcode。在 Zcode 本项目新建会话粘贴本提示词，每轮新启动一个 general-purpose 子 Agent 派发一项，
   > 子代理会话命名统一为：RFB-20260909-022-refine-<序号>，与主调度会话区分。
   > …
   > 1. 领取：atb refine next --by zcode-refine-<批次尾号>-<序号> --dir "…"

   - 「执行 Agent：zcode。在 Zcode 本项目新建会话…」把执行端硬绑为 Zcode，与 REQ-20260909-011「提示词通用，可在任意一种 Agent 会话粘贴执行」的新口径（现行 `buildRefinePrompt` 输出为「在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理…」）矛盾；
   - 「general-purpose 子 Agent」是特定工具的子代理类型名，其他执行端无此概念；
   - 领取前缀 `zcode-refine-…` 为旧双前缀口径（现行代码 `scripts/lib/refine-store.mjs` 约 368–370 行已固定单一通用前缀 `refine`，注释明确「前缀仅为会话标识字符串，不影响锁与账本语义」）。

2. **展示层归一缺口，旧字样持续透出**：BUG-20260909-017 为存量批次加的展示层归一只处理模型行——`normalizePromptModelLine`（`scripts/lib/task-settings.mjs` 约 40–47 行）仅整行替换「子代理模型配置：…（来自设置「批量任务」…）」，不碰「执行 Agent：zcode…」段与 `--by zcode-refine-…` 领取行。透出路径：

   - 看板任务模块「批量完善」→「提示词」页签直接渲染归一后的 `batch.prompt`（`scripts/web/app.js` `<pre id="refinePrompt">`，约第 4284 行），「重新复制」按钮（`#refineRecopy`，约第 4282 行）复制的也是该文本；
   - 服务端 `/api/refine/summary`（`scripts/server.mjs` 约 1634 行，经 `refineBatchPublicView` 仅归一模型行）与 `/api/refine/create` 幂等返回（约 1612 行）；
   - CLI `atb refine create`（`scripts/atb.mjs` refine create 分支，幂等返回时回显 prompt）与 `atb refine summary`。

3. **旧提示词仍在驱动实际派发**：主调度会话正按该冻结提示词执行本轮（RFB-20260909-022）——在途子代理领取前缀均为 `zcode-refine-022-N`（如当前 run owner `zcode-refine-022-4`），即 zcode 旧口径不只残留于展示，还在持续约束新派发子代理的会话命名与领取标识。

4. **新建路径无此问题**：`buildRefinePrompt`（`scripts/lib/refine-store.mjs` 约 359–404 行）现行输出已不含任何 zcode/Zcode/general-purpose 字样——问题集中在存量账本冻结文本与展示层归一缺口，新建批次无回归风险。

## 复现步骤

1. 打开项目看板（Status Board）→ 任务模块 →「批量完善」页签（当前存在未结束批次 RFB-20260909-022）。
2. 切到该批次「提示词」二级页签（或点「重新复制」把提示词复制到剪贴板）。
3. 在提示词全文中搜索「zcode / Zcode / general-purpose」，可命中：
   - 「执行 Agent：zcode。在 Zcode 本项目新建会话粘贴本提示词，每轮新启动一个 general-purpose 子 Agent 派发一项，」；
   - 「1. 领取：atb refine next --by zcode-refine-<批次尾号>-<序号> …」。
4. （CLI 路径）执行 `node scripts/atb.mjs refine create --dir <项目根>`（幂等返回在途批次并回显 prompt）或 `node scripts/atb.mjs refine summary --dir <项目根>`，回显文本同样含上述字样。
5. （账本级佐证）直接查看 `docs/agent-team-board/refine/batches/RFB-20260909-022/batch.json` 的 `prompt` 字段，比对 `scripts/lib/refine-store.mjs` `buildRefinePrompt` 现行生成的通用版（「在当前项目的 Agent 会话中执行本提示词…」「--by refine-<批次尾号>-<序号>」），确认差异即存量冻结文本。

## 期望行为

- 用户从批量完善各入口（看板提示词页签 / 重新复制 / `/api/refine/summary` / `/api/refine/create` 幂等返回 / CLI `refine create`、`refine summary`）拿到的存量批次提示词，不再含执行端专属词语：
  - 「执行 Agent：zcode。在 Zcode 本项目新建会话…general-purpose 子 Agent…」段按 REQ-20260909-011 通用口径归一（对齐现行 `buildRefinePrompt` 的「在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理…」「子代理会话命名统一为：<条目编号>」表述）；
  - 「--by zcode-refine-<批次尾号>-<序号>」领取行归一为通用前缀「--by refine-<批次尾号>-<序号>」（前缀仅为会话标识，不影响锁与账本语义）。
- 新建完善批次提示词保持现行通用版输出，无回归。
- 存量账本文件（`refine/batches/*/batch.json` 的 `prompt`）本身是否回写：**待确认**——沿用 BUG-20260909-017「仅展示/回显层归一、账本原样保留」原则，还是随修复重写账本，由修复阶段在 design.md 明确，不强行编造处置方式。
- 在途批次 RFB-20260909-022 已按旧前缀领取的 run（owner `zcode-refine-*`）与后续按新前缀领取的 run 应能正常回执互认，领取/回执/核对流程不受归一影响。
- 「一并排查的其他类似地方」逐处给出处置结论（修复或明确不修的理由），见下节排查清单。

## 类似地方排查（一并修复范围）

1. **批量开发展量批次冻结提示词点名 codex 参数**：`docs/agent-team-board/dispatch/batches/batch-20260909-021` ~ `025` 的 `prompt` 中「跟随主调度会话」行仍是 REQ-20260909-005 时代旧措辞，点名「支持显式指定的执行端（如 codex exec 的 --model / model_reasoning_effort）…」；现行 `FOLLOW_SESSION_PROMPT_LINE`（`scripts/lib/task-settings.mjs` 约 27–36 行）已通用化不再点名执行端。且开发侧两个透出接口 `/api/batch/create`（`scripts/server.mjs` 约 1424 行）与 `/api/batch/prompt`（约 1461 行）返回 **原始** `b.prompt`，连 `normalizePromptModelLine` 都未过——批量完善已做的展示归一在批量开发路径上完全缺失。
2. **oncall 派单提示词**：`atb oncall dispatch --mode zcode` 输出「复制到 Zcode 本项目新会话发送」（`scripts/atb.mjs` 约 537 行），oncall 主调度提示词回传步骤固定 `--mode zcode`（`scripts/lib/oncall-store.mjs` 约 491 行）。oncall 双模式（zcode 手动粘贴 / codex 服务端执行）本身按端分叉属功能语义，是否属本 Bug「类似地方」需要一并处理：**待确认**。
3. **批量开发执行规范 worker-spec**：插件源 `skills/agent-team-board/worker-spec.md`（标题「批量开发执行规范（Zcode worker）」、领取示例 `--by zcode-batch-…`）与项目内冻结快照 `docs/agent-team-board/dispatch/worker-spec.md` 同款。规范按批冻结，存量快照不动；插件源文件是否随本 Bug 通用化（使后续批次快照不再带 Zcode 字样）：**待确认**。
4. **插件命令/技能文档示例**：`commands/dev.md` 认领示例 `--by zcode-<任务关键词>`；`skills/agent-team-board/SKILL.md` 约 81 行「启动时选执行 Agent（zcode / codex）」为 REQ-20260909-011 已移除的旧口径、约 107 行 claim 示例含 zcode。属文档口径问题，是否一并修：**待确认**。
5. **明确排除（非残留、不改）**：
   - `scripts/web/app.js` 内部兼容逻辑：`state.refine.mode` 缺省 `'zcode'`（约 549 行）、旧 `'zcode'` 入口映射 develop（约 3188 行）、`taskAgentModeText` 对存量批次显示「执行 Agent zcode（子代理模式）」（约 3005 行，REQ-20260909-011 明确保留的口径）——为代码内部标识/兼容映射，非提示词文案；
   - `zcode://workspace/open` 深链与「打开 Zcode 工作区」按钮属工作区入口功能，其增删属另一条目（候选中「任务模块中的提示词要新增打开 zcode 工作区和打开 codex 工作区」），不在本 Bug 范围；
   - `acquireRefineLock({ kind: 'zcode' })`（`scripts/lib/refine-store.mjs` 约 762 行）为内部锁类型标识；`scripts/tests/` 下 zcode 断言为测试夹具；
   - `scripts/web/app.js` 批量开发面板文案「立即停止正在运行的工具请到 Zcode 原生任务界面操作」（约 4147 行）为 UI 提示文案而非提示词，仅登记供人工判断，不默认纳入本 Bug。

## 验收说明

1. 看板「批量完善」在途批次（含 RFB-20260909-022 及 2026-09-09 通用化之前创建的存量批次）的「提示词」页签与「重新复制」输出，全文检索不到「执行 Agent：zcode」「Zcode」「zcode-refine」「general-purpose」字样（或按 design.md 声明的处置口径执行并说明）。
2. `node scripts/atb.mjs refine create --dir <项目根>`（幂等返回）与 `refine summary` 回显的提示词满足第 1 条。
3. 新建完善批次 `docs/agent-team-board/refine/batches/<新批次>/batch.json` 的 `prompt` 与 `buildRefinePrompt` 现行通用输出一致（无回归）。
4. 归一不破坏在途执行：RFB-20260909-022 已有 `zcode-refine-*` 前缀的 run 可正常 `refine done/fail/release`；`atb refine next/done/check` 流程行为不变。
5. 类似地方排查结论落地：批量开发两条透出接口（`/api/batch/create`、`/api/batch/prompt`）至少与批量完善归一口径对齐（存量开发批次提示词不再透出点名 `codex exec` 参数的旧行）；oncall / worker-spec / 文档示例各处在 design.md 有明确「修 / 不修 + 理由」结论。
6. 回归验证：`scripts/tests/agent-generic-20260909-011.test.mjs`、`scripts/tests/model-follow-session-20260909-005.test.mjs` 及批量完善相关既有测试通过。

## 界面展示

**界面布局**：问题界面位于看板（Status Board 网页）任务模块 →「批量完善」一级页签 → 批次运行区 →「提示词」二级页签（`scripts/web/app.js` `renderRefinePanel`，约 4279–4286 行）：顶部为状态行（批次状态 chip + 批次号 + 模式/创建时间/开发人员），其下 `batch-prompt-block` 内含说明行（「主调度提示词（在本项目的 Agent 会话粘贴发送，提示词通用）：」）+「重新复制」按钮 + 全文 `<pre id="refinePrompt">` 提示词块。CLI 侧对应 `atb refine create` 幂等回显与 `refine summary` 输出。

**交互行为**：用户在此页签阅读/复制主调度提示词后粘贴到 Agent 会话执行；「重新复制」重试剪贴板写入（不创建新任务）。缺陷交互路径：用户按提示词中「在 Zcode 本项目新建会话…执行 Agent：zcode…--by zcode-refine-…」旧口径操作，被引导到单一执行端与旧领取前缀，与「提示词通用」的新口径声明自相矛盾。期望交互：同一页签展示/复制得到的文本即为通用版（执行端无关、通用领取前缀），用户可在任意 Agent 会话粘贴执行。

**状态反馈**：提示词页签随批次轮询刷新渲染；存量批次缺失 `prompt` 字段时显示空态说明「暂无调度提示词（存量批次可能缺失）」；面板加载中显示「加载中…」；接口异常经 toast 报错。归一修复后，各状态切换（正常含提示词 / 空态 / 加载 / 失败）下展示与复制的文本均不得再出现 zcode 专属字样。

可交互演示（现状缺陷与期望归一对照、zcode 字样高亮筛查、类似地方排查清单、正常/空/加载/失败四态切换、深浅色适配）：[./ui-demo.html](./ui-demo.html)
