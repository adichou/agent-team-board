# 测试用例 — REQ-20260909-015 需求或 Bug 方案设计时要牵引 Agent 尽可能复用网络上优秀的开源库，而不是重复造轮子

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| A1 | 新建需求生成的 design.md「方案」节自带开源选型指引：优先复用成熟开源库、以依赖方式引入、禁止复制源码入库、白名单许可（MIT/Apache-2.0/BSD-2-Clause/BSD-3-Clause/ISC/0BSD/Unlicense）、GPL/LGPL/AGPL/SSPL 与 License 不明禁止、自研须写三选一理由、引入开源库须维护 licenses.md | P0 | 通过 |
| A2 | 新建 Bug 生成的 design.md「方案」节同样自带该指引；既有「引入来源（源单）」节内容不回归 | P0 | 通过 |
| A3 | `scheduler.mjs` `buildWorkerPrompt` 输出含开源选型牵引表述（优先复用、依赖引入、禁止复制源码、开源友好许可、licenses.md） | P0 | 通过 |
| A4 | `commands/dev.md` 与 `skills/agent-team-board/SKILL.md` TDD 开发流程含同口径牵引表述（优先复用开源库、依赖方式引入、禁止复制源码入库、仅开源友好许可、licenses.md 记录） | P0 | 通过 |
| B1 | `DOC_LABEL` 含 `'licenses.md': '开源许可'`，页签文案正确 | P0 | 通过 |
| B2 | `drawerDocTabs`：`licenses.md` 存在时插入「设计」（design.md）之后、「测试用例」（test-cases.md）之前；test-report.md 仍排末位附加；文件不存在时页签列表不含 licenses.md 且固定三页签不变 | P0 | 通过 |
| B3 | `drawerTabValid`：licenses.md 存在时该页签有效；文件被删后失效页签回落「基本信息」（activateDrawerTab 口径） | P1 | 通过 |
| B4 | `loadDoc('licenses.md')` 渲染后、写 docCache 前调用 `decorateLicensesDoc` 补许可警示（缓存回填内容自带警示，不重复处理）；其他文档不调用 | P0 | 通过 |
| B5 | `decorateLicensesDoc` 表格行警示：License 列（表头含 License/许可）命中禁用名单（GPL-3.0/AGPL-3.0/LGPL-2.1/SSPL）加红色「禁止引入，请替换」标；白名单（MIT/Apache-2.0/BSD-2-Clause/BSD-3-Clause/ISC/0BSD/Unlicense）无警示；白名单外未知许可（MPL-2.0/自造许可名）加「待确认」标；无 License 列或空单元格跳过 | P0 | 通过 |
| B6 | style.css 提供 `.lic-flag` 标识样式：禁用红用 `var(--warn)`、待确认黄沿用主题既有 amber 变量，不新引入固定配色（深浅色随系统） | P1 | 通过 |
| B7 | 既有 REQ-20260909-006 页签契约测试随新增页签扩展：T1 同步覆盖 licenses.md 条件插入口径，其余断言（固定页签、缓存、失效回落）不回归 | P0 | 通过 |
| B8 | 服务端零改动：不新增 /api 路由、不改 `core.readDoc` 白名单与 `orderedDocs`（licenses.md 经既有 `[\w.-]+\.md` 白名单与额外 .md 列表带出，进 `it.docs`） | P0 | 通过 |

自动化：`node scripts/tests/oss-reuse-20260909-015.test.mjs`（A1–B7）+ 既有 `drawer-tabs-20260909-006.test.mjs` 扩展（B7）+ 全量 `node scripts/tests/run-all.mjs` 回归（B8 由实现方式保证：本次提交不触碰 server 路由与 readDoc）。
浏览器目检（人工，Status Board）：licenses.md 存在/不存在条目页签增减、首次激活加载态、缓存不重复请求、红/黄标识深浅色显示。
