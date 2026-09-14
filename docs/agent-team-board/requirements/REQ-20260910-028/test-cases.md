# 测试用例 — REQ-20260910-028 新建讨论时支持上传截图，和新建需求、bug 一样

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | 数据层：createDiscussion 带 attachments 落盘 `<讨论目录>/attachments/`（同名去重）、ticket.json 顶层 attachments 记最终文件名、question.md 背景末尾追加 `![截图](attachments/…)` 引用行（背景空仅截图也可创建） | 高 | 通过 |
| S2 | 数据层校验：先全量校验再占号——非白名单后缀 / 超 8MB / 超 9 张 / dataBase64 缺失任一非法整单拒绝（抛错、不建目录、不消耗 ASK 单号）；校验口径与需求 / Bug（core.parseItemAttachments）一致 | 高 | 通过 |
| S3 | 数据层兼容：无 attachments 调用行为与旧版完全一致（question.md 仅背景、ticket.json 无顶层 attachments）；旧单（轮次附件）discussionFull 不受影响；discussionFull 新讨论带 attachments；buildStartPrompt 带截图位置提示行 | 高 | 通过 |
| H1 | 服务层：POST /api/discussion 请求体 attachments 透传创建成功（响应 discussion.attachments 带文件名）；任一附件非法 400 整单拒绝（不留半成品目录）；GET /api/discussion/:id/attachment/:name 返回原始字节（白名单 MIME + nosniff + no-store），占位编号 400 业务错误 | 高 | 通过 |
| U1 | 新建表单：类型切到「讨论」显示截图区块（与需求 / Bug 一致）；「创建并接受」仍隐藏；REQ / BUG 既有截图行为无回归 | 高 | 通过 |
| U2 | 提交链路：讨论提交请求体按添加顺序携带 attachments[{name,dataBase64}]；无截图不带 attachments 字段（旧口径路径不变） | 高 | 通过 |
| U3 | 过旧服务预检：带截图 + 预检「未知接口」404 → 拒绝提交、toast 给 atb serve 指引、弹窗与截图保留；新服务 / 网络异常放行；无截图不预检 | 高 | 通过 |
| U4 | 讨论详情：背景 markdown 相对 `attachments/` 图片接管为 /api/discussion/:id/attachment/:name、点击放大、加载失败占位不渲染破图；旧讨论无引用行不受影响 | 高 | 通过 |
