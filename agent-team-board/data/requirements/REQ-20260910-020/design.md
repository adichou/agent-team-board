# 设计 — REQ-20260910-020 营销与增长：渠道计划、推广实验与内容行动看板

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

依赖 REQ-20260910-019 已交付的 marketing-store（profile.json revision 乐观锁 + pricing/vN.json 不可变版本）与营销模块骨架（四页签、「渠道与行动」页签占位禁用）。本条交付第一版 P0 的第二块：渠道档案、推广实验与内容行动看板。

## 方案

（技术选型、接口设计、影响面）

### 数据契约（<dataDir>/marketing/ 内，与 019 同域）

```text
channels/<ch-*.json>      渠道：长期触点档案
experiments/<exp-*.json>  实验：一个推广假设 + 定价版本绑定 + 最终决策
activities/<act-*.json>   行动：一篇内容或一次发布（内容草稿内联，linkedReqs + statusHistory）
```

- 相对总体规划的调整：`experiments/<id>/experiment.json`、`activities/<id>/(activity.json|content.md)` 收敛为单文件（`<id>.json`），边界与语义不变（schemaVersion / 稳定 ID / createdAt / updatedAt / revision 齐全）；reviews 与指标观察留给 REQ-20260910-021。
- 实体读写全部经 marketing-store：revision 乐观锁（过期 `MarketingConflictError` → HTTP 409 携带 currentRevision）；单文件损坏 → `{ id, corrupt: true }` 只读占位、写操作拒绝（不静默覆盖）；集合按 createdAt 稳定排序。
- ID 分配 `ch-|exp-|act-` + 随机 4 字节 hex，存在即重抽（不依赖目录名计数）。

### 行动状态机

```text
draft → pending → published → observing → reviewed
draft/pending/published/observing → stopped（reviewed 不能停止，结论由复盘决策承载）
```

- 链式推进只允许紧邻下一步；跳步拒绝（回退走「更正」）。
- 目标状态必备信息：pending 需内容草稿；published 需发布时间 +（发布链接或凭据说明）；reviewed 需结果依据 + 决策（continue / adjust / stop / undetermined，undetermined=暂不能判断，不等同验证成功）；stopped 需原因。
- 保存（activity/save）受状态不变量保护：published 之后不得清空发布凭据、reviewed 之后不得清空依据与决策、stopped 之后不得清空原因。
- 更正（correct）：仅回退（含从 stopped 恢复），必填原因，历史条目带 `type: 'correct'`；全部状态变更追加 statusHistory。

### 实验与复制

- 有预算或实际支出必须指定币种（不同币种独立记录不换算）；0=实际零合法、null=未知；定价版本绑定时须存在（pricing/vN 不可变 ⇒ 修改当前定价不改变历史绑定）。
- copyExperiment：新 ID + copiedFrom；预算计划 / 工时计划 / 定价版本保留，实际支出 / 实际工时 / 决策 / 观察窗口清空；行动全部（或 fromActivityId 指定单条）复制为草稿，发布信息 / 关联 REQ 清空、各自保留 copiedFrom。

### 创建开发需求（双向关联 + 幂等）

- 经 core.createItem（type=requirement）落 submitted，不自动接受或实施；描述追加「来源：营销「渠道与行动」看板 · 行动 <id> · 实验 <id>」，行动侧 linkedReqs 记录 REQ 编号 → 双向可追溯。
- 幂等：请求携带客户端生成 key；命中已有同 key 链接直接返回（created:false）。写入两阶段：先在行动上登记 key 占位、再创建 REQ 回填编号——中途失败后同 key 重试只补创建，不重复占号。
- 前端跳转复用既有 `atb:open-item` 自定义事件（app.js 打开需求详情），不改 app.js。

### 服务接口（server.mjs，?project= 绑定）

```text
GET  /api/marketing/board               两态读取（未初始化营销 → initialized:false）
POST /api/marketing/channel             新建渠道（201）
POST /api/marketing/channel/save        更新渠道（409/400 分流）
POST /api/marketing/experiment          新建实验（201）
POST /api/marketing/experiment/save     更新实验
POST /api/marketing/experiment/copy     复制为新实验（201）
POST /api/marketing/activity            新建行动（201，初始 draft）
POST /api/marketing/activity/save       更新行动字段
POST /api/marketing/activity/status     状态推进（payload 只带登记信息，不带内容正文）
POST /api/marketing/activity/correct    误操作更正（reason 必填）
POST /api/marketing/activity/req        创建开发需求（201 / 幂等命中 200）
```

统一错误分流：`MarketingConflictError` → 409 `{ conflict:true, currentRevision }`；带 `.fields` 的 AtbError → 400 `{ error, fields }`（字段定位）；其余 AtbError → 400。

### 前端（marketing.js，无新文件）

- 「渠道与行动」页签启用：工具栏（渠道 / 实验筛选 + ＋渠道 / ＋实验 / ＋行动 + 清除筛选）、实验条（假设 / 主指标 / 币种化预算与支出 / 定价版本 / 决策，编辑与复制入口）、六状态列看板；卡片显示渠道、计划时间（含时区）、实验主指标、负责人；draft/pending 且计划时间过期仅显示「逾期」徽标，不自动发布。
- 点击卡片右侧详情抽屉：基本信息（渠道 / 实验 / 计划时间与时区 / 负责人 / 操作历史）、内容素材（标题 / 内容草稿 / 素材引用 + 复制文案）、结果与关联（状态推进按当前状态渲染对应登记表单、停止、更正、下一步、关联需求 + 创建开发需求 + 跳转）。
- 窄屏（≤960px）：六列改单列 + 状态筛选（`#mktNarrowStatus`，宽屏隐藏），非选中状态列在窄屏媒体查询内隐藏。
- 反馈：空态引导新建渠道 / 实验；读取失败可重试；无匹配一键清除筛选；保存 / 复制 / 创建成功轻提示（`#mktToast`）；失败保留草稿可重试；409 提示「重新载入」并保留本地草稿。
- 复制文案仅 `navigator.clipboard.writeText`（失败回退 execCommand），不发任何网络请求；标记待发布的状态推进请求不含内容正文（payload 仅登记信息）。
- 弹窗（渠道 / 实验 / 行动 / 开发需求）在视图内渲染，随项目切换由 hardReset 清理；抽屉草稿与弹窗填写计入 `hasUnsaved()` 项目切换守卫；快照（snapshot/restoreView）扩展 board 节（渠道 / 实验筛选 + 打开的抽屉），表单草稿不进快照。

### 影响面

- `scripts/lib/marketing-store.mjs`（扩展，019 部分未改动）、`scripts/server.mjs`（handleMarketingApi 内新增路由）、`scripts/web/marketing.js`（页签启用 + 看板）、`scripts/web/style.css`（追加看板样式）；index.html / app.js 零改动。

**开源选型（REQ-20260909-015）**：未引入外部开源库，自研理由：无合适库——本条是项目本地 JSON 状态机 + 无构建 vanilla DOM 交互，与 REQ-20260910-019 同范式（数据层 + 原生 fetch/DOM），引入通用看板 / 状态机库的适配成本高于自研且违背零构建约束。未使用开源库，故不创建 licenses.md。

## 风险与边界

- 行动内容草稿内联 activity.json（≤20000 字），超长内容需求出现时再评估拆 content.md（数据契约已预留语义边界）；
- REQ 创建的两阶段写入在极端磁盘故障下可能留下 key 占位（id 为空、界面标注「创建中 / 上次失败，重试同一 key」），人工可在需求模块核对后重试；
- 实验的复盘正文与指标观察由 REQ-20260910-021 交付；「效果与复盘」页签保持禁用标注暂不可用。
