# 设计 — REQ-20260909-003 需求文档引用讨论、纪要归档与说明同步

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260908-022 已把 ASK 讨论单绑定需求（oncall-store），但那是「看板每轮派单回答」模式；
本项要的是「用户复制启动提示词到 Agent 新会话持续讨论 → 收尾时 Agent 落盘纪要与
README 修改草稿 → 看板读取、人工归档 / 逐项应用」的单人文档工作流。看板不聊天、不派单、
不感知 Agent 在线状态；所有「已连接 / 已生成」一律以落盘文件为准。

## 方案

### 数据层：新模块 `scripts/lib/req-disc-store.mjs`（不动 oncall-store）

事实源 `<dataDir>/discussions/`（`docs/agent-team-board/discussions/`，随项目走、进版本控制）：

```
discussions/
  settings.json              # { version:1, date, counters:{ disc } }（.locks/disc.lock 互斥，按日重置）
  DISC-YYYYMMDD-NNN/         # 独立编号序列（回答 README「待确认1」：不沿用 ASK，正式前缀 DISC）
    discussion.json          # 元数据（见下）
    readme-versions/vN.md    # 每次「确认应用」前的 README 完整旧版（vN = 应用前版本号）
    rounds/N/
      minutes.md             # 纪要（Agent 写）
      readme-draft.json      # 说明修改草稿（Agent 写）
      PUBLISH.json           # 发布标记（Agent 最后写；缺它视为未发布，不读半成品）
```

discussion.json：

```json
{ "version":1, "id":"DISC-…", "reqId":"REQ-…", "createdAt":"…", "updatedAt":"…",
  "readmeVersion":1,
  "rounds":[ { "no":1, "startedAt":"…", "finishPromptAt":null, "publishedAt":null,
               "archivedAt":null, "applied":null } ],
  "quotes":[ { "at","doc","startLine","endLine","version","text" } ],
  "history":[ … ] }
```

- `readmeVersion`：本讨论视角的 README 版本计数，从 1 起；每次成功应用 +1。
  引用快照记录复制时的版本，纪要引用据此回看 `readme-versions/` 快照，不盲目定位现文。
- 「开始讨论」每次新建 DISC（README「已确认流程 1」：先创建唯一编号再生成提示词）；
  「继续讨论」在同一 DISC 开新轮（README「待确认2」取舍：沿用同讨论新轮次，
  既有归档 / 应用记录保留在新轮次之外的旧轮上，不覆盖）。

### 发布与读取协议（Agent ↔ 看板的唯一契约）

- 启动提示词（store `buildStartPrompt`）：项目根、需求编号与标题、讨论编号与轮次、
  三文档绝对路径（只读）、落盘目录（rounds/N 绝对路径）与三文件名、
  「区分明确共识 / Agent 建议 / 未决问题、不改文档不改状态」约定。
- 收尾提示词（store `buildFinishPrompt`）：同一编号/路径/轮次；要求先完整写
  `minutes.md`（六节：明确共识 / Agent 建议·待确认 / 未决问题 / 原文引用 / 建议修改 / 后续行动）
  与 `readme-draft.json`，最后才写 `PUBLISH.json`；草稿须含
  `baseline`（Agent 对当前 README 计算 SHA-256，如 `shasum -a 256`）、`changes[]`
  （id/title/before/after/basis），仅「明确共识」支撑的修改可入草稿。
- 读取（store `readOutcome`）：无 `PUBLISH.json` → `waiting`；有标记但绑定不符
  （discussionId/reqId/round 任一不匹配当前讨论）→ `error`（不串单）；文件缺失、
  草稿 JSON/字段非法 → `error`（附原因）；全部成套 → `published`（带 minutes 全文与 draft）。

### 归档与应用（写入保护）

- `archiveRound`：仅置 `archivedAt`（幂等），不写 README——「只归档不改说明」。
- `applyDraft`：
  1. 最新轮须 `published`；已应用 → 原样返回（重复点击 / 刷新不二次写入）。
  2. `selected` 非空且 ⊆ 草稿 change id；空选择报「未选择修改」。
  3. 基线校验：当前 README SHA-256 ≠ `draft.baseline` → 报「说明已变化，请在原会话重新生成草稿」，
     保留草稿与引用快照（不覆盖、不跳转）。
  4. 每个 before 必须在 README 中恰好出现一次；否则整体失败（无部分成功）。
  5. 写 `readme-versions/vN.md`（旧版）→ 原子替换写 README → 更新元数据
     （`applied = { at, by, items, beforeVersion, afterVersion }`、`readmeVersion=N+1`）。
- 不改变需求状态机（status.json 不动）；README.md 由本 store 直接写条目目录（不经 /api/new 等）。

### 服务端：`server.mjs` 新增 `/api/req-disc*`（沿用 ?project= 与 400 口径）

- `GET  /api/req-disc?req=<REQ-ID>`：该需求最新讨论 + 全量状态（含最新轮 outcome、
  提示词现算、引用列表、各轮归档/应用记录）。前端随 2 秒主轮询拉取 → 自动检测发布。
- `POST /api/req-disc/start { reqId }`：创建讨论，返回状态 + 启动提示词。
- `POST /api/req-disc/<id>/finish`：置 `finishPromptAt`，返回收尾提示词（可重复查看）。
- `POST /api/req-disc/<id>/continue`：开新轮，返回带轮次的启动提示词。
- `POST /api/req-disc/<id>/quote { doc,startLine,endLine,version,text }`：存引用快照。
- `POST /api/req-disc/<id>/archive`：归档最新轮纪要。
- `POST /api/req-disc/<id>/apply { selected }`：应用勾选草稿（错误 → 400 + 原因，选择不丢）。

不新增 CLI：Agent 侧动作全部是「往提示词给定的绝对路径写文件」，无需 atb 命令。

### 前端：新模块 `scripts/web/req-disc.js`（`window.ATBReqDisc`，模式同 ATBOncall）

- 挂载：`app.js renderDrawer` 在需求抽屉「需求讨论」区块下方渲染
  `<section id="reqDocDisc">`，`bindReqDiscussions` 后调 `ATBReqDisc.mount(reqId)`；
  `poll()` 在 `refreshReqDiscussions()` 旁调 `ATBReqDisc.refresh()`（自动检测发布）。
- 区块内自上而下：操作条（开始讨论 / 启动提示词 / 讨论完毕 + 阶段反馈）、
  提示词面板（只读 textarea + 复制；复制失败保留文本提示手工复制）、
  「说明 · 讨论纪要」双标签。
- 说明 = 阅读模式 README：轻量块级解析（段落 / 标题 / 列表 / 引用 / 代码栅栏 / 表格 / 分隔线），
  每块左侧源行号按钮（`start` 或 `start–end`，1 基，源码行而非视觉行）；段落与代码块用
  `pre-line`/`pre` 保留源换行，块内选文可算出精确源行范围；跨块 / 列表表格内选文
  明确提示「请点击行号引用整段」，不伪造行号。选中后段落旁出现「复制引用」，
  复制文本含需求/讨论编号、文档绝对路径、源行范围、版本 vN、原文快照与「我的问题：」尾巴，
  同时 POST 保存引用快照（复制记录 ≠ 讨论记录）。
- 纪要：空态（尚无纪要）→ 等待态（等待纪要与草稿 / 正在读取 / 读取失败 + 重试，
  「再次查看收尾提示词」始终可用）→ 成果态（纪要 Markdown 渲染、六节由 Agent 产出、
  「确认归档」「继续讨论」独立操作；草稿逐项 before/after/basis 展示，默认全勾可取消，
  「确认应用 N 项」/「未选择修改」禁用态；已应用展示选中项、时间、来源讨论、
  前后版本与保留旧版说明；基线不符 / 匹配失败显示原因并保留草稿）。
- 样式：新增 `rd-*` 类，复用现有 `.btn/.chip/.notice/.tabs` 与深浅色变量；
  行号/复制/标签/复选框全部可键盘聚焦；375px 单列换行不横向溢出。

## 风险与边界

- Agent 不按协议落盘（缺 PUBLISH、绑定错、草稿非法）一律进入 error 态显示原因并可重试，
  绝不把旧轮 / 半成品当新成果。
- README 被用户在讨论期间手改：基线 SHA-256 校验拦截应用；引用回看依赖快照而非现文。
- 复杂 Markdown（表格 / 跨段）不猜行号——按钮引整段，选文只在可精确映射的块内开放。
- 不做多人冲突界面；写 README 前先留旧版，应用幂等（元数据判定已应用即不再写）。
