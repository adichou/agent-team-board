# 测试用例 — REQ-20260924-001 文档编写中的整体审查步骤优化

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现：scripts/tests/req-20260924-001.test.mjs（分层：L1 纯逻辑 / L2 数据层与 CLI / L3 服务接口 / L4 前端静态契约 / L6 i18n）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | L1 语言一致性：cn 文档含中文 ✓；en 文件仍为中文内容 ✗；en 文档英文 ✓；ja 缺假名 ✗、含假名 ✓；ko 谚文判定；ru 西里尔判定；代码块剥离不误判；过短文本「无法判定」✗ | 高 | 通过 |
| 2 | L1 链接解析：`[t](x.md)` / 图片 / 行号提取；围栏与行内代码中的链接跳过；纯锚点 / mailto 跳过 | 高 | 通过 |
| 3 | L1 链接检查：本地链接存在 ✓ / 缺失死链带原因；`#anchor` 剥离；http 链接 HEAD 200 ✓；HEAD 405 回退 GET 200 ✓；HTTP 404 / 网络错误 / 超时死链带原因；死链聚合 ok=false 与明细 | 高 | 通过 |
| 4 | L1 AI 校对提示词：校对角色 / 默认语言文件清单（不含剩余语言与 LICENSE）/ runId / atb docscheck 四步回执 / 只读不改与不编造约束 / 静态段+参数区形态 | 高 | 通过 |
| 5 | L2 校对账本：create 装默认语言非单文件文件 pending；docscheck.lock 独立占锁、重复 start 拒绝、与 summary/translate 锁互不占用；mark checking/pass/fail 流转；fail 缺 issues 拒绝、issues 入账；done/fail 收尾回落 checking、释放锁；latest/view/brief（kind=docscheck）计数口径 | 高 | 通过 |
| 6 | L2 CLI：atb docscheck start/file/done 全链路（含 --issues 回执落盘）；state 非法 / 集合外文件报错；show 视图 | 高 | 通过 |
| 7 | L3 review-checks 端点：返回 lang / links 两检查结果；本地死链命中并详细提示；版本不存在 4xx | 高 | 通过 |
| 8 | L3 proofread start 门禁：默认语言未全审 400 带缺口；merging 拒绝；全审后 200 返回 runId+提示词；重复 start 拒绝；current 返回 run 视图与 docsFlow；publish-plan 带 docsCheck 字段；进行中进入 /api/batch/global（kind=docscheck）、收尾移出 | 高 | 通过 |
| 9 | L4 整体审查对话框：语言一致项 / 链接项状态由自动检查驱动（未运行 ◐ / ✓ / ✗+明细）；死链明细列表；AI 校对项状态（未运行 / 进行中 / pass ✓ / fail ✗+issues）；「运行自动检查」「AI 校对」按钮存在 | 高 | 通过 |
| 10 | L6 i18n：新增静态与动态词条中英同步、往返不变形 | 高 | 通过 |
