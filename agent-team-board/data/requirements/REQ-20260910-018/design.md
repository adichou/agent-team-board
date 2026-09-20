# 设计 — REQ-20260910-018 讨论逐轮持久化、文档资产展示与跨会话续聊

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现状（REQ-20260909-004）：开放式讨论仅靠启动提示词在 Agent 外部会话交流，收到收尾提示词后才按发布协议
成套落盘 minutes.md + candidates.json + PUBLISH.json，看板检测发布标记后读取展示。讨论过程不持续沉淀，
新会话无法仅凭项目文档恢复讨论背景。本需求把讨论升级为逐轮持久化的项目文档资产，并支持跨会话续聊。

## 方案

（技术选型、接口设计、影响面）

### 1. 数据结构（讨论目录内追加，兼容既有文件）

沿用 `oncall/tickets/<ASK-ID>/` 目录与既有 minutes.md / candidates.json / PUBLISH.json 发布协议（候选
需求/Bug 仍走发布协议，由用户勾选创建）。新增两类事实源：

- `rounds/r0001.json`：一轮一文件，零填充递增（r0001、r0002…）。字段：
  `{ version: 1, discussionId, no, roundId: "R0001", at, user（用户原文）, summary（回复总结）, session（来源会话标识）, key（幂等键，可选） }`。
  一轮 = 一次用户输入 + 完整模型回复的总结；只追加、永不覆盖（结论变化写新轮 + 更新纪要，不回改旧轮）。
- `minutes.meta.json`：纪要乐观版本 `{ discussionId, version, updatedAt }`。旧发布协议写的 minutes.md
  无 meta 文件时按版本 0 处理（首次整理覆盖合法）。纪要仍存 `minutes.md`（Markdown），每轮按需经统一
  入口更新；纪要更新失败不丢弃已保存轮次。

### 2. 统一追加入口（oncall-store.mjs）

- `appendDiscussionRound(dataDir, id, { user, summary, session, key })`：
  - 归属校验：讨论必须存在（读 ticket.json）；轮文件携带 discussionId，读取侧遇到编号不符/非法 JSON 的
    文件直接跳过（不串项目、不串讨论、不展示半成品轮）。
  - 并发保护：`no` 取当前最大值 +1，最终文件以独占标志写入（`writeFileSync(final, …, { flag: 'wx' })`），
    撞号（EEXIST）自动递增重试；写失败删除残留文件并抛错。一轮一文件 ⇒ 多会话并发追加互不覆盖。
  - 幂等：携带 `key`（幂等键）的追加若已存在同 key 轮次，返回既有轮并标记 `duplicate: true`——同轮
    重试（写入成功但回执丢失后重试）不产生重复轮次。
  - 成功后刷新 ticket.json `updatedAt`（fresh 读后仅改该字段，供列表排序/最近更新）。
  - 校验：user 与 summary 必填非空，否则 AtbError（明确反馈，不假装已保存）。
- `saveDiscussionMinutes(dataDir, id, { minutes, baseVersion })`：
  - `baseVersion` 必填；与 minutes.meta.json 当前版本不符（他人已更新）→ AtbError 版本冲突，提示重新
    读取最新纪要与轮次后再整理（不静默丢失他人更新）。
  - 成功：minutes.md 原子重写（tmp+rename，复用 core.writeJsonAtomic 思路），version+1 并写 meta，
    刷新 ticket.json updatedAt。
- 读侧：
  - `listDiscussionRounds(dataDir, id)`：按 no 升序返回完整轮次；跳过非法/异讨论文件。
  - 卡片（listDiscussions）：`roundCount` 改为逐轮记录数（旧问答计数迁移至 `legacyRoundCount` 只读
    保留），新增 `lastRoundAt`、`lastSummary`（最新一轮回复总结）、`minutesStale`（纪要落后于最新轮）。
  - `discussionFull`：新增 `rounds`、`minutes: { content, version, updatedAt, stale }`、
    `organizePrompt`、`continuePrompt`；`phase` 新增 `recording`（已存轮次且未发布候选 → 逐轮记录中；
    旧单无轮次仍按 waiting/none 口径）。

### 3. 提示词三件（服务端拼装，oncall-store.mjs）

- `buildStartPrompt`（重写）：含项目根、讨论编号、文档位置（rounds 目录、minutes.md、minutes.meta.json）、
  上下文读取规则（先读纪要与近期轮次，按需追溯原文）、逐轮保存规则（每轮回复后立即经统一入口保存
  用户原文与回复总结；总结含关键观点/理由/取舍/未决问题；工具调用与进度播报不单独计轮；保存成功才
  向用户确认，失败如实说明并可用同幂等键重试）、纪要按需更新规则（版本冲突时重读再整理）。不再要求
  收尾提示词才落盘。
- `buildContinuePrompt`（新增）：任意能访问该项目文档的新会话接续——先校验项目与讨论归属，读纪要与
  近期轮次恢复上下文，轮次编号接续、来源会话标记切换，写入同一讨论；不依赖聊天记忆。
- `buildOrganizePrompt`（新增，替代收尾定位）：「整理结论」= 重新汇总已保存轮次重整纪要（经统一入口，
  先读当前版本）+ 可选候选需求/Bug 草稿（沿用 candidates.json + PUBLISH.json 发布协议）；整理不终止
  讨论、不自动创建条目、不是交流保存的前提。
- `buildFinishPrompt` / `requestFinish` / `POST /finish` 保留兼容（旧会话可能仍持收尾提示词），UI 不再
  提供入口。

### 4. CLI（atb.mjs 新增 `disc` 子命令；统一入口的命令行形态）

- `atb disc show <ASK-ID> [--json] [--dir <项目根>]`：背景 + 纪要（含版本）+ 全部轮次（新会话恢复
  上下文用；归属校验失败明确报错）。
- `atb disc round <ASK-ID> --file <round.json> [--stdin]`：统一追加入口。round.json =
  `{ user, summary, session?, key? }`（长文本走文件，避免命令行转义）。成功输出轮号/roundId/时间；
  失败非零退出并给出可读原因（写入失败、路径不可访问、归属不符、字段缺失）。
- `atb disc minutes <ASK-ID> --file <minutes.md> --base-version <N>`：纪要更新入口，版本冲突非零退出
  并提示重读。

### 5. Server（server.mjs）

不新增写入端点（轮次/纪要由 Agent 经 CLI 统一入口写入，看板只读）。`GET /api/discussion/board` 与
`GET /api/discussion/:id`、`POST /api/discussion` 经 discussionFull/listDiscussions 自动携带新字段。
`finish` 端点保留兼容。

### 6. 前端（web/oncall.js，沿用现有骨架与双主题）

- 页签归并（定稿 README 待确认项）：`DISC_TABS` 由「概况/纪要/成果/提示词」四页签改为
  **「讨论纪要 / 交流记录 / 后续行动」** 三页签，默认「讨论纪要」。原概况元信息（创建时间、成果计数、
  旧绑定需求链接）并入详情头部（标题下 meta 行 + 旧单链接 chip）；原提示词页签取消，提示词改为详情
  顶部操作区按钮 + 页签行之下、通知条之上的可折叠只读块（启动提示词/整理结论两类；复制双回退保留）。
- 头部操作区：`启动提示词` | `复制继续讨论提示词`（直接复制 continuePrompt 并反馈，不打开面板）|
  `整理结论`（展示 organizePrompt）| `归档/继续讨论`。原「讨论完毕」移除（后端 finish 兼容保留）。
- 列表卡片：在现状基础上增加「已保存 N 轮」与最新回复摘要（单行截断）；新轮落盘经 2s 轮询自动刷新
  轮数/摘要/时间（既有 boardSig 机制）。
- 讨论纪要页签：背景 + 最新纪要正文（markdown 渲染）+「纪要待更新」徽标（minutesStale）+ 旧单历史
  问答只读保留；读取失败展示原因与重试入口（沿用 reread）。
- 交流记录页签：按时间从早到晚展示用户原文、回复总结、时间、轮次标识与来源会话；历史默认折叠
  （<details>），最新轮展开；空态说明「尚无已保存交流」并引导复制启动提示词；旧单无逐轮记录时不补造，
  显示历史问答说明。
- 后续行动页签：沿用候选草稿勾选/编辑/批量创建/失败重试与已创建条目跳转（原成果页签整体迁移）；
  零候选正常空态。

### 7. 兼容

旧讨论（含看板代答时期旧问答、已发布成果、已创建条目关联）全部保留：legacyRounds 只读展示、
published 成果与 created 记录不动、归档/继续讨论行为不变；不伪造旧讨论缺失的逐轮记录。快照恢复的
旧 tab 值（overview/drafts/prompt）经既有 discTabOf 校验回落默认页签。

**开源选型（REQ-20260909-015）**：无合适库——需求是本项目讨论目录内的本地 JSON 逐轮追加、文件级
独占创建与乐观版本校验，Node 内建 fs（wx 独占写、tmp+rename 原子替换）即标准做法，引入外部库反而
增加依赖面；未使用开源库，不创建 licenses.md。

## 风险与边界

- 轮次文件损坏/被手改：读侧逐文件容错（跳过非法 JSON 与编号不符文件），列表/详情不展示半成品；不
  自动修复，失败原因经 phase=error/lastError 可见。
- 纪要版本冲突为乐观校验（读-比-写）：极端并发下同 baseVersion 双写仍可能后写覆盖先写，但任一写者
  都必须先读到最新版本号，冲突会被下一次整理发现；本地单用户多会话场景足够（与需求「版本校验或
  等价机制」一致）。
- 提示词协议依赖 Agent 会话执行：在支持的工作流中验证逐轮调用；复制成功不代表已连接或已保存（UI
  文案保留该口径）。
- 讨论内容过长：提示词要求先读纪要与近期轮次、按需追溯原文，读侧不做截断（文档资产完整保留）。
