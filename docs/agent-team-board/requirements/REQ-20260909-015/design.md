# 设计 — REQ-20260909-015 需求或 Bug 方案设计时要牵引 Agent 尽可能复用网络上优秀的开源库，而不是重复造轮子

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

提出人两条诉求：① 方案设计要牵引 Agent 复用优秀开源库且以引用（依赖）方式引入，不复制代码入库；② 条目用了开源库时，License 与仓库地址要在需求详情页单独页签展示（设计页签之后），且只能用开源友好许可。README 已定口径（含「待确认」各项的默认值）：A 线落 design 模板与三处流程指引；B 线落 `licenses.md` 条目文档 + 详情抽屉条件页签；服务端零改动。

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库可复用，有则优先以依赖方式引用（Node/Web 项目走 npm；Apple 平台走 SPM / CocoaPods），禁止把开源库源码复制进项目仓库；仅当库无包分发渠道且确需使用时才允许 vendor（内嵌源码），须在 `licenses.md` 标注复制范围与原因。License 只用开源友好白名单（MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；MPL-2.0 等弱传染许可待人工裁定），GPL / LGPL / AGPL / SSPL 等强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 / 引入成本高于自研的原因；引入了开源库须在条目目录维护 `licenses.md`（库名 / 版本 / 引入方式 / License / 仓库地址），未使用开源库的条目不创建该文件。

## 方案

（技术选型、接口设计、影响面）

### A. 选型牵引（模板与指引文案）

1. `scripts/lib/core.mjs` `reqDesign` / `bugDesign`「方案」节尾追加「开源选型（REQ-20260909-015）」段（上文背景中同款文案，压缩为模板内多行文本）：新建条目即带指引，三选一理由口径写进模板占位。引入来源节（bugDesign）原样保留。
2. `scripts/lib/scheduler.mjs` `buildWorkerPrompt` 在 TDD 步骤后补一行牵引：优先复用成熟开源库、以依赖方式引入、禁止复制源码入库、仅开源友好许可、引入即在条目目录维护 `licenses.md`。
3. `commands/dev.md` 第 4 步（TDD）与 `skills/agent-team-board/SKILL.md`「TDD 开发流程」第 4 步各补一句同口径表述（含 licenses.md 记录与三选一理由）。

### B. 开源许可页签（纯前端）

4. `scripts/web/app.js`：
   - `DOC_LABEL` 增 `'licenses.md': '开源许可'`；
   - `drawerDocTabs(it)`：`(it.docs||[]).includes('licenses.md')` 时插到 `design.md` 之后（`DRAWER_FIXED_DOC_TABS` 常量保持三固定项不动，仅插入位置计算），`test-report.md` 仍排末位；`drawerTabValid` / `activateDrawerTab` / 搜索跳转 / 缓存 / 失效回落全部经既有通用链路自动生效，零额外分支；
   - `loadDoc`：`name === 'licenses.md'` 时渲染后、`annotateDocLines` / 写 `docCache` 前调用 `decorateLicensesDoc(view)`（缓存 HTML 自带警示）；
   - 新增 `decorateLicensesDoc(view)`：遍历 `#docView` 内 `<table>`，按表头定位 License 列（含「license / 许可」字样，找不到列则跳过该表），逐行判定：禁用名单正则 `/\b(?:AGPL|LGPL|GPL|SSPL)\b/i` → 行尾附红标「禁止引入，请替换」；白名单词匹配（MIT/Apache-2.0/BSD-2-Clause/BSD-3-Clause/ISC/0BSD/Unlicense）→ 无警示；其余 → 黄标「待确认」。空单元格 / 表头行跳过。纯展示层，不阻塞阅读。
5. `scripts/web/style.css`：新增 `.lic-flag` 胶囊标识（行内 inline-flex，字号 11px）：`.lic-banned` 用 `var(--warn)` 红、`.lic-unknown` 用既有 amber 变量 `var(--inprogress)`，背景取对应 rgba 淡色，不新引入配色，深浅色随系统。
6. 服务端零改动：`licenses.md` 文件名在 `core.readDoc` 既有 `[\w.-]+\.md` 白名单内，`orderedDocs` 已把四件套外 `.md` 列入 `it.docs`；全文搜索经 `searchDocs` 自动覆盖；不新增 / 修改任何 `/api` 路由。

### 影响面

`app.js`（页签常量与 loadDoc 一处插入 + 新函数）、`style.css`（一个标识样式）、`core.mjs`（两个模板文案）、`scheduler.mjs`（提示词一行）、`commands/dev.md`、`skills/agent-team-board/SKILL.md`（各一句）；不改状态机、不写 status.json、不动既有四件套口径；REQ-20260909-006 页签契约测试同步扩展 T1，其余既有断言不回归。

## 风险与边界

- 「待确认」各项按 README 默认值实施（文件名 licenses.md、存在才显示、MPL-2.0 等未放行、vendor 允许但须标注、仅界面警示、指引含 worker 提示词、存量不回补）；后续人工裁定变化只需改文案与白名单常量。
- 前端警示是展示层提示，非合规硬校验（待确认 5 默认口径）；License 判定按 SPDX 标识词匹配，非 SPDX 全库解析。
- 既有条目不回补 licenses.md，页签只在文件存在时出现，旧数据无感。

## 实施记录

- 2026-09-09（zcode-batch-027-2）：按上述方案完成 A/B 两线实施；新增 `scripts/tests/oss-reuse-20260909-015.test.mjs`（A1–B7），扩展 `drawer-tabs-20260909-006.test.mjs` T1 覆盖 licenses.md 条件插入口径；`npm test` 全量绿（125 文件）。本条目自身未引入新的开源库，按口径不创建 licenses.md。
- 既有断言同步调整一处：`confirm-lane.test.mjs` T1 原以全源码扫描禁止 `'待确认'` 字面量（REQ-20260907-005 把 confirming 档「待确认」更名「待测试」的回归防线）。本需求验收标准明确要求未知许可给「待确认」标识，两口径冲突；已把该断言收窄到其本意（STATE_LABEL / LANE_LABEL / LANE_HINT 三个标签定义不得残留「待确认」），更名防线的保护范围不变，许可警示新域文案放行。非行为缺陷，不另立 Bug。
