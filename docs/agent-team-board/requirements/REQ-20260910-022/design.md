# 设计 — REQ-20260910-022 营销与增长：project-growth Skill 与可追溯 AI 策略复盘

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

营销模块（REQ-20260910-019 定位与定价、020 渠道与行动、021 效果与复盘）已提供完整人工闭环。
本条为其接入外部 Agent 会话辅助：界面只生成可复制提示词（不新增常驻模型服务、不自动运行模型），
外部会话执行后经统一 CLI/API 把草稿写回 `marketing/agent-runs/`，用户逐项编辑并显式采纳后才进入正式档案。

## 方案

### 数据层（新增 `scripts/lib/growth-store.mjs`，与 marketing-store 并列）

- 存储：`<dataDir>/marketing/agent-runs/<id>/`（`run.json` 机器记录 + `draft.md` 人类可读草稿，跨会话接续的读取入口）。
- 任务（run）：`id=ar-<hex>`、五类 `type`（positioning/pricing/channels/content/review）、`inputs`（引用及版本）、
  `prompt`（留档）、`observation`（review 观察期）、`continueOf`（接续来源）、状态 `waiting → received → done`、
  `session/receiptAt/summary/draftRef` 与 `receipts`（执行结果日志：success / rejected:stale）。
- 输入版本采集：profile/渠道/实验/行动/观察取各自 `revision`；README 与不可变定价版本、复盘无版本要求；
  空项目（未初始化营销）仅 `README.md` 并在提示词中声明「档案缺失，仅基于 README 与通用方法」。
- 回执 `saveAgentRunReceipt`（外部会话统一写入口）：
  - 幂等：同任务重复提交跳过（不覆盖首次内容，仅返回 `contentChanged` 标记）；双保险——采纳 / 保留也按候选幂等。
  - 过期输入：可变引用 revision 变化、复盘观察期输入集合变化 → 拒绝写入（`rejected:stale` 入日志，不覆盖他人更新），可按当前版本重建。
  - 跨项目：任务 ID 不在本项目 → 报错拒绝，不落入另一项目。
  - 草稿校验：`insufficient=true` 不得携带候选且必须给 `advice` 补采建议；结构非法按字段定位报错、不写盘。
- 采纳（`adoptAgentRunCandidate`）按 kind 复用既有 marketing-store 入口（校验 / 原子写 / 语义边界全部共用）：
  - pricing → `savePricing`（恒新建候选版本，不自动成为当前方案）；positioning → 追加「假设」证据（来源指向 agent-runs，可追溯）；
  - channel/experiment/activity/review → `createChannel/createExperiment/createActivity/createReview`
    （渠道不自动已验证、行动保持草稿不自动发布、复盘保存时固定观察快照）。定位采纳以读取时的当前档案为基线追加，不覆盖他人字段；
    用户表单侧并发由既有 revision 乐观锁（409 重载）保护。
- 保留草稿（`keepAgentRunCandidate`）：不写入正式档案；全部候选处理完 → `done`。

### 服务接口（server.mjs，绑定 `?project=`）

`GET /api/marketing/growth`（列表 + 技能可用性）、`GET .../growth/inputs`（面板资料预览）、
`POST .../growth/run`（创建任务 + 返回提示词；review 需 from/to）、`GET .../growth/run/:id`（详情，未知 404）、
`POST .../growth/run/edit|adopt|keep`（409/400 映射沿用 boardPost）。

### 统一 CLI 回执（atb.mjs 新增 `growth` 子命令）

`atb growth receipt <RUN-ID> --file <draft.json> [--session <会话>] --dir <项目根>`（输出一行 JSON 回执，供外部会话核验
「已保存」）、`atb growth show <ID>`（跨会话接续读取）、`atb growth list`。提示词中的保存协议即携带该命令（含 atb 绝对路径与项目根）。

### 前端（marketing.js + style.css）

四页右上角五类 AI 入口按钮（`data-ai-type`）；任务面板（资料引用及版本、技能缺失能力缺口与手工提示词兜底、
review 观察期选择；复制仅写剪贴板并登记任务 →「尚未收到结果」）；草稿面板（事实/假设/待确认、证据引用、
缺失信息、候选逐项 编辑/采纳/保留草稿；数据不足仅显示补采建议且无候选）；概览页「AI 运行记录」表
（任务 ID、类型、输入引用及版本、状态、写入时间、来源会话、执行结果、操作：查看草稿 / 复制继续任务提示词）；
输入基线过期的任务显示「过期（未写入）」并提供按当前版本重建；弹层 Esc 关闭；采纳后刷新对应页数据。

### 开源选型（REQ-20260909-015）

- 自研理由：本条交付的是「任务登记 / 提示词生成 / 回执幂等 / 候选采纳」的数据与交互层，全部落在既有自研
  marketing-store / server / marketing.js 体系内；无合适的 npm 库承担该领域逻辑，引入通用库成本高于自研。
- 未引入任何 npm 依赖，**不创建 licenses.md**。
- 外部 skill 候选 [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
  （product-marketing / pricing / marketing-plan / launch / content-strategy / copywriting / social / analytics /
  attribution / ab-testing 按入口映射）：**未安装、未复制任何源码**，仅在提示词与看板中记录候选与来源，
  默认呈现「技能缺失 + 手工提示词兜底」，不假称已运行外部 skill。实际引入前须固定已核验版本、审阅 SKILL.md
  写入行为、确认许可在 MIT/Apache-2.0/BSD/ISC/0BSD/Unlicense 白名单内，并为对应条目补 licenses.md。

## 风险与边界

- 外部会话可能不按协议写回：接收端全部校验（幂等 / 过期 / 跨项目 / 数据不足不带候选 / kind 白名单），
  采纳前不触碰正式档案；提示词明确「未收到写入回执不得宣称已保存」。
- 已授权任务仅生成本地草稿；对外发布、发送、付费及线上价格变更均不在本条范围（提示词显式约束 + 无对应代码路径）。
- `agent-runs/run.json` 损坏：只读占位（corrupt），列表不炸、写入拒绝，请人工处理。
- 并发：run 记录含 revision；采纳定位候选以读取时当前档案为基线（进程内单写者）；跨窗口表单编辑由既有 409 机制保护。
