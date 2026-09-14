# 设计 — REQ-20260908-015 需求完善功能只需完善说明文档即可，设计文档是开发时需要写的。说明文档需要有 UI 设计，需要有界面展示。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- **完善判定与提示词现状**（scripts/lib/refine-store.mjs）：`analyzeItemDocs()`（L137-190）对 requirement 在 README 之外还检查 design（缺失 / 仅模板，L168-178）与 test-cases（缺失 / 无用例，L179-187），`refineCandidates()`（L207）据此决定哪些 submitted 条目进入完善批次；`buildRefinePrompt`（L276）与 `buildRefineWorkerPrompt`（L299）两处文案「需求补 README（描述+验收标准）/design/test-cases」。
- **两阶段分工**：design.md 是 /dev 实施阶段的方案与实施记录（SKILL.md「TDD 开发流程」第 2 步、commands/dev.md、worker-spec.md 第 2 步）；test-cases.md 用例按 TDD 在 /dev 阶段「补用例跑红」（SKILL.md 第 4 步）。完善阶段（条目仍是 submitted、尚未接受）写 design 没有实施依据，只会产出模板内容。
- **UI 质量前置**：REQ-20260903-001 已要求涉及 UI 的需求在 README 讲清界面布局、交互行为与状态反馈（SKILL.md 铁律 5、commands/req.md 步骤 2）；本需求在其上追加「界面展示」（README 内嵌 ASCII 线框 / 结构示意），使人工接受前能看到界面形态。
- **相关既有需求**：完善功能本身出自 REQ-20260907-003（refine 子命令与批次账本）；完善面板入口复用待接受多选（REQ-20260907-004 统一新建 / 面板体系）。

## 方案

（标〔待确认〕处为实施前需人拍板的决策点，其余为建议方案）

### 1. 判定收敛到 README（scripts/lib/refine-store.mjs）

- `analyzeItemDocs()`：requirement 分支删除 design、test-cases 两段检查（L168-188），只保留 README 的描述 / 验收标准 / 说明过简三项；Bug 分支（现象 / 复现 / 期望 / 验收）完全不动。
- 新增「界面展示」判定（两层，均只作用于 requirement）：
  1. **启发式**：README「描述」节命中 UI 关键词（建议词表：界面、UI、页面、弹窗、面板、按钮、输入框、布局、拖拽、抽屉、顶栏等，最终词表〔待确认〕）且 README 无「界面展示」节 → reasons 增加「涉及 UI 需界面展示」；
  2. **存在性**：README 已含「界面展示」节时，正文剥空行与「（待补充）」占位后为空（复用既有 `bodyMeaningful()`）→ reasons 增加「界面展示待补充」。
- `refineCandidates()` 无需单独改：complete 判定来自 `analyzeItemDocs`，原因集合变化自动传导到 `atb refine next` 的缺失原因输出与完善面板候选列表（/api/refine/candidates）。

### 2. 指引与文案同步

- refine-store.mjs L276（buildRefinePrompt）与 L299（buildRefineWorkerPrompt）：文案改为「需求只补 README：描述 + 验收标准；涉及 UI 时须含界面布局、交互行为、状态反馈与界面展示（ASCII 线框 / 示意）。design/test-cases 留待开发阶段」；Bug 半句不变。
- scripts/atb.mjs：`refine next` 输出的「下一步」行（L584 附近）与 REFINE_USAGE / refine 用法文本（L91-100、L514-525）同步口径。
- commands/req.md 步骤 2：在「涉及 UI 时必须在描述中讲清界面与交互设计」后追加「并在 README 提供『界面展示』（ASCII 线框 / 结构示意）」。
- skills/agent-team-board/SKILL.md：数据规范（L26 需求四件套分工说明）与铁律 5（L49）补「界面展示」要求；worker-spec.md 不动（开发阶段本来就读全部文档）。
- scripts/tests/fixtures/fake-codex.mjs L307：输出语句「已补全文档：按缺失原因补全 README/design/test-cases」改为与新口径一致。

### 3. 刻意不改的部分

- **DOC_FILES 与 docsFingerprint**（refine-store.mjs L37 / L193）：基线与「文档确有变更」核验继续覆盖三文档——worker 只改 README 时指纹必然变化，`refine done` 核验（L628）不受影响；同时避免「只改 design/test-cases 也记完成」的记账歧义。
- **checkRefineBatch / finishRefineRun / 批次账本**：不感知文档判定口径，无改动。
- **README 生成模板**（scripts/lib/core.mjs createItem，L330 附近「（待补充）」模板）：不强制生成「界面展示」节——非 UI 需求不需要，避免模板噪音；节由 /req 创建或完善 worker 按 UI 判定按需添加。

## 兼容性

- 存量已冻结批次的 `candidates[].reasons` 是创建时快照，不回溯重算；在途运行的 done/fail/release 与指纹核验行为不变，批次照常收尾。
- 新批次起，「design 仅模板 / test-cases 无用例」不再作为缺失原因出现；README 已完整的条目不再入候选。完善面板（scripts/web/app.js `refineReasonsHtml`）按 reasons 通用渲染，无需改界面代码。
- 历史上已写入条目目录的 design/test-cases 内容不清理、不回滚——它们仍是开发阶段的合法底稿。

## 风险与边界

- **关键词启发式会误判**：漏判（描述不用关键词的 UI 需求）只会少一段展示，仍有人工接受把关；误判（流程类描述提到「面板」「看板」等词）会多要求一段界面展示，worker 误解时可在该节写「本需求不涉及界面改动」之类说明。词表口径〔待确认〕，实现时定案并固化为测试断言。
- **界面展示的质量无法机检**：线框是否达意只能靠人工接受时判断，与 REQ-20260903-001「接受即视为设计认可」的既有口径一致。
- **test-cases 移出完善范围的口径**来自标题「只需完善说明文档即可」的整体表述；若人工意图仅移出 design 而保留 test-cases，请接受前批注，验收标准第 1、2 条需相应收窄。

## 实施记录

（2026-09-08，zcode-batch-016-1 / batch-20260908-016，TDD：先写用例跑红再实现跑绿）

### 代码改动

- **scripts/lib/refine-store.mjs**
  - `analyzeItemDocs()`：删除 requirement 分支的 design（缺失/仅模板）与 test-cases（缺失/无用例）检查；新增「界面展示」两层判定（均仅作用 requirement，且只在 README 存在时执行）：
    1. 启发式：描述节命中 UI 关键词且 README 无「界面展示」节 → `涉及 UI 需界面展示`；
    2. 存在性：节已存在但正文剥空行/「（待补充）」占位后为空（复用 `bodyMeaningful()`）→ `界面展示待补充`。
  - **词表定案**（design 方案 1 的〔待确认〕决策点，按建议词表落地并固化为 refine-store 测试 S5 逐词断言）：
    `界面、UI、页面、弹窗、面板、按钮、输入框、布局、拖拽、抽屉、顶栏`；其中「UI」按大写原样匹配，避免小写 ui 命中英文单词子串（require/build/guide）造成误判。误判兜底见方案风险节：节内写明「本需求不涉及界面改动」即视为有效内容（测试 S6 覆盖）。
  - `buildRefinePrompt` / `buildRefineWorkerPrompt`：补全指引改为「需求只补 README：描述 + 验收标准；涉及 UI 时须含界面布局、交互行为、状态反馈与界面展示（README 内嵌 ASCII 线框 / 结构示意）……design/test-cases 留待开发阶段；Bug 补现象/复现步骤/期望行为/验收说明」。
  - `docsFingerprint`/`DOC_FILES` 刻意不动（仍覆盖三文档），仅更新注释说明理由。
- **scripts/atb.mjs**：顶部 refine 用法头行、`REFINE_USAGE` 追加「完善口径」说明行；`refine next` 文本输出的「下一步」行按条目类型给出新口径（需求只补 README + 界面展示 / Bug 四项）。
- **commands/req.md** 步骤 2：追加「并在 README 提供『界面展示』——内嵌 ASCII 线框 / 结构示意」。
- **skills/agent-team-board/SKILL.md**：数据规范需求四件套行（README 标注界面展示要求，design/test-cases 标注开发阶段补）与铁律 5（并入 REQ-20260908-015 与界面展示要求）。
- **scripts/tests/fixtures/fake-codex.mjs**：refine worker 最终回复改为「已补全说明文档：按缺失原因补全 README（涉及 UI 需含界面展示）」。

### 测试

- refine-store.test.mjs：更新 R1（design/test-cases 原因不再出现）、`fillReqDocs`（描述含 UI 关键词 → README 补「界面展示」节）；新增 S1/S2（判定收敛，含文件删除态）、S3（README 三项回归）、S4（Bug 四项回归 + 不引入界面展示）、S5（词表逐词触发）、S6（占位/线框/误判兜底）、S7（非 UI 不误伤）、S8（候选与排序）、S9（指纹仍覆盖三文档、仅改 README 可记账）、S10（存量批次快照不重算）、P1（两处提示词断言）。
- refine-cli.test.mjs：新增 R10c——README 完整（design 模板态）时 `refine create` 报「没有可完善候选」，`refine next`「下一步」行含「只补 README/界面展示」且不再出现 `/design/test-cases`。
- refine-serve.test.mjs：R11 增加 UI 描述条目（`atbNew` 支持 `--desc`），断言 `/api/refine/candidates` 需求候选无 design/test-cases 原因、UI 条目含「涉及 UI 需界面展示」；相关计数 2→3。
- 全量 `scripts/tests/run-all.mjs`：87 个测试文件全部通过（dispatch-api 首轮一次偶发失败，单独与整体各重跑两次均通过，与本次改动无关——本次未触及 dispatch 代码路径）。

### 未做 / 边界

- README 生成模板（core.mjs `reqReadme`）不强制生成「界面展示」节（方案 3 既定：避免非 UI 需求模板噪音）。
- 完善面板前端无代码改动（`refineReasonsHtml` 通用渲染，仅显示的原因集合变化）。

