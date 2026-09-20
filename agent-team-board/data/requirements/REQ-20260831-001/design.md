# 设计 — REQ-20260831-001 /dev 先出实现方案并置「待对齐」，人工对齐后再实施

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现行 /dev 是「认领即开发」：claim 后直接进 TDD，方案与实施混在一起，用户在实施中途才看到技术决策，返工成本高。需要把「方案对齐」做成状态机里的硬闸门：Agent 出方案后停住，人工确认后才实施。

## 方案

### 1. 状态机扩展（`scripts/lib/core.mjs`）

- `STATES` 新增 `pending-alignment`（待对齐），列序：submitted → accepted → pending-alignment → in-progress → done。
- `TRANSITIONS`：`accepted: ['pending-alignment']`（**移除 accepted → in-progress 直达边**）、`'pending-alignment': ['in-progress']`、其余不变；`done → in-progress`（人工驳回）保留。
- `HUMAN_ONLY_TO` 增加 `in-progress`（CLI 提示人工专属）。
- `claim()` 语义调整：**accepted → pending-alignment**（记 owner + O_EXCL 锁，history 注明「认领（出方案阶段）」）；对 pending-alignment 同 owner 重复 claim 幂等返回，异 owner 报冲突；in-progress 同 owner 幂等（人工确认后继续开发场景）、异 owner 冲突；submitted/done 仍拒绝。

### 2. 守卫（`scripts/state-guard.mjs`）

bash 模式拦截清单从 `accepted|done` 扩为 `accepted|done|in-progress`：包括 `atb status <ID> <三者>` 与 curl 打 `/api/item/*/status` 的 `to=<三者>`；`atb claim` 与 `atb report` 照常放行。file 模式不变。

### 3. Status Board（`scripts/server.mjs` + `web/`）

- `boardTransitionAllowed` 人工允许边：submitted→accepted、**pending-alignment→in-progress（对齐确认）**、in-progress→done、done→in-progress；accepted→in-progress 改为不可达（403 文案提示走方案对齐流程）。
- 前端 `STATES` 五列；`STATE_LABEL.待对齐`、`STATE_HINT`（"Agent 已出方案，等待人工对齐确认"）、抽屉按钮「▶ 对齐确认」（data-act=in-progress）；列色新增（紫 `#7c3aed` 系）。
- 布局：`.board` 四列改**五列** `repeat(5, minmax(176px, 1fr))`（5×176+4×14+2×18=972 < 980，保持宽屏无横向溢出承诺）；断点 1020/640 不变。`layout.test.mjs` T6/T7 随之修订（本需求对布局契约的演进，REQ-029-001 的验收精神不变）。

### 4. /dev 流程两阶段（`commands/dev.md` + SKILL.md）

- **阶段一（方案）**：读文档 → 写 `design.md` 初稿 → 会话呈现方案要点 → `atb claim <ID>`（→ 待对齐）→ **停下等人工对齐**，不写实现代码。
- **阶段二（实施）**：仅在人工确认后开始（会话明确同意「按方案实施/对齐了」，或看板点「对齐确认」）；对齐中按意见修订 design.md 再等确认；信息不足在方案阶段澄清。
- **loop 交互**：loop 每条目走到「待对齐」即停（方案入 design.md 并呈现）；全部 accepted 出完方案后 loop 正常终止。**批量对齐**：用户在会话中明确同意（如「两个方案都对齐了，继续实施」）即视为这些条目已对齐，Agent 可逐条进入实施；看板按钮是另一条人工确认路径。
- traceability（引入来源）语言保留在阶段二实施与 Bug 修复部分。

### 5. 测试

新增 `scripts/tests/pending-alignment.test.mjs`（真实起 server + core 直调）：
P1 状态机边（含移除 accepted→in-progress）、P2 claim 新语义与幂等/冲突、P3 待对齐→in-progress 可流转且历史可溯、P4 server 人工边（403/200）、P5 钩子拦截清单扩展（子进程实测）、P6 前端五列静态契约、P7 旧数据兼容（预置 in-progress 旧条目 list 正常）、P8 /dev 与 SKILL 两阶段条款。回归：layout（修订后）、multi-project、file-board、copy-id、traceability 全绿。

## 影响面

`core.mjs`（状态机/claim）、`state-guard.mjs`、`server.mjs`（人工边）、`web/app.js`+`style.css`（五列/新按钮）、`layout.test.mjs`（五列演进）、`commands/dev.md`、`skills/agent-team-board/SKILL.md`；新增 `pending-alignment.test.mjs`。

## 风险与边界

- 旧条目兼容：不迁移数据，历史 in-progress 条目照常；新状态只影响此后流转。
- SKILL.md 中 `/dev loop` 的既有描述将改为「出方案闸门」语义；旧缓存插件（≤0.2.3）与新数据共存期间，旧 claim 会把 accepted 直置 in-progress（跳过待对齐）——升级插件后消除，属可接受过渡。
- 报告覆盖率无变化；`/req`、`/bug`、`/board` 其他行为不动。
