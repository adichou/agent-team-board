# 测试用例 — REQ-20260910-018 讨论逐轮持久化、文档资产展示与跨会话续聊

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 统一入口追加轮次：rounds/r0001.json 起逐轮递增，含 discussionId/no/roundId/at/user/summary/session；二次追加成 r0002，旧轮不被覆盖 | P0 | 通过 |
| R2 | 归属校验与字段校验：讨论不存在/编号非法拒绝；user、summary 缺失拒绝并给可读原因 | P0 | 通过 |
| R3 | 同轮重试幂等：同 key 重复追加返回既有轮（duplicate 标记）且不新增文件；无 key 不去重 | P0 | 通过 |
| R4 | 并发追加不覆盖：预置 r0001/r0003 空洞后下一轮取 no=4；读侧跳过非法 JSON 与 discussionId 不符的文件（不串讨论、不展示半成品） | P0 | 通过 |
| R5 | 纪要版本校验：saveDiscussionMinutes 成功递增版本并原子写 minutes.md；baseVersion 过期抛版本冲突（提示重读）；旧 minutes.md 无 meta 按版本 0；baseVersion 缺失拒绝 | P0 | 通过 |
| R6 | 卡片与全量：listDiscussions 卡片含 roundCount/lastRoundAt/lastSummary/minutesStale（纪要落后为 true）；旧问答计数迁 legacyRoundCount；discussionFull 含 rounds 升序、minutes{content,version,stale}、organizePrompt/continuePrompt；已存轮次未发布 phase=recording | P0 | 通过 |
| R7 | 提示词：启动含项目根/编号/rounds 目录/minutes 路径/统一入口命令/逐轮保存与幂等重试约定，且不再出现「只在收到收尾提示词后」口径；继续讨论提示词含先读纪要与近期轮次、轮次接续、同一讨论；整理结论含重整纪要+候选草稿发布协议，且声明不终止讨论 | P0 | 通过 |
| R8 | 兼容：旧发布成果照常读取；旧单历史问答保留且不伪造逐轮记录；requestFinish/finish 端点兼容仍可用 | P1 | 通过 |
| H1 | 服务接口：GET /api/discussion/:id 与 board 卡片携带 rounds/minutes/roundCount/lastSummary；POST 创建即返回新字段 | P1 | 通过 |
| C1 | CLI：atb disc round 经文件写入成功（--json 输出轮次）；同 key 重试不重复；归属不符/缺字段非零退出且原因明确 | P0 | 通过 |
| C2 | CLI：atb disc minutes 更新版本成功；版本冲突非零退出；atb disc show 输出背景+纪要版本+轮次 | P1 | 通过 |
| U1 | 页签结构：三页签「讨论纪要/交流记录/后续行动」顺序与 aria 契约；默认讨论纪要；旧 tab 快照值回落默认 | P0 | 通过 |
| U2 | 头部操作区：启动提示词/复制继续讨论提示词/整理结论/归档·继续讨论；「讨论完毕」不再出现；提示词为页签行下可折叠块（无提示词页签）；复制双回退保留 | P0 | 通过 |
| U3 | 交流记录页签：按时间升序渲染用户原文/回复总结/时间/轮次标识/来源会话；空态「尚无已保存交流」引导启动提示词；旧单显示历史问答且不补造 | P0 | 通过 |
| U4 | 纪要页签：背景+最新纪要渲染；minutesStale 显示「纪要待更新」；读取失败原因与重试入口保留 | P1 | 通过 |
| U5 | 列表卡片：显示已保存轮数与最新回复摘要；阶段提示含逐轮记录中 | P1 | 通过 |
| U6 | 后续行动页签：沿用勾选/编辑/批量创建/重试/跳转；零候选正常空态 | P1 | 通过 |
