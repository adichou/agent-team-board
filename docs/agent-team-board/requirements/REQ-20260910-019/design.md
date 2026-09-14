# 设计 — REQ-20260910-019 营销与增长：项目档案、定位与定价版本管理

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

营销模块第一条（P0）：在既有五模块导航（讨论/需求/任务/文件/设置）中新增「营销」，
内部四页签（概览 / 定位与定价 / 渠道与行动 / 效果与复盘），后两页由 REQ-20260910-020/021
交付，本次以禁用态标注「暂不可用」。本条交付项目营销档案的建立、定位与证据维护、
定价候选版本管理与「设为当前方案」的显式流转。

## 方案

（技术选型、接口设计、影响面）

### 数据契约（项目数据目录 `<dataDir>/marketing/`）

沿用总体规划的边界与语义，文件名按本条实际落地微调（规划允许）：

```text
marketing/
  profile.json          # 营销档案：定位字段 + 证据条目 + 当前定价指针（唯一可变文件，revision 乐观锁）
  pricing/v<N>.json     # 定价版本：一次保存一个新文件，永不覆盖（v1、v2…按现存最大 N 递增）
```

- `profile.json`：`{ schemaVersion:1, id:"mp-<rand>", createdAt, updatedAt, revision,
  positioning:{ intro, stage, markets, audience, scenarios, painPoints, alternatives,
  differentiators, links, stageGoal, primaryMetric, budget, weeklyHours },
  evidence:[{ id, type, content, source, collectedAt }], currentPricing: null|"vN" }`。
  - `stage ∈ exploring|validating|launched|growing`（探索/验证/上线/增长）；
  - `evidence[].type ∈ fact|hypothesis|unverified`（事实/假设/待确认），
    `source` 为链接或访谈引用，`collectedAt` 为采集日期（YYYY-MM-DD）；
  - `budget / weeklyHours`：`null` 表示未填，填则必须 ≥0 数字；
  - `currentPricing` 是显式指针：只有「设为当前方案」操作会改它。
- `pricing/v<N>.json`：`{ schemaVersion:1, version:"vN", createdAt, model, currency,
  cycle, packages:[{ name, benefits, price }], costBasis, competitorBasis, validationMethod }`。
  - `model ∈ free|onetime|subscription|usage|hybrid`（免费/买断/订阅/按量/混合）；
  - 候选价格 `price`：未知留 `null`（不生成无依据的确定价格），填则必须 ≥0 数字；
  - 版本文件不可变：保存恒新建 `v<N+1>`，历史版本字节不动（后续渠道/活动的
    「创建时绑定版本」引用因此稳定）。
- 并发：`profile.json` 携带 `revision`（int，初始化为 1，每次成功保存 +1）。保存请求
  必须带期望 `revision`，不匹配返回 409 冲突；旧文件保持原样（写盘走 core.writeJsonAtomic
  原子替换，失败不损坏旧文件）。
- 损坏处理：`profile.json` 损坏 → 读取抛错（前端显示读取失败可重试，不静默重建）；
  单个 `pricing/vN.json` 损坏 → 该版本在列表中以 `corrupt:true` 标注只读，其余版本照常。
- 隔离：所有数据按 `?project=` 解析出的项目数据目录归属，同名不同路径项目天然隔离
  （与 requirements/bugs 同一真源规则）。无 `marketing/` 目录视为「未初始化营销档案」，
  历史项目不需迁移。

### 服务接口（server.mjs 新增，均走 `?project=` 与既有跨站防护）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/marketing/state` | `{initialized:false}` 或 `{initialized:true, profile, versions, current}`；未初始化看板的项目同样返回 `initialized:false`（可正常打开） |
| POST | `/api/marketing/init` | 显式初始化：读项目根 `README.md` 首个非标题段落作 `intro` 草稿（仅草稿，不代表市场已验证），`stage=exploring`，其余留空/null；已初始化 → 400 |
| POST | `/api/marketing/profile` | 保存定位+证据，body 带 `revision`；字段非法 → 400 `{error, fields}`；revision 过期 → 409 `{error, conflict:true}`；成功返回新 state |
| POST | `/api/marketing/pricing` | 保存为定价新版本（永不改当前指针）；校验：`model` 枚举；收费模式非 `free` 时 `currency` 必填；`subscription` 时 `cycle` 必填；`price` null 或 ≥0 数字。非法 → 400 `{error, fields}` |
| POST | `/api/marketing/pricing/current` | body `{version}`，显式设当前方案；版本不存在 → 400 |

错误映射：业务校验走 `AtbError`（400）；并发冲突单独返回 409。CLI/服务共用逻辑收敛在
`scripts/lib/marketing-store.mjs`（与 oncall-store 同范式：UI 不直接拼机器状态）。

### 前端集成

- `index.html`：模块导航在「文件」与「设置」之间插入 `data-view="marketing"` 的「营销」
  页签；新增 `<section id="marketingView">`（四页签 + 概览三卡 + 概览摘要 + 左表单右
  证据/版本的分栏）；新增未保存切换确认弹窗 `#mktSwitchWrap`（保存并切换/放弃/取消）；
  `marketing.js` 在 `app.js` 之前引入。
- `app.js`：`VIEWS` 增 `marketing`；`setView` 切容器显隐并调 `ATBMarketing.enter(project)`；
  `MODULE_SUB` 增营销副标题（营销视图无搜索对象，与设置同法隐藏搜索框）；
  刷新快照（REQ-20260910-001）增 `marketing` 节（页签 + 选中版本），`applyViewSnapshot`
  委托 `ATBMarketing.restoreView`；`switchProject` 重置营销模块状态；
  `#projectSel` change 先问 `ATBMarketing.hasUnsaved()`，有未保存内容时弹三选一确认
  （保存并切换 → 保存成功后再切换；放弃 → 丢弃草稿直接切换；取消 → 选择器回弹不切换）。
- `scripts/web/marketing.js`（新文件，IIFE 暴露 `window.ATBMarketing`，oncall.js 同范式）：
  - 状态机：`empty(未初始化引导：建立营销档案) → loading → ready | loadError(重试)`；
    保存中禁重复提交、成功展示保存时间；保存失败保留编辑内容并给重试；409 冲突提示
    「重新载入」（拉最新 revision，本地草稿保留，不静默覆盖）；校验错误定位到字段
    （`.field-err` 就地提示 + 聚焦首个错误字段）。
  - 定位与定价页左表单右证据/版本，复用 `req-split` 结构，窄屏媒体查询上下排列；
    深浅色沿用 CSS 变量（prefers-color-scheme）；键盘走原生 Tab/Esc 约定。
  - 版本列表：点击历史版本 → 只读查看（不回填表单）；「设为当前方案」为显式按钮，
    候选保存不会自动成为当前定价。
  - 草稿脏标记 `hasUnsaved()` 供项目切换守卫；`discardDraft()` 供「放弃」。
- `style.css`：新增 `.marketing-view` 等样式与窄屏断点，全部走既有 CSS 变量。
- `ui-demo.html`：条目目录内单文件演示（内联 CSS/JS、无外网依赖、无构建），
  覆盖 README 列举的全部交互与状态切换，模拟数据不写真实项目。

### 自研与开源选型（REQ-20260909-015）

未引入开源库，不创建 licenses.md。理由（自研三选一之「无合适库的原因」）：本条为
本看板私有的 UI 模块 + 每项目 JSON 文件存储，与既有零依赖 Node http / 原生 JS 前端
架构强耦合（oncall-store/req-disc-store 同范式），任何通用库（表单/状态/存储）都需
额外适配层且引入运行时依赖，收益低于自研；体量约一个 store 文件 + 一个前端模块文件。

## 风险与边界

- 定价版本不可变是后续条目（渠道/活动引用创建时版本）的契约，本条只保证「保存恒新建
  + 指针显式切换」，不做删除（删除优先归档属后续需求）。
- 「读取 README 形成草稿」仅预填产品简介，不推断市场需求已验证（界面明示草稿来源）。
- 本模块只记录方案，不触碰商店/支付系统实际价格。
- 渠道与行动 / 效果与复盘两页签渲染禁用态与「暂不可用」标注，逻辑留待 020/021。
- 营销档案初始化必须由用户点击触发（POST /api/marketing/init 不在任何自动流程中调用）。
