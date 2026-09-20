# 测试用例 — REQ-20260907-001 Oncall 咨询看板：咨询单创建、批量/单条派单回复，富文本与截图展示，支持 zcode 与 codex

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | 数据层：创建咨询单生成 ASK-YYYYMMDD-NNN 独立序列，状态 pending，question.md 落盘 | P0 | ✅ |
| S2 | 数据层：派单（zcode/codex）记轮次 mode/staff/dispatchedAt 并转 answering；回传 answer 落 rounds/N/answer.md 转 answered | P0 | ✅ |
| S3 | 数据层：追问 ask 追加轮次并把 answered 拉回 pending；失败 failRound 记 error 转 failed；failed 可重派回 answering | P0 | ✅ |
| S4 | 数据层：附件白名单（png/jpg/webp…放行、exe/sh 拒绝）、大小 ≤8MB、文件名净化防穿越 | P0 | ✅ |
| S5 | 数据层：listTickets 按状态过滤；客服人员 >30 字符拒绝；dispatches 派单账本记录 mode/staff/ids | P1 | ✅ |
| C1 | CLI：oncall new/list/show/ask/answer 全链路；answer 从文件回传后 show 可见回答内容 | P0 | ✅ |
| C2 | CLI：oncall dispatch（zcode）生成主调度提示词：含会话命名指令「oncall-YYYYMMDD-<客服>」、每单 answer 受控回传命令；未填客服显示「未指定」且不阻塞 | P0 | ✅ |
| H1 | HTTP：POST /api/oncall/ticket 创建（含 base64 附件）；GET board/详情/round/attachment 字节端点（MIME 白名单 + nosniff） | P0 | ✅ |
| H2 | HTTP：POST ask 追问；POST dispatch zcode 返回提示词并写账本；GET dispatch/records；非法参数 400 | P0 | ✅ |
| H3 | HTTP：/api/oncall/board 返回 codexReady；未配置 CLI 的项目 codexReady=false | P1 | ✅ |
| D1 | codex 派发：fake-codex（ok 模式）后台执行后 final-message 自动回传 → 状态 answered、回答落位、by 含客服人员 | P0 | ✅ |
| D2 | codex 派发：auth-error 失败 → 状态 failed、轮次 error 记录；redispatch 可重派 | P0 | ✅ |
| D3 | codex 派发：串行逐单执行（两单依次回传，不并行）；不占用 .locks/impl.lock | P1 | ✅ |
| U1 | 前端：顶栏「Oncall」tab 与需求/文件同款切换；视图容器与抽屉骨架；oncall.js 已引入 | P0 | ✅ |
| U2 | 前端：新建表单（标题/正文/截图上传与粘贴）；批量派单（模式选择+客服人员输入记忆 atb.oncall.staff）；codex 未就绪隐藏入口 | P0 | ✅ |
| U3 | 前端：列表卡片字段（单号/标题/状态/模式徽标/时间/轮数）、状态筛选、空态引导 | P1 | ✅ |
| U4 | 前端：详情 Markdown 渲染（marked+sanitize）、附件内联与点击放大（lightbox）、每轮标注模式/时间/来源、问询追问输入 | P0 | ✅ |
| I1 | 隔离：core.listItems 不含 ASK（REQ/BUG 列表与 /dev next 选单不受影响）；oncall 派单不产生/占用 impl.lock；现有看板测试无回归 | P0 | ✅ |
