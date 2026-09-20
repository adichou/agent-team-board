# 设计 — REQ-20260908-021 完善需求时的 UI 设计要使用 html 进行可交互设计展示

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260908-015 把「涉及 UI 的需求」在完善阶段的门槛定为 README 内嵌 ASCII 线框 / 结构示意。线框只能表达静态布局，交互与状态反馈仍要人工脑补；而「接受即视为设计认可」（REQ-20260903-001）意味着人工在接受前理应看到可操作的界面形态。项目已有自发先例（REQ-20260907-004 的 layout-demo.html），但未固化为完善流程口径。本需求把完善阶段的 UI 展示升级为条目目录内可交互的 `ui-demo.html` 演示（固定命名）。

## 方案

### 1. 判定口径（scripts/lib/refine-store.mjs `analyzeItemDocs`）

「涉及 UI」的判定（满足其一）：

- 描述节命中 `UI_KEYWORDS`（沿用 REQ-20260908-015 词表，不变）；
- 「界面展示」节正文出现 `ui-demo.html` 字样（作者自行链接演示文件即视为 UI 单）。

判定分层（依序，前者命中即不再看后者）：

1. 无「界面展示」节 + 描述命中关键词 → `涉及 UI 需界面展示`（原文案沿用）；
2. 节存在但空 /「（待补充）」占位 → `界面展示待补充`（原文案沿用，不叠加演示三查）；
3. 节有实质内容且属于 UI 单（未声明非 UI）→ 演示三查：
   - `ui-demo.html` 缺失 → `涉及 UI 缺 ui-demo.html 演示`；
   - 文件为空 / 剥 HTML 注释与空白后无内容 → `ui-demo.html 演示待补充`；
   - 节正文未出现 `ui-demo.html` 字样 → `界面展示节未链接 ./ui-demo.html`。

兜底保留：节正文含「不涉及界面改动」→ 视为有效内容（启发式误判保护），不做演示三查。ASCII 线框从必需降为可选补充（节内纯线框内容按第 3 层继续查 html）。非 UI 需求与 Bug 判定完全不变。

### 2. 指纹与 done 核验（`DOC_FILES` / `docsFingerprint`）

`DOC_FILES` 由三份 markdown 扩为 `['README.md','design.md','test-cases.md','ui-demo.html']`（缺失记 `<missing>`，存在即计入 sha1）。效果：worker 只新增/修改演示文件的 done 回执能通过「真实变更」核验；基线保护（冻结后人工编辑出局）同步覆盖演示文件。三份 markdown 的指纹与核验行为回归不变。

### 3. 提示词（`buildRefinePrompt` / `buildRefineWorkerPrompt`）

两处补全口径改为：涉及 UI 时界面展示节保留布局/交互/状态反馈文字说明并链接 `./ui-demo.html`，同时在条目目录创建 `ui-demo.html` 可交互演示，质量门槛固化为常量 `UI_DEMO_QUALITY`：**单文件 html（内联 CSS/JS）、无外网依赖、无构建步骤、浏览器直接打开可交互，覆盖界面布局/交互行为/状态反馈（正常/空/加载/失败等状态切换；深浅色适配可选，ASCII 线框仅作可选补充）**。worker 约束改为「只编辑条目目录下 markdown（涉及 UI 的需求可另建约定的 ui-demo.html）」，其余禁令（业务源码 / status.json / claim/report / test-report.md / git commit / 保持 accepted / 待确认）逐项保留。Bug 指引不变。

### 4. 各级指引同步

- `scripts/atb.mjs`：`REFINE_USAGE` 完善口径段与 `refine next` 下一步行改新口径（含 ui-demo.html 与质量门槛）。
- `scripts/server.mjs`：完善执行器注释口径同步（仅注释，无行为改动）。
- `skills/agent-team-board/SKILL.md`：数据规范（README 界面展示定义）、铁律 5（两阶段口径：创建可 ASCII、完善须 html 演示）、批量完善段落三处同步。
- `commands/req.md`：创建阶段口径写明「完善阶段会升级为 ui-demo.html 演示，创建时不强制」。
- `scripts/tests/fixtures/fake-codex.mjs`：refine-ok 模式最终回复文案同步。

## 风险与边界

- **存量兼容**：已完善（refined）条目不回溯候选（states 过滤，无改动）；已冻结批次候选 reasons 为创建时快照不重算（S10 回归）；在途运行的领取/回执/指纹核验行为不变（指纹含 html 仅影响新冻结基线）。
- **Status Board 不内嵌执行**：`/api/fs/raw` CSP `default-src 'none'`，人工用本地浏览器打开条目目录 ui-demo.html 查看（边界与非目标，维持 README 裁定）。
- **判定为启发式**：节内出现 `ui-demo.html` 字样即视为已链接（markdown 链接 / 反引号代码均可），不做 URL 解析；html 占位判定只剥 HTML 注释与空白，不校验交互逻辑本身（内容质量由人工接受前查看把关）。
- **`/req` 创建阶段不强制 html 演示**：两阶段口径差异已在 SKILL.md 与 commands/req.md 写明。

## 实施记录（zcode-batch-018-01，2026-09-08）

- TDD：test-cases.md 15 条用例先行，refine-store.test.mjs 更新/新增 S6（html 三查全路径）、S12（只改演示文件可记账）、S9 扩展（演示文件指纹）、P1 扩展（提示词口径 + 禁令保留）、S5/S4/S7/S10 回归断言，先跑红（4 用例失败）后实现跑绿。
- 改动文件：`scripts/lib/refine-store.mjs`（判定 + DOC_FILES/docsFingerprint + 两处提示词 + UI_DEMO_QUALITY 常量）、`scripts/atb.mjs`（REFINE_USAGE + next 下一步行）、`scripts/server.mjs`（注释）、`skills/agent-team-board/SKILL.md`（三处）、`commands/req.md`、`scripts/tests/fixtures/fake-codex.mjs`、`scripts/tests/refine-store.test.mjs`。
- 验证：refine-store / refine-cli / refine-serve / refine-ui / tasks-refine 五套件全绿；`run-all.mjs` 90 个测试文件全部通过，失败 0。
