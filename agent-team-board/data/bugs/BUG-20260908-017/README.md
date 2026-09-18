# BUG-20260908-017 Bug 单的说明完善如果设计 UI 部分也要提供 UI Demo

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260908-021（完善阶段 UI 演示口径仅限定需求类型，bug 分支未同步；启发式源自 REQ-20260908-015，refine 流程源自 REQ-20260907-003）
- 创建：2026-09-08T13:08:18.657Z

## 现象

批量完善（refine）流程中，涉及 UI 的 Bug 单不需要提供 UI Demo，与需求单口径不一致：

- 完整性分析 `analyzeItemDocs`（`scripts/lib/refine-store.mjs`）只对 `type === 'requirement'` 做「界面展示」节与 `ui-demo.html` 演示三查（缺文件 / 占位文件 / 节未链接）；bug 分支只检查 现象 / 复现 / 期望 / 验收 四节，完全没有 UI 演示相关检查。
- 完善提示词（`refine-store.mjs` 的 `buildRefinePrompt` / `buildRefineWorkerPrompt`）与项目内 `skills/agent-team-board/SKILL.md`（批量完善节）的口径均为「Bug 补现象/复现/期望/验收」，UI 演示口径（REQ-20260908-021）仅限定「涉及 UI 的需求」。

结果：一个现象为界面问题的 Bug（如显示错乱、交互异常、状态反馈缺失类缺陷）在完善批次中补成纯文字说明即可回执 done、被记「已完善」；而同样含 UI 关键词的需求单会被报「涉及 UI 需界面展示 / 涉及 UI 缺 ui-demo.html 演示」等缺失原因。Bug 的界面缺陷只能靠文字描述，缺少可交互演示，与 REQ-20260908-021（完善时的 UI 设计要用 html 可交互展示）的意图不对齐。

## 复现步骤

前置：项目 `/Users/adichou/Documents/src/agent-team-board`，看板数据 `docs/agent-team-board/`。

1. 登记一个涉及 UI 的 Bug：标题或描述含 UI 关键词（如「按钮置灰态缺失」「弹窗布局错乱」），并接受（accepted）。
2. 在看板创建完善批次（RFB），随后领取：
   `node scripts/atb.mjs refine next --by <owner> --dir .`
3. 子代理按提示词补全该 Bug 的 现象 / 复现步骤 / 期望行为 / 验收说明 四节，不创建 `ui-demo.html`。
4. 回执：`node scripts/atb.mjs refine done <RUN-ID> --summary "..."` —— 回执成功，条目在 `refine/states.json` 被置「已完善（refined）」。
5. 对比验证：同样含 UI 关键词的需求单，`analyzeItemDocs` 会报 UI 演示相关缺失原因（见 `scripts/tests/refine-store.test.mjs` 的演示三查断言）；而步骤 4 的 Bug 单全流程无任何 UI 演示提示。

## 期望行为

涉及 UI 的 Bug 单在说明完善阶段与需求单同等对待，也需要提供 UI Demo：

1. 完善提示词（主调度 `buildRefinePrompt` 与单项 `buildRefineWorkerPrompt`）明确：Bug 若涉及 UI（现象为界面问题，或修复会改动界面），除补 现象 / 复现步骤 / 期望行为 / 验收说明 外，同样须在条目目录创建可交互 `ui-demo.html` 演示，并在 README 相应位置链接 `./ui-demo.html`；演示质量门槛与 REQ-20260908-021 对需求的要求一致（单文件、内联 CSS/JS、无外网依赖、无构建步骤、浏览器直接打开可交互）。
2. Bug 演示内容建议能对照展示「缺陷现象」与「期望修复后状态」（如通过状态切换/开关对比），便于人工核对——已定案为提示词层面的建议口径（非机器强制），见 design.md 方案第 4 条。
3. 完整性分析对 bug 类型同步增加 UI 演示检查——已定案：复用需求侧 UI 关键词启发式（同一 `UI_KEYWORDS` 词表，探测文本为 现象+期望行为 节）；缺失原因文案、README 链接位置与节名均与需求侧同构（`## 界面展示` 节链接 `./ui-demo.html`），见 design.md 方案第 1~3 条。
4. 不涉及 UI 的 Bug 不受影响，仍只补四节，不强制演示（与需求侧「不涉及界面改动」兜底口径对齐）。

## 验收说明

1. 用一个涉及 UI 关键词的已接受 Bug 走完整 refine 流程：领取后缺失原因中出现 UI 演示相关提示（文案与需求侧同构，如「涉及 UI 需界面展示」「涉及 UI 缺 ui-demo.html 演示」，见 design.md 定案）；只补四节不建演示时完整性口径仍报 UI 演示缺失，补全四节 + `ui-demo.html`（README 链接 `./ui-demo.html`）后完整性判定通过、`refine done` 回执成功。
2. 不涉及 UI 的 Bug 回归不受影响：仍只检查 现象 / 复现 / 期望 / 验收 四节，流程与现状一致。
3. 需求单侧回归不受影响：`scripts/tests/refine-store.test.mjs` 既有断言（含 REQ-20260908-021 演示三查、指纹覆盖 `ui-demo.html`）全部通过，并新增 bug 类型 UI 演示检查的对应测试。
4. 提示词与文档口径同步：`scripts/lib/refine-store.mjs` 两处提示词、项目内 `skills/agent-team-board/SKILL.md`（批量完善节）及插件侧同名 SKILL/worker-spec 的「Bug 补现象/复现/期望/验收」表述同步为「涉及 UI 的 Bug 同样需要 UI Demo」口径。
5. 演示应展示的内容形态（缺陷现象 / 修复后对比等）已按 design.md 方案第 4 条定案为提示词建议口径，验收时按定案口径人工打开 `ui-demo.html` 核对可交互性。
