# 设计 — REQ-20260909-004 开放式讨论模块重构与纪要生成需求或 Bug

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

讨论模块现状是 REQ-20260907-001 的「看板代答」咨询看板：`scripts/lib/oncall-store.mjs`
（事实源 `<dataDir>/oncall/tickets/ASK-YYYYMMDD-NNN/`）、页面 `scripts/web/oncall.js`
（`#oncallView` + `#oncallDrawer` 抽屉）、接口 `scripts/server.mjs` 的 `/api/oncall/*`。
本需求把交互模式改为「Agent 外部会话讨论 + 看板沉淀成果」：看板只负责启动/收尾提示词、
读取纪要、编辑草稿并创建候选需求 / Bug；讨论本身不绑定需求。

与 REQ-20260909-003（需求文档讨论，DISC 序列）共享「发布协议读取成果」的思路，但两者
入口、范围与成果类型不同：003 成果是 README 修改草稿（绑定需求），004 成果是全新的
REQ/BUG 条目（开放式，不绑定）。

## 方案

### 1. 数据层：扩展 `oncall-store.mjs`（保持 ASK 序列与旧函数不动）

沿用 `oncall/tickets/ASK-YYYYMMDD-NNN/` 目录与 `ticket.json`，新增讨论语义字段：

- **两态状态（持久化）**：`discussing | archived`（`DISCUSSION_STATUS`）。
  - 旧执行状态映射（读时归一，不回写旧记录）：`pending/answering/answered/failed`
    一律按「讨论中」展示；`archived` 为「已归档」。归档/继续讨论操作才写入新值。
  - 旧 `rounds/`（看板代答的历史问答）在详情「背景与纪要」页尾部只读展示（含附件
    内联），不提供追问/派单入口——旧回答按范围边界保留。
- **新单（`createDiscussion`）**：`{ title(必填≤120), background(可选) }`，
  `reqId` 恒为 null（讨论不再绑定需求；旧单的 `reqId` 字段保留只读兼容）。
  背景存根 `question.md`（沿用既有文件位，空背景允许）。
- **约定目录（成果落盘协议，位于单目录根）**：
  - `minutes.md`：纪要 Markdown（共识 / 建议与取舍 / 未决问题 / 后续行动等）。
  - `candidates.json`：`{ "discussionId": "ASK-…", "items": [{ id, type:
    "requirement"|"bug", title, description, repro?, actual?, expected?, acceptance? }] }`
    （Bug 项含复现/实际/预期；零候选合法——`items` 为空数组）。
  - `PUBLISH.json`：`{ "discussionId": "ASK-…", "publishedAt": "<ISO>" }`，最后写。
  - 看板只认发布标记：无标记一律 waiting（含半成品）；有标记但编号不符 / 缺纪要 /
    candidates 非法（结构、绑定、重复 id、类型、标题空或超 120）→ error 并给出可读
    原因，拒绝渲染半成品。首次合法读到时把 `publishedAt` 回写 `ticket.json`（幂等）。
- **提示词（服务端拼装，前端只展示/复制）**：
  - 启动提示词：讨论编号、项目根、标题、背景、落盘约定三件套路径；声明不修改代码、
    不创建条目。
  - 收尾提示词（`requestFinish`，幂等只记 `finishPromptAt`）：要求把纪要与候选草稿
    成套写入约定目录，最后写发布标记。讨论状态保持「讨论中」。
- **归档 / 继续讨论（`archiveDiscussion` / `resumeDiscussion`）**：只改状态，不动纪要、
  草稿与已创建条目记录；归档无须先生成条目。
- **草稿创建（`createItems`）**：入参为勾选草稿数组（含用户编辑后的
  标题/描述/验收标准等）。逐条：
  1. 校验（标题必填 ≤120、type 合法）——失败记入逐项结果，不中断其他条目；
  2. 已在 `ticket.json.created` 中的草稿直接跳过（幂等，防刷新/重试重复创建）；
  3. 走既有 `core.createItem`（初始状态 submitted 待接受）；
  4. 创建后补写条目文档：README 元信息加「来源讨论」行；需求补「验收标准」清单、
    Bug 补「复现步骤 / 期望行为」；`status.json` 增只读字段 `sourceDiscussion`（编号+标题），
    需求详情据此展示「来源讨论」跳转（双向关联的条目侧）；
  5. `ticket.json.created[draftId] = { itemId, type, title, at }` 持久化。
- **卡片 / 全量视图**：`discussionCard`（列表用：编号、标题、两态、更新时间、阶段提示
  等待纪要/纪要已生成/有待创建草稿/读取失败、成果计数）；`discussionFull`（详情用：背景、
  两类提示词、outcome、草稿 + 已创建条目（实时读条目 status.json 供跳转展示，条目删除
  时标记缺失）、旧轮问答、历史）。

### 2. 接口：`scripts/server.mjs` 新增 `/api/discussion*`

- `GET /api/discussion/board`：两态卡片列表（未初始化项目返回空态引导）。
- `POST /api/discussion`：`{ title, background }` 创建并返回全量（含启动提示词）。
- `GET /api/discussion/:id`：全量详情。
- `POST /api/discussion/:id/finish|archive|resume|reread`：对应动作后返回全量。
- `POST /api/discussion/:id/create-items`：`{ items: [...] }` 逐条创建，返回
  `{ results: [{ draftId, ok, itemId?, error? }], discussion }`。
- 旧 `/api/oncall/*`（dispatch/ask/answer 等看板代答接口）保留：CLI `atb oncall` 与既有
  测试仍依赖，不在本需求删除范围；新 UI 不再调用。

### 3. 前端：重写 `scripts/web/oncall.js`（容器仍是 `#oncallView`）

- 复用需求模块形态（`.req-split` / `.req-list-wrap` / `.drawer` 样式族）：宽屏左列表右详情；
  窄屏（≤1020px）详情覆盖滑入，「返回列表」保留筛选与列表滚动位置。
- 顶部两档胶囊筛选「讨论中 / 已归档」（`filter-chip` + 实时计数），列表按最近更新排序。
- 列表行：标题、编号、状态胶囊、最近更新时间、成果提示副标题。
- 详情头：编号、标题、状态胶囊、操作行「启动提示词 / 讨论完毕 / 归档讨论（继续讨论）」。
- 提示词框：只读 textarea + 复制按钮 + 收起；剪贴板不可用回退为全选 + 手动 ⌘C 提示。
- 阶段通知条：读取中 / 读取失败（含原因与重试入口）/ 等待纪要 / 纪要已生成，
  均非状态，不参与筛选。
- 正文两个标签：「背景与纪要」（讨论背景 + 纪要 Markdown 渲染 + 旧单历史问答只读区）、
  「生成需求 / Bug」（草稿卡：勾选、类型只读、可编辑标题/描述/验收标准、Bug 含
  复现/实际/预期；批量创建含必填校验、创建中禁用、逐项结果与仅重试失败项；
  已创建成果展示真实编号/标题/待接受与跳转入口）。
- `index.html`：`#oncallView` 改为 split 骨架；移除 `#oncallDrawer`/`#oncallMask`
  （保留 `#oncallLightbox` 供旧单附件放大）；统一新建弹窗「讨论」类型改为
  标题 + 背景（可选），去掉关联需求与截图附件行。
- `app.js`：模块副标题、ask 类型创建改走 `/api/discussion` 并在保存后定位新讨论、
  展示启动提示词；需求抽屉「需求讨论」区块保留旧绑定讨论列表（两态口径），创建入口
  移除（新版讨论不绑定需求，绑需求场景由 REQ-20260909-003 的文档讨论承接）；
  条目详情新增「来源讨论」跳转；导出 `reveal(id)` 供创建后定位。

### 4. 测试

新增 `scripts/tests/discussion-store.test.mjs`（S 用例：两态映射、发布协议读取、草稿
校验、创建幂等/部分失败、归档兼容旧单）、`discussion-serve.test.mjs`（接口契约）、
`discussion-ui.test.mjs`（静态契约 + vm 行为）；同步更新受影响的旧前端契约测试
（oncall-ui / oncall-view-lean / oncall-question-optional / oncall-req-bind 的前端断言）。

## 风险与边界

- **旧数据兼容**：旧单不改写、不删除；旧 `reqId` 绑定仅展示；旧派单 CLI/接口保留但
  新 UI 不再暴露。旧状态读时归一为「讨论中」。
- **半写入防护**：无 PUBLISH.json 一律 waiting；有标记但不成套/非法 → error 不渲染。
- **重复创建防护**：以 `ticket.json.created` 草稿 id 幂等；已创建项前端不可重复提交。
- **并发**：沿用 `oncall` 计数锁；条目创建走 `core.createItem`（config.lock 串号）。
- **不引入**：聊天输入面板、README 差异对比、多人模拟、子代理在线状态。
