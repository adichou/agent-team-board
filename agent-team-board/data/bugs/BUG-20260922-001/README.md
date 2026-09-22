# BUG-20260922-001 文案“或在 ZCode 会话运行 /dev REQ-20260922-003 让 Agent 直接认领。”优化

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260907-012（详情抽屉 notice 登记「在 ZCode 会话运行 /dev」排他表述）、BUG-20260908-020（重写 accepted 分支 notice 时沿用该表述；两 ID 均经 atb list 核验）
- 创建：2026-09-22T00:03:40.287Z

## 现象

Web 看板详情抽屉中，条目状态为「已接受（accepted，未入计划）」时，操作区上方的 info 提示条显示：

> 未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在 ZCode 会话运行 `/dev <条目号>` 让 Agent 直接认领。

本项目插件为 ZCode / Codex 双宿主分发（`scripts/lib/plugin-pack.mjs`：“ZCode/Codex 双宿主安装遵循各自官方插件机制”；`scripts/tests/codex-hooks.test.mjs` 维护双宿主契约），`/dev` 命令随插件分发（`commands/dev.md`），并非 ZCode 专属。文案只写「ZCode 会话」把 Codex 及其他 Agent 宿主用户排除在外，指引不够通用。

英文界面同样不通用：i18n 词典将该句译为 "…or run in a ZCode session"（`scripts/web/i18n.js`），只提 ZCode。

代码定位（缺陷文案共三处，须一并核对）：

| 位置 | 内容 |
| --- | --- |
| `scripts/web/app.js` `drawerActionsNoticeHtml()`（约 4512 行，accepted 分支） | 中文原文「…或在 ZCode 会话运行 `<code>/dev ${id}</code>` 让 Agent 直接认领。」 |
| `scripts/web/i18n.js`（约 1011 行，EN 静态词典） | 键「未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在 ZCode 会话运行」→ 值 "…or run in a ZCode session"（对应 `<code>` 前的文本节点） |
| `scripts/web/i18n.js`（约 864 行） | 键「让 Agent 直接认领。」→ "and let the Agent claim it directly."（对应 `<code>` 后的文本节点，本身通用，无宿主名） |

原始登记要求：

1. 去掉「ZCode 会话」，改成「您使用的 Agent 会话」；
2. 排查项目中还有哪些文案类似不够通用化，排查出来修改成通用描述。

## 复现步骤

1. 在项目根启动看板服务：`node scripts/atb.mjs serve --open`（服务默认 `http://127.0.0.1:8888`；也可在 ZCode 会话内运行 `/board` 打开内置面板）。
2. 浏览器打开看板，在需求 / Bug 列表中找到任一状态为「已接受（accepted）且未入计划」的条目。
3. 点击该条目，右侧详情抽屉操作区上方出现提示条，文案含「或在 ZCode 会话运行 /dev <条目号> 让 Agent 直接认领」。
4. 对照事实：`/dev` 为插件通用命令（`commands/dev.md`），Codex 宿主同样可运行；该指引写成 ZCode 专属与双宿主定位不符。
5. （可选，验证英文口径）将界面语言切到英文（语言自动检测 `navigator.languages` 含 `en-*`，或手动切换，记忆于 `localStorage('atb.lang')`），同一提示条显示 "…or run in a ZCode session … and let the Agent claim it directly."，同样只提 ZCode。

## 期望行为

1. 主文案去掉宿主名，改为通用表述（与项目内既有通用口径一致，`scripts/atb.mjs` 多处提示词指引均用「复制后在当前项目的 Agent 会话发送」这类说法）：
   - 修复后文案：「未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在您使用的 Agent 会话运行 `/dev <条目号>` 让 Agent 直接认领。」
2. i18n 同步（`scripts/web/i18n.js`）：词条键随中文原文更新，英文值同步通用化（如 "…or run it in your agent session"）；「让 Agent 直接认领。」词条无宿主名，可保留。修复后英文界面不再出现 "run in a ZCode session"。
3. 全项目同类文案排查并按口径处理。登记时排查结论（开发阶段复核）：
   - **必改**：上表三处（app.js 1 处 + i18n.js 2 条，其中 1 条仅核对）。
   - **保留（事实性宿主描述，非排他）**：
     - 「未检测到 ZCode.app（zcode:// 深链宿主）…」系列（`app.js` 约 7143 / 7890 行、`build.js` 约 1217 / 3874 行、`i18n.js` 约 737 / 738 行）：`zcode://` 深链确实仅由 ZCode.app 承载，属事实性检测提示，且同屏给出「打开 Zcode / ChatGPT 手动新建会话」通用备选。
     - 「去新建 Zcode / Codex 会话」链接（`app.js` `newSessionLinksHtml()`）、`atb.mjs` pack 输出的「ZCode/Codex 双宿主安装遵循各自官方插件机制」：双宿主并列口径，通用。
   - **已人工定夺（hold 第 1 轮，2026-09-22 04:15 board）**：
     - 「或直接打开 ZCode / ChatGPT 手动新建会话并粘贴提示词」（`app.js` 约 7133 行、`build.js` 约 1208 行、`i18n.js` 约 505 行）：定夺**通用化处理**，已改为「或直接打开您使用的 Agent 客户端手动新建会话并粘贴提示词」，EN 同步 "or open your agent client directly, …"。
     - `atb.mjs` 约 2204 行「提示：ZCode 内置浏览器右侧面板需在会话内用 /board 打开。」：定夺**保留现状**（ZCode 内置浏览器 IAB 为 ZCode 特有形态的事实提示，上一行已给出通用浏览器 URL）。
   - 排查范围：`scripts/web/`（app.js、build.js、i18n.js）、`scripts/atb.mjs`、`commands/`、`skills/`；`agent-team-board/runtime/`（含 builds 产物）为系统生成数据，不手改。
   - 排查未发现 commands/、skills/、bin/ 中存在「ZCode 会话」类排他文案（docs/ 下仅历史运行日志命中，属数据非文案）。

## 验收说明

1. 看板中打开任一 accepted 未入计划条目详情：提示条不再出现「ZCode 会话」，显示通用表述（含「您使用的 Agent 会话」或同等通用措辞）。
2. 界面切到英文后，同一提示条为通用英文表述，不再出现 "ZCode session"。
3. 对源码做全局检索（如 `grep -rn "ZCode 会话\|Zcode 会话" scripts/`）：面向用户且把双宿主通用能力写成 ZCode 专属的文案为 0；保留的事实性宿主描述（深链检测等）维持原状。
4. 相关测试同步更新并通过：`node --test scripts/tests/`，重点关注断言该 notice 文案的测试与 `i18n-*.test.mjs` 词典测试（具体涉及用例待开发阶段确认）。
5. 「待确认」两项若人工定夺为需要修改，一并按通用口径处理；若定夺保留，在 design.md 记录结论。

## 界面展示

缺陷出现在 Web 看板「详情抽屉」的操作区提示条，修复仅改提示条文案，不动布局与交互。可交互演示见 [./ui-demo.html](./ui-demo.html)（单文件、无外网依赖，浏览器直接打开）。

- **界面布局**：右侧详情抽屉——头部为条目编号 + 标题 + 状态徽标，其下为页签（基本信息 / 文档），操作区为「notice 提示条独占操作行上方整行（`drawerActionsNoticeHtml`）+ 按钮行（`drawerActionsButtonHtml`）」两段结构；accepted 状态按钮为「➤ 移入计划」「↩ 驳回接受（退回待接受）」，planned 状态为「↩ 移出计划（退回已接受）」。
- **交互行为**：点「移入计划」→ 条目 accepted → planned，notice 切换为「已排入开发计划，开发启动后最旧优先自动处理；未进入开发中前可「移出计划」退回已接受。」；点「移出计划」→ 退回 accepted 并恢复未入计划提示；均为免二次确认、可往复。
- **状态反馈**：正常（accepted / planned 两种 notice 文案随状态切换）；空态（未选择条目时抽屉显示「选择左侧列表中的条目查看详情」）；加载（打开详情时经 `GET /api/item/<ID>` 拉取，期间有加载指示、按钮不可用）；失败（接口报错 → 顶部 toast 错误提示并自动关闭抽屉回落空态）。
- **缺陷对照**（ui-demo.html 核心演示）：页面提供「修复前（当前缺陷） / 修复后（期望）」开关与中 / 英语言切换——修复前中文文案含「在 ZCode 会话运行」、英文含 "run in a ZCode session"；修复后为「在您使用的 Agent 会话运行」及对应通用英文；其余布局与交互两种模式下保持一致。
