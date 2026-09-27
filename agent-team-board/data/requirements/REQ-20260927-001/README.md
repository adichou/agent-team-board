# REQ-20260927-001 只需需求或 bug 创建时同步提交到 git。

- 状态：submitted（待人工接受）
- 创建：2026-09-27T01:29:28.226Z

## 描述

### 背景与现状（代码事实）

需求或 bug 的创建通道有三条，最终都走 `scripts/lib/core.mjs` 的 `createItem` 落盘：

- 终端 `atb new req|bug <标题>`（`scripts/atb.mjs`）；
- 网页端 `POST /api/new`（`scripts/server.mjs`）；
- 值班批量登记的候选创建（`scripts/lib/oncall-store.mjs` 的 `createItems`，逐条调用 `createItem`）。

`createItem` 写入条目目录 `agent-team-board/data/{requirements,bugs}/<ID>/`（README.md、design.md、需求另有 test-cases.md、可选 attachments/ 附件；status.json 落在 runtime，不进 git）后**不做任何 git 提交**——新条目目录以未跟踪状态留在工作区，何时入库取决于后续人工提交或开发收口的自动提交（REQ-20260911-009，report 阶段）。Agent 按仓库规则不手工 git commit，因此 Agent 登记的条目可能长期无版本记录。

对照已有口径：删除待接受条目已有「删除即留痕」同步提交（REQ-20260923-004，`scripts/lib/git-flow.mjs` `commitItemDeletion`：路径 `--only` 限定、只 commit 不 push、失败不回滚不吞错）。创建环节是留痕空档。

### 期望

- 需求或 bug **创建成功时**，系统自动把新条目目录同步提交到 git：只 commit、不 push、不切分支，让每个条目自诞生即有版本记录，不依赖后续人工或收口提交。
- 覆盖全部创建通道（终端 / 网页端 / 批量登记），在 `createItem` 调用链统一实现，行为一致；命令与接口回显提交结果（对齐 `atb delete` 的 `↳ 已同步提交 <hash>：主题` 格式）。
- 提交只含本条目目录自身（README / design / test-cases / 附件），路径限定不卷入工作区其他改动；提交主题符合「类型: 描述 单号」规范（`commit-store.mjs` `validateCommitSubject`）且含条目编号，git 历史可按单号检索。
- 容错对齐删除留痕：非 git 仓库 / 条目目录在仓库外 → 跳过并给明确 reason；提交失败不阻断创建、不回滚条目目录，输出人工补提交指引（消息含单号）。

### 边界与须在设计中消解的冲突（待确认项）

- **rebuild 判定冲突（必须处理）**：`atb rebuild`（REQ-20260918-003）按「git 历史消息含单号 → done、无提交痕迹 → submitted」重建状态；创建提交的消息含单号，会把仅创建过的条目误判为 done。设计须给出消解方案（如 rebuild 排除创建/删除类 doc 提交、或创建提交带可区分标记）——具体方案待设计定。
- 创建提交是否写入 commits 账本（影响看板「已提交」徽标）：删除留痕不写账本；创建提交写不写、看板如何呈现，**待确认**。
- 提交主题的描述文案（如 `doc: 创建条目 <ID>`，是否含标题）对齐删除留痕取舍，**待设计定**。
- 「创建并接受」（`--accept`）路径与创建失败回滚（目录已删）场景不得残留半截创建提交；开发收口幂等判定（`itemCommittedInGit`）在历史已含单号时仍须按差集归因，不得跳过源码收口提交（现有 REQ-20260914-001 口径已覆盖，测试须覆盖此交互）。
- 不做：不自动 push；不改状态机；不改变 report 收口提交口径。

## 验收标准

- [ ] 任一通道创建需求或 bug 成功后，git 产生一个创建提交：内容仅限该条目目录内文件（README.md、design.md、需求含 test-cases.md、attachments/），不卷入工作区其他改动；只 commit 不 push、不切分支。
- [ ] 终端 `atb new`、网页端 `POST /api/new`、批量登记候选创建三条通道行为一致；命令 / 接口回显提交 hash 与主题（或跳过原因）。
- [ ] 提交主题通过 `validateCommitSubject` 核验（「类型: 描述 单号」，描述 ≤120 字），消息含条目编号，`atb commit log <ID>` / git log 可检索到创建提交。
- [ ] 非 git 仓库 / 条目目录在仓库外时跳过并给出明确 reason；提交失败不阻断创建、不回滚条目目录，输出人工补提交指引（对齐 REQ-20260923-004 口径）。
- [ ] 创建提交后 `atb rebuild` 不把该条目误判为 done（消解方案随设计定，测试覆盖）。
- [ ] 「创建并接受」路径同样触发同步提交；创建失败（含 accept 回滚）不产生残留创建提交；report 收口提交在历史已含创建提交时仍正常按差集归因。
- [ ] `npm test` 全量通过（新增测试覆盖：提交产生、主题合规、路径限定、三通道一致、失败容错、rebuild 交互）。
