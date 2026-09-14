# REQ-20260908-015 需求完善功能只需完善说明文档即可，设计文档是开发时需要写的。说明文档需要有 UI 设计，需要有界面展示。

- 状态：submitted（待人工接受）
- 创建：2026-09-08T04:26:12.450Z

## 描述

需求完善批次（REQ-20260907-003）现在要求 worker 同时补三份文档，且把 design/test-cases 的模板态当成「待完善」，这与两阶段流程分工冲突；同时涉及 UI 的需求说明文档只有文字描述、没有界面展示，人工在接受前看不到界面形态。本需求调整完善阶段的文档口径：**只完善说明文档 README**，design/test-cases 留给 /dev 开发阶段；并把 UI 需求的说明文档门槛升级为必须带「界面展示」。

### 现状（源码为真实路径）

- **完整性判定混入 design/test-cases**：`analyzeItemDocs(dir, type)`（scripts/lib/refine-store.mjs L137-190）对 requirement 除 README（描述、验收标准、说明过简合计 <30 字）外，还检查 `design 缺失` / `design 仅模板` / `test-cases 缺失` / `test-cases 无用例`，任一命中即整条目被判不完整，经 `refineCandidates()`（同文件 L207）进入完善候选（`atb refine next` 与完善面板 `/api/refine/candidates` 同源）。
- **提示词同样要求三件套**：`buildRefinePrompt`（L276）与 `buildRefineWorkerPrompt`（L299）两处相同文案「需求补 README（描述+验收标准）/design/test-cases」。
- **与 /dev 分工冲突**：design.md 的定位是开发阶段的「方案 / 实施记录」——SKILL.md「TDD 开发流程」第 2 步（实施要点写入 design.md）与 commands/dev.md 同口径；test-cases.md 的用例按 TDD 属开发阶段「补用例并写测试跑红」（SKILL.md 第 4 步、worker-spec.md 第 4 步）。完善阶段尚未实施、没有技术选型依据，提前写 design 只能产出模板化内容。结果是 README 已写清的条目仍被反复拉进完善批次（本条目自身入批原因即含「design 仅模板、test-cases 无用例」）。
- **UI 需求缺界面展示**：REQ-20260903-001 已确立「涉及 UI 的需求必须在 README 描述里讲清界面布局、交互行为与状态反馈——接受即视为设计认可」（SKILL.md 铁律 5、commands/req.md 步骤 2），但 README 只有文字、没有界面的可视化示意，人工在 Status Board 点「接受」前无法直观看到界面长什么样，与「接受即视为设计认可」的定位不匹配。

### 目标

1. **完善阶段只要求补全说明文档 README**：
   - `analyzeItemDocs` 对 requirement 只看 README（描述、验收标准、说明过简），design.md / test-cases.md 不再产生缺失原因、不再影响完善候选；
   - 各级指引同步：`buildRefinePrompt`、`buildRefineWorkerPrompt`、`atb refine next` 输出的「下一步」行（scripts/atb.mjs）改为「需求只补 README」。
2. **说明文档的 UI 门槛升级**：涉及 UI 的需求，README 除界面布局、交互行为、状态反馈外，还必须有**界面展示**——在 README 内嵌 ASCII 线框 / 结构示意图等可视化示意，让人工接受前直观看到界面形态；`/req` 创建命令与完善提示词同步该要求。判定与实现口径见 design.md。

### 影响面

- scripts/lib/refine-store.mjs（判定 + 两处提示词）、scripts/atb.mjs（refine 输出指引与用法文本）、commands/req.md、skills/agent-team-board/SKILL.md、scripts/tests/fixtures/fake-codex.mjs（L307 输出语句）及 refine 相关测试。
- 完善面板（scripts/web/app.js `refineReasonsHtml`）按 reasons 通用渲染，无界面代码改动，仅显示的缺失原因集合变化。
- 本条目自身是流程/工具类需求，无新增界面，故本 README 不含界面展示节；「界面展示」要求仅约束涉及 UI 的需求。

## 验收标准

- [ ] `analyzeItemDocs` 对 requirement 不再输出 `design 缺失` / `design 仅模板` / `test-cases 缺失` / `test-cases 无用例`；README 三项判定（描述、验收标准、说明过简）与 Bug 四项判定（现象 / 复现 / 期望 / 验收）行为不变（回归）。
- [ ] README 已完整的 submitted 需求不再因 design/test-cases 模板态被列入完善候选：`refineCandidates`、`atb refine next`、`/api/refine/candidates` 三处口径一致。
- [ ] 涉及 UI 的需求（判定口径见 design.md）README 缺「界面展示」时产生明确缺失原因（如「涉及 UI 需界面展示」）；README 已含「界面展示」节但为空 / 占位（如仅「（待补充）」）时同样视为待补充。
- [ ] `buildRefinePrompt` / `buildRefineWorkerPrompt` / `atb refine next` 输出指引改为：需求只补 README（描述 + 验收标准；涉及 UI 需含界面布局、交互行为、状态反馈与界面展示），不再出现补 design/test-cases 的要求；Bug 指引（现象 / 复现步骤 / 期望行为 / 验收说明）不变。
- [ ] commands/req.md 步骤 2 与 SKILL.md 相应条目（数据规范、铁律 5）同步「界面展示」要求。
- [ ] refine 相关测试（refine-store / refine-cli / refine-serve / refine-ui 等）按新口径更新并全部通过；fake-codex 夹具输出语句与新口径一致。
- [ ] 存量已冻结完善批次不受影响：`candidates[].reasons` 为创建时快照不回溯重算，在途运行的回执与指纹核验行为不变（见 design.md 兼容性节）。
