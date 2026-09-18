# REQ-20260918-002 根目录下的 README.md 不受实施互斥锁约束，允许用户和 Agent 更新以及提交

- 状态：submitted（待人工接受）
- 创建：2026-09-18T03:44:15.251Z

## 描述

### 目标

插件根（本仓库源码形态即仓库根）直接下级的 `README.md` 是纯文档：项目定位与入口、目录与模块地图、环境与运行命令、关键机制索引，不含任何运行逻辑。但当前它被源码守卫与提交守卫当作业务源码同等对待，Agent 改一段文档也要走完整开发流程。本需求将根 `README.md` 从实施互斥（认领锁）约束中豁免：**用户与 Agent 无需认领锁即可更新它，并允许将其改动提交进版本库**；豁免精确限定该单一文件，不放宽任何其他保护。

### 现状排查（2026-09-18，事实源为 scripts/state-guard.mjs 当前实现）

- **Edit/Write 被拦**：file 模式 `realpathAncestralHitsPluginRoot` 判定目标是否插件源码——插件根直接下级文件（如根 `README.md`，即 `rel === 'README.md'`，非 `docs/`、`agent-team-board/` 豁免前缀）命中保护，无有效认领锁（`agent-team-board/runtime/.locks/` 下 24h 未过期锁）时 Write/Edit 被拒。
- **Bash 改写被拦**：bash 模式同口径（`hitsPluginSource` / `tokenRealpathHitsPluginRoot`）——`sed -i`、重定向、`tee` 等写目标落根 `README.md` 时无锁被拒。
- **提交被拦**：流程外 git commit 拦截（REQ-20260911-009 第 (5) 条）在看板项目内对 Agent 经 Bash 的 `git commit` **一律拦截**，与提交对象无关——即使放开了编辑，Agent 也无法自行提交根 `README.md` 的改动；report 自动收口提交由 atb 进程内部执行不经此守卫，但那要求先走 claim 全流程。
- **人工路径不受影响**：钩子只拦 Agent 的工具调用，用户在终端编辑 / `git commit` 本就放行——本需求实施后该路径行为保持不变。

### 需求内容

1. **编辑豁免（认领锁不约束）**：无有效认领锁时，Agent 对插件根 `README.md` 的 Write/Edit 与 Bash 改写（sed / 重定向 / tee 等写动词，写目标为该文件）均放行，不再要求先登记条目 → 人工接受 → 移入计划 → `atb claim`。
2. **提交豁免**：Agent 可在看板项目内经 Bash 提交仅涉及根 `README.md` 改动、且提交主题符合 `commit-store.mjs` 提交规范（「类型: 描述 单号」，含条目编号）的 git commit（无需走 report 自动收口；无条目编号的文档提交不允许——2026-09-18 人工裁定，记录见「待确认」节）；豁免不得放宽其他提交——提交范围包含受保护源码（scripts/、commands/、skills/、hooks/、manifest、assets 等）或其他文件的 commit 仍按原规则拦截，主题不合规范（含无条目编号）的提交同样不获豁免，防止本豁免成为源码保护的旁路（如预先 `git add` 源码再借 README 提交夹带）。
3. **范围精确限定**：豁免仅适用于「插件根第一层的 `README.md`」这一个文件，判定口径与现有保护一致（realpath 归一，兼容缓存软链安装形态与相对路径）。插件根其他直接子文件（根 `AGENTS.md`、`package.json`、`index.html`、`bin/` 等）及一切子目录源码的保护不变；`skills/`、`scripts/` 等目录内的同名 `README.md` 不在豁免之列。
4. **其余守卫规则不变**：`runtime/status/**.json` 直写拦截、人工专属状态命令拦截（`atb status accepted|planned|done`、hold/confirm 人工闭环、人工 HTTP API）、`atb new --accept` 拦截等既有规则与提示文案不受影响。
5. **文档口径同步**：根 `AGENTS.md`「改前先登记」条款（当前把「根文档」整体列入登记范围）与根 `README.md`「关键机制索引 · 认领锁与源码守卫」按新口径修订——根 `README.md` 例外，可由用户与 Agent 直接更新提交。

### 待确认（不阻塞验收框架，实施前定）

- 提交豁免的判定口径：静态解析命令文本（`git commit -- <根README>` / `git add <根README>` 后 commit 的路径限定形态）还是运行时检查暂存区内容仅含根 `README.md`——留 design.md 定案；无论哪种口径，验收以第 2 条的行为要求为准。
- Agent 手工提交根 `README.md` 的提交主题是否受 `commit-store.mjs` 提交规范（带条目编号）约束，还是允许无条目编号的文档提交：已定（2026-09-18 人工裁定）——**受规范约束**：主题须为「类型: 描述 单号」形态（五类前缀、描述非空且 ≤120 字、含条目编号），无条目编号的文档提交不允许，原「倾向后者」预判作废。据此，编辑豁免（第 1 条）只豁免改写流程、不豁免提交消息规范：第 2 条豁免放行以主题合规为前提，无条目编号或不合规的提交不获豁免、按流程外提交原规则拦截；单号取本次文档改动所关联的条目，无关联条目的改动不适用本豁免（由人工终端提交，或先 /req 登记再提交）。主题合规与单号校验的判定口径（如 `-m` 静态解析、单号形态匹配或校验条目真实存在）与上一条（提交范围判定口径）一并在 design.md 定案，验收以第 2 条行为要求为准。

## 验收标准

- [ ] 无认领锁时，Agent Write/Edit 指向插件根 `README.md` 放行（file 模式退出码 0）；经符号链接别名路径（插件缓存安装形态）与相对路径定位的同一文件同样放行。
- [ ] 无认领锁时，Bash 改写插件根 `README.md`（`sed -i`、`>`/`>>` 重定向、`tee`）放行；同批命令改 `scripts/`、`commands/`、`skills/`、`hooks/` 等受保护源码仍被拦截（原保护面不弱化）。
- [ ] 无认领锁时，Agent 经 Bash 提交仅含插件根 `README.md` 改动、且主题符合提交规范（「类型: 描述 单号」、含条目编号）的 `git commit` 放行；提交范围混入受保护源码或其他文件的 commit 仍拦截（含预先 `git add` 后夹带源码的形态），主题无条目编号或不合规的提交同样拦截，拦截提示仍指向既有提交通道。
- [ ] 豁免范围精确：根 `AGENTS.md`、`package.json`、`index.html`、`bin/` 等插件根其他直接子文件的无锁改写仍被拦；`skills/`、`scripts/` 等目录内同名 `README.md` 不获豁免；既有守卫规则（`runtime/status` 直写、`atb status` 人工专属状态、`atb new --accept`、hold/confirm 与人工 API 拦截）回归不变。
- [ ] 有认领锁时原有放行行为不变（锁存在性仅是放行条件之一，豁免不引入新的拒绝路径）。
- [ ] 用户路径不受影响：人工在终端编辑与 `git commit`（含仅根 `README.md` 或任意范围）不经钩子、行为与现状一致。
- [ ] 文档同步：根 `AGENTS.md`（改前先登记条款）与根 `README.md`（关键机制索引 · 认领锁与源码守卫）按豁免口径修订，写明根 `README.md` 可由用户与 Agent 无锁更新提交；`hooks.json` / `state-guard.mjs` 顶部注释口径同步。本次为守卫与文档改动，不涉及界面文案，无 i18n 改动。
- [ ] TDD：新增 `scripts/tests/req-20260918-002.test.mjs` 先红后绿（子进程实测 state-guard 两种模式，参照 `code-guard.test.mjs` 形态），`npm test` 全量通过。
