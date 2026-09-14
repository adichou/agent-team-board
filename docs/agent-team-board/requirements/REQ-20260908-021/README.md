# REQ-20260908-021 完善需求时的 UI 设计要使用 html 进行可交互设计展示

- 状态：submitted（待人工接受）
- 创建：2026-09-08T09:55:30.073Z

## 描述

REQ-20260908-015 把「涉及 UI 的需求」在完善阶段的门槛定为 README 内嵌 ASCII 线框 / 结构示意。ASCII 线框只能表达静态布局，交互行为（点击后发生什么）与状态反馈（加载/空态/失败态长什么样）仍要靠人工脑补；而「接受即视为设计认可」（REQ-20260903-001，SKILL.md 铁律 5）意味着人工在接受前理应看到可操作的界面形态。项目里已有自发先例：REQ-20260907-004 在条目目录放了交互演示 layout-demo.html 并被 README 链接（`- [交互演示（HTML 片段）](./layout-demo.html)`），但只是个例，完善流程的提示词、判定与核验都没有把 html 交互演示固化为口径。本需求把完善阶段的 UI 设计展示升级为**条目目录内可交互的 html 演示**。

### 现状（源码为真实路径）

- **提示词口径是 ASCII**：`buildRefinePrompt` 与 `buildRefineWorkerPrompt`（scripts/lib/refine-store.mjs L266-340）两处相同文案「（README 内嵌 ASCII 线框 / 结构示意，缺节或占位会被判待完善）」；CLI 侧 `atb refine next` 输出与 refine 用法说明同口径（scripts/atb.mjs L518-533、L588-596）。
- **判定只看 README 节**：`analyzeItemDocs`（refine-store.mjs L146-190）对涉及 UI 的需求两层判定——描述命中 UI 关键词（UI_KEYWORDS，L141-144）且无「界面展示」节 →「涉及 UI 需界面展示」；节存在但为空/占位 →「界面展示待补充」。不感知任何 html 文件。
- **变更核验只覆盖三份 markdown**：`DOC_FILES = ['README.md','design.md','test-cases.md']`（L41），`docsFingerprint`（L195-206）只对这三份做 sha1；`finishRefineRun` 的 done 核验（L697-710）用指纹比对，worker 只新增/修改演示 html 而不动 markdown 时会被判「未检测到补全变更，不能记完成」。
- **worker 约束禁止非 markdown**：两处提示词均写「只编辑条目目录下（的）markdown」（L294、L336），server 侧注释口径同（scripts/server.mjs L838「完善只编辑条目 markdown」）——按现文案 worker 不应创建 html 文件。

### 目标

1. **涉及 UI 的需求，完善阶段须产出可交互 html 演示**：worker 在条目目录创建 `ui-demo.html`（固定命名，便于判定与人工定位；REQ-20260907-004 的 layout-demo.html 为描述性命名的先例，为判定一致性统一为 ui-demo.html）。演示为**单文件** html：内联 CSS/JS、无外网依赖、无构建步骤，浏览器双击即可打开交互；内容覆盖 README 已写清的三要素——界面布局（目标界面的结构化复刻）、交互行为（元素可点击/输入并产生界面变化）、状态反馈（正常/空/加载/失败等状态的切换演示）；深浅色适配可参考 layout-demo.html 的 light-dark 做法。
2. **README「界面展示」节升级为 html 展示入口**：节内须链接 `./ui-demo.html`，并保留界面布局/交互行为/状态反馈的文字说明；ASCII 线框从「必需」降为「可选补充」（用于表达演示中难以呈现的流程性内容）。
3. **判定同步**：涉及 UI 的需求缺 ui-demo.html、或文件为空/占位、或 README 界面展示节未链接该文件时，产生明确缺失原因（原因文案与两层判定的实现口径见 design.md）；「本需求不涉及界面改动」误判兜底保留；Bug 四项判定不变。
4. **变更核验覆盖演示文件**：`docsFingerprint` 纳入 ui-demo.html（存在时），只改演示文件的 done 回执也能通过「真实变更」核验；worker 约束文案改为「只编辑条目目录下的 markdown，涉及 UI 时可另建约定的 ui-demo.html」，其余禁令（业务源码、status.json、claim/report、test-report.md、git commit）不变。
5. **各级指引同步**：skills/agent-team-board/SKILL.md（数据规范 L26、铁律 5 L50、完善流程 L85）与 commands/req.md（L15-17）同步新口径。

### 边界与非目标

- /req 创建新需求时不强制 html 演示：创建时仍可 ASCII 线框，html 演示由完善批次保证补齐；两阶段口径差异在 SKILL.md / commands/req.md 写明。
- Status Board 内嵌可交互预览不在本期：/api/fs/raw 仅支持图片且 CSP `default-src 'none'`（scripts/server.mjs L306-328），html 无法在面板内执行；人工用本地浏览器打开条目目录下的 ui-demo.html 查看（面板文件浏览器可浏览到该文件）。面板是否增加「打开演示」入口：待确认，如需另行立项。
- 完善面板缺失原因展示（scripts/web/app.js `refineReasonsHtml`，L3291-3292）按 reasons 通用渲染，预计无界面代码改动，仅显示的原因集合变化。
- 存量兼容：已完善（refined）条目不回溯进入候选（refineCandidates 过滤，refine-store.mjs L210-227）；已冻结批次候选 reasons 为创建时快照不重算；在途运行的领取/回执/指纹核验行为不变。

### 影响面

scripts/lib/refine-store.mjs（判定 + 两处提示词 + DOC_FILES/docsFingerprint + done 核验）、scripts/atb.mjs（refine next 输出与用法文案）、scripts/server.mjs（仅 L838 注释口径）、skills/agent-team-board/SKILL.md、commands/req.md、scripts/tests/refine-store.test.mjs（S5/S6/P1 等断言）及 refine-cli / refine-serve / refine-ui / tasks-refine 相关测试、scripts/tests/fixtures/fake-codex.mjs（输出语句如涉及）。存量条目目录仅新增文件，无数据迁移。

## 界面展示

本需求自身不改 Status Board 界面；涉及 UI 的部分是新增的演示工件 ui-demo.html，其页面结构约定如下（ASCII 结构示意，开发按各需求的目标界面填充演示区）：

```
┌────────────────────────────────────────────────────────────────┐
│ REQ-xxxx-NNN · <需求标题>                          [◐ 浅/深色] │ ① 演示头
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                     【目标界面演示区】                           │ ② 界面布局
│      按 README 界面布局复刻元素、层级与间距，                      │    与交互
│      元素可点击 / 可输入，操作直接反映到本区                       │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ 状态切换：[正常] [空态] [加载] [失败] ...                        │ ③ 状态反馈
│ 交互说明：点击「××」→ 演示区切换到 ××（对应 README 交互行为）      │    与说明
└────────────────────────────────────────────────────────────────┘
```

- 界面布局：② 区为目标界面的结构化复刻（元素、层级、布局比例），用真实文案示例，不接真实数据。
- 交互行为：② 区内按钮/输入/切换等元素绑定演示态行为，点击后演示区进入对应状态；① 区外观切换按钮可在浅色/深色间切换。
- 状态反馈：③ 区状态切换条逐一切换 README「状态反馈」所列状态（至少覆盖正常态与一个异常态），供人工接受前逐状态查看。
- 打开方式：本地浏览器直接打开条目目录下的 ui-demo.html（单文件、无外网依赖、无构建步骤）；Status Board 内不做内嵌执行（见边界节）。

## 验收标准

- [ ] `buildRefinePrompt` / `buildRefineWorkerPrompt` / `atb refine next` 输出与用法文案改为：涉及 UI 的需求完善时，界面展示须为条目目录下的可交互 html 演示（README 写清布局/交互/状态反馈并链接 `./ui-demo.html`），不再只写「README 内嵌 ASCII 线框 / 结构示意」；Bug 指引（现象/复现步骤/期望行为/验收说明）不变。
- [ ] worker 约束文案允许在条目目录创建约定的 ui-demo.html；其余禁令（业务源码 / status.json / claim/report / test-report.md / git commit）保持；refine 不占 impl.lock 行为不变。
- [ ] `analyzeItemDocs` 对涉及 UI 的需求：缺 ui-demo.html、文件为空/占位、或 README 界面展示节未链接该文件时，输出明确缺失原因；非 UI 需求与 Bug 判定回归不变；「本需求不涉及界面改动」兜底保留。
- [ ] `docsFingerprint` 覆盖 ui-demo.html（存在时纳入哈希）：只新增/修改演示文件的 done 回执能通过「真实变更」核验；三份 markdown 的指纹与 done 核验行为回归不变。
- [ ] 指引中写明演示文件质量门槛：单文件、内联资源、无外网依赖、无构建步骤、浏览器直接打开可交互，且覆盖界面布局 / 交互行为 / 状态反馈三要素。
- [ ] SKILL.md（数据规范、铁律 5、完善流程）与 commands/req.md 同步新口径，并写明创建阶段（可 ASCII）与完善阶段（须 html 演示）的差异。
- [ ] refine 相关测试（refine-store / refine-cli / refine-serve / refine-ui / tasks-refine）按新口径更新并全部通过；fake-codex 夹具输出语句（如涉及）同步。
- [ ] 存量兼容：已完善（refined）条目不回溯进入候选；已冻结批次候选 reasons 不重算；在途运行的领取/回执/指纹核验行为不变。
