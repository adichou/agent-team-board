# 设计 — REQ-20260908-009 去掉 bug 单的归属需求选项，默认都是独立 Bug，然后需要在 Bug 单的设计说明书中明确表明引入问题的源单是什么

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

创建 Bug 的「归属需求」把关联固化在目录结构（`requirements/<REQ>/bugs/`）上，与归因要求脱节；本需求把关联从物理归属改为文档标注（引入来源），简化流程并强化溯源。

## 方案

分四层改动，单一约束收敛在 `core.createItem`：

1. **core.mjs（数据层，约束单一来源）**
   - `createItem`：`type === 'bug' && parent` 时抛 `AtbError`（提示一律独立 Bug、源单写 design.md「引入来源」节）。requirement 传 parent 原有报错保留。
   - `bugReadme` 去掉参数与「归属需求」行，元信息行改「归属：独立 Bug（源单见 design.md 引入来源）」。
   - 新增 `bugDesign(id, title)` 模板：`# 设计 — <ID> <标题>`，含「引入来源（源单）」节——三选一：`REQ-/BUG- 编号（经 atb list 核验）`、`未定位（排查过程：…）`、登记时暂空；注明修复阶段必须归因（REQ-20260830-004）。bug 创建时与 README 一并写入 `design.md`（`DOC_ORDER` 已含，docs 列表自动带出）。
   - 存量兼容不动：`resolveItemDir` 对 `requirements/*/bugs/` 的扫描、`moveBug`（--req/--standalone）、list/show 的 parent 展示全部保留。
2. **atb.mjs（CLI）**
   - `new` 分支 valueFlags 去掉 `req/parent`；检测到 `--req/--parent` 即 `die`，文案指引新用法。USAGE 同步：`atb new bug <标题> [--desc <描述>]` + 说明行。
3. **server.mjs / web**
   - `/api/new`：`type === 'bug' && body.parent` 返回 400（错误信息与 CLI 一致）；requirement 传 parent 原样传 core 报错。
   - `web/index.html` 删除「归属需求（可选）」表单行（`#fParentRow/#fParent`）；`web/app.js`：`openModal` 不再填充下拉、`syncNewFormFields` 不再切换该行、`submitNew` 不再提交 `parent`。
4. **文档同步**
   - `skills/agent-team-board/SKILL.md`：数据规范与 CLI 速查中 `new bug` 去掉 `[--req REQ-…]`；「归属判断不了的 Bug 先建独立后 move」改述为「Bug 一律独立创建，源单写 design.md 引入来源；move 仅作存量归属整理」。

测试：新增 `scripts/tests/bug-standalone-origin.test.mjs`（CLI 报错、core 抛错与模板内容、API 400、web 静态检查、存量兼容）；`item-delete.test.mjs` D2/D4、`batch-core.test.mjs` Z03 中构造归属 Bug 的用例改为 `createItem` 独立 + `moveBug` 归属。

## 风险与边界

- 存量项目已有归属 Bug 数据：只收紧「创建入口」，读取与 move 不动，无迁移需求。
- 第三方脚本若直接调 `core.createItem({type:'bug', parent})` 会抛错——属预期破坏性变更（本需求目标），错误信息给出新用法指引。
- 旧前端缓存页面可能仍提交 parent：server 返回 400 明确报错，刷新即恢复。

## 实施记录

- `scripts/lib/core.mjs`：`createItem` 对 bug 传 `parent` 抛 AtbError（文案含「独立」「引入来源」指引），requirement 传 parent 报错保留；目录固定 `bugs/` 顶层、`parent: null`；`bugReadme` 去掉归属需求行，改「归属：独立 Bug（引入来源见 design.md）」；新增 `bugDesign` 模板（引入来源三选一指引 + 根因分析/方案/风险节），bug 创建时与 README 一并写入。存量兼容不动：`resolveItemDir` 嵌套扫描、`moveBug`、list/show parent 展示保留。
- `scripts/atb.mjs`：`new` 的 valueFlags 去掉 `req/parent`；检测到 `--req/--parent` 直接 `die` 指引新用法；USAGE 两行同步（去掉 `[--req <REQ-ID>]` 与归属说明文案）。
- `scripts/server.mjs`：`POST /api/new` 带 `parent` 返回 400（错误文案与 core 一致）。
- `scripts/web/index.html`：删除「归属需求（可选）」表单行（`#fParentRow/#fParent`）；`scripts/web/app.js`：`openModal` 不再填充下拉、`syncNewFormFields` 不再切换、`submitNew` 提交体去掉 `parent` 字段。
- 文档同步：`skills/agent-team-board/SKILL.md`（数据规范、CLI 速查、TDD 归因落点、Bug 读文档范围）、`commands/bug.md`（步骤与 argument-hint 去 --req）、`commands/dev.md`（归因写入 design.md「引入来源（源单）」节）。
- 测试：新增 `scripts/tests/bug-standalone-origin.test.mjs`（B1–B8）；既有测试同步：归属 Bug 构造改走独立创建 + `moveBug`（batch-core Z03、item-delete D2/D4、rename-reject R2、search-api）；规范契约断言随需求演进更新（traceability R2/R4、workbench-layout W6）。全量 82 个测试文件通过。

