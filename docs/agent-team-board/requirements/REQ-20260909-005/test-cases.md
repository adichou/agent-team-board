# 测试用例 — REQ-20260909-005 批量任务中的智能体模型和智能或推理程度要保持和主调度会话一致

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/model-follow-session-20260909-005.test.mjs`（数据层 / 提示词 / CLI / 服务端 / 界面契约）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 数据层默认：loadTaskSettings 无存量时四路 source 均为 follow，level 缺省保留（refine=high / develop=medium，仅作手动缺省建议） | 高 | 通过 |
| 2 | 数据层迁移：存量 model 非空 → manual 且值保留；level 偏离该类缺省（空模型）→ manual；缺省形态（空模型+缺省档）→ follow；model/level 值一律不清空 | 高 | 通过 |
| 3 | 数据层保存：source 非法值整体拒绝（不产生半截配置）；显式 source=follow 保存不清空既有 model/level；patch 不带 source 但写入非空 model → 该路置 manual（兼容旧 API 语义） | 高 | 通过 |
| 4 | 提示词（开发）：modelSource=follow 时 generatePrompt 含「跟随主调度会话」一致指令，且不再出现「子代理模型配置：…（来自设置「批量任务」…」固定行 | 高 | 通过 |
| 5 | 提示词（开发）：modelSource=manual（带 model/level）固定行沿用现状逐字口径；无 modelSource 且无 model/level 时输出不含任何模型行（直连调用不回归） | 高 | 通过 |
| 6 | 提示词（完善）：buildRefinePrompt 的 follow / manual 口径与开发侧一致（同一句式、可明确区分） | 高 | 通过 |
| 7 | CLI 统一：默认设置（follow）下 `atb batch create --json` / `atb refine create --json` 提示词含跟随指令；保存 manual 后创建则含固定配置行——CLI 与看板不再一边注入一边不注入 | 高 | 通过 |
| 8 | 服务端：/api/tasks/settings 保存 source 持久化可读回；/api/batch/create、/api/refine/create 按 source 生成对应口径提示词（follow=跟随指令、manual=固定行） | 高 | 通过 |
| 9 | 界面（设置）：taskSettingsHtml 五列表格（执行 Agent / 模型来源 / 子代理模型 / 推理强度 / 是否隐藏）；来源=跟随时该行模型输入与强度下拉 disabled 且占位「跟随主调度会话，无需配置」；来源=手动时可编辑并回显保存值 | 高 | 通过 |
| 10 | 界面（迁移回显）：存量 manual 路（model 非空）回显「手动指定」且值不丢；缺省路回显「跟随主调度会话」 | 高 | 通过 |
| 11 | 界面（来源切换）：切换某行来源即时启用 / 禁用该行模型与强度控件（只改草稿，未保存不生效） | 高 | 通过 |
| 12 | 界面（保存载荷）：保存提交 agents + models（四路 source/model/level 全量）；沿用防重复提交与失败保留草稿 | 高 | 通过 |
| 13 | 界面（启动区）：开发 / 完善启动区展示所选 Agent 生效口径——跟随显示「子代理模型：跟随主调度会话」，手动显示「手动 <模型/档位>」；未选择 Agent 时不展示 | 高 | 通过 |
| 14 | 回归：隐藏开关 aria-label / 全部隐藏提示 / 加载失败重试契约不变；batch-core D2（无模型信息直连调用逐字一致）不回归 | 高 | 通过 |
