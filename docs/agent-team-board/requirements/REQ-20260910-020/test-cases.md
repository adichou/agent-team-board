# 测试用例 — REQ-20260910-020 营销与增长：渠道计划、推广实验与内容行动看板

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 三份测试：`marketing-board-store.test.mjs`（数据层 B1~B12）、
> `marketing-board-serve.test.mjs`（服务接口 V1~V7）、`marketing-board-ui.test.mjs`（前端 W1~W8）。

## 数据层（marketing-store.mjs，B 系列）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | 渠道创建：必填平台缺失/非法优先级/负每周投入 → 字段错误；合法创建落盘 `channels/<id>.json`（revision=1、稳定 ID、默认空模板字段），readBoard 可读 | P0 | 通过 |
| B2 | 渠道更新：revision 乐观锁（过期 → MarketingConflictError 且旧文件字节不变）；字段校验定位 | P0 | 通过 |
| B3 | 实验创建：假设必填；观察起止格式与先后校验；定价版本必须存在；channelId 必须存在；不同币种/零预算（0 + 币种）可保存，null=未知 | P0 | 通过 |
| B4 | 实验有预算/支出但缺币种 → 字段错误；无任何费用字段时币种可空 | P0 | 通过 |
| B5 | 实验更新与冲突：revision 过期拒绝；绑定 v1 后新增/切换当前定价不改变实验绑定（版本文件不可变） | P0 | 通过 |
| B6 | 行动创建：channelId 必填且存在；experimentId 可选但必须存在；初始 status=draft 且 statusHistory 记录 from=null→draft | P0 | 通过 |
| B7 | 状态推进：draft→pending 需内容草稿（缺失 → fields.contentDraft，状态不变）；pending→published 需发布时间 +（链接或凭据说明）（缺失 → 字段错误）；published→observing→reviewed 链路 | P0 | 通过 |
| B8 | 复盘校验：reviewed 需结果依据 + 决策（continue/adjust/stop/undetermined）；undetermined=暂不能判断（不等同验证成功，仍需依据）；未复盘状态停止需原因，reviewed 不能停止 | P0 | 通过 |
| B9 | 状态推进只允许链式下一步或停止：跳步（draft→published）与非相邻前进拒绝 | P1 | 通过 |
| B10 | 误操作更正：回退到任意更早状态（含从 stopped 恢复）记录原因与历史（type=correct）；前进方向更正拒绝；缺原因拒绝 | P0 | 通过 |
| B11 | 保存不破坏状态不变量：published 后清空发布凭据保存 → 字段错误；reviewed 后清空依据保存 → 字段错误 | P1 | 通过 |
| B12 | 复制为新实验：新实验新 ID + copiedFrom 指向来源，实际支出/工时/决策/观察窗口清空、计划与定价版本保留；行动复制为草稿（发布信息清空、linkedReqs 不复制、保留 copiedFrom）；fromActivityId 只复制指定行动 | P0 | 通过 |
| B13 | 创建开发需求：REQ 进入 submitted（core.createItem 口径）、README 描述含行动来源（双向关联）、行动 linkedReqs 记录 REQ 编号；同 key 重试不重复创建（created=false）；key 缺失/标题为空拒绝 | P0 | 通过 |
| B14 | readBoard：profile 未初始化 → initialized:false；单文件损坏 → corrupt 只读占位、其余照常；按 createdAt 稳定排序 | P1 | 通过 |

## 服务接口（server.mjs /api/marketing/*，V 系列）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| V1 | GET /api/marketing/board 返回渠道/实验/行动；未初始化营销返回 initialized:false | P0 | 通过 |
| V2 | 渠道→实验→多条行动创建链路：刷新（重新 GET）关联保持；实验 activityCount 正确 | P0 | 通过 |
| V3 | 状态推进 400：缺内容草稿/缺发布凭据/缺复盘依据 → { error, fields } 且状态不变；正常推进 200 且历史入档 | P0 | 通过 |
| V4 | 更新冲突 409：{ conflict:true, currentRevision }；定价版本不可变保证历史实验绑定不随当前指针变化 | P0 | 通过 |
| V5 | 复制实验接口：新 ID、保留来源、行动置草稿 | P0 | 通过 |
| V6 | 行动创建开发需求：201 返回 REQ id + 状态 submitted；同 key 重试 created:false；跨项目隔离（同名不同路径互不串） | P0 | 通过 |
| V7 | 静态与骨架：marketing.js 渠道与行动页签不再禁用；「效果与复盘」仍禁用标注暂不可用 | P1 | 通过 |

## 前端行为（marketing.js vm，W 系列）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| W1 | 静态契约：六状态列（草稿/待发布/已发布/观察中/已复盘/已停止）、工具栏（渠道筛选/实验筛选/+渠道/+实验/+行动）、抽屉三节（基本信息/内容素材/结果与关联）、复制文案/登记发布结果/创建开发需求/复制为新实验按钮、窄屏样式 | P0 | 通过 |
| W2 | 看板渲染：进入「渠道与行动」拉取 /api/marketing/board；卡片显示渠道、计划时间、主指标（取实验）、负责人；逾期徽标（过期未发布只提示不自动发布） | P0 | 通过 |
| W3 | 筛选：按渠道、按实验过滤；无匹配显示清除筛选；空态引导新建渠道/实验 | P0 | 通过 |
| W4 | 推进校验：待发布缺内容草稿 → 字段错误且状态停留；发布需登记发布时间+链接或凭据；复制文案/标记待发布不发送内容正文（请求体不含 contentDraft） | P0 | 通过 |
| W5 | 复盘表单：需依据与决策，「暂不能判断」是独立选项；停止需原因 | P0 | 通过 |
| W6 | 创建开发需求：POST /api/marketing/activity/req 携带 key；同 key 重试复用（created=false）不重复创建；创建后展示 REQ 编号并可跳转（派发 atb:open-item） | P0 | 通过 |
| W7 | 复制为新实验：已复盘/已停止行动卡片提供入口；提交 experiment/copy 携带 fromActivityId | P1 | 通过 |
| W8 | 快照：渠道与行动页签的筛选与打开的抽屉可经 snapshot/restoreView 恢复；抽屉草稿计入未保存守卫（hasUnsaved） | P1 | 通过 |
