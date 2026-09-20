# BUG-20260907-004 咨询单图片附件超约 750KB 必失败：前端 8MB 校验与后端 1MB 请求体上限矛盾，且连接被掐断无明确报错

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T09:00:50.665Z

## 现象

## 现象
讨论单（oncall）创建表单允许单张图片 ≤8MB（app.js readAttachFile），但附件以 base64 内嵌 JSON 提交 POST /api/oncall/ticket；服务端 readBody 对全部请求体限 1MB。约 750KB 以上图片 base64 后超限，服务端 reject 后调用 req.destroy()，客户端只收到 ECONNRESET，前端表现为「网络错误」，无任何可读提示。

## 复现（API 实测两轮稳定）
POST /api/oncall/ticket，body 含 900KB png 的 base64（约 1.2MB）→ 连接被重置，咨询单未创建。
对照：POST /api/new 发送 1.1MB 文本同样 ECONNRESET（400 响应未送达客户端）。

## 期望
前后端上限一致（如后端按附件场景放宽至 12MB 或前端按 1MB 收紧校验），且超限应完整返回 400 JSON（读干或断开前先应答），而非掐断连接。

## 影响
REQ-20260907-001 讨论单的截图附件能力对常见截图（常 >1MB）实际不可用；所有 >1MB POST 的错误反馈均为网络级错误。

## 复现步骤

1. 讨论单创建表单附一张约 900KB 的 png（前端 8MB 校验通过）提交；
2. 服务端 `readBody`（scripts/server.mjs）对请求体限 1MB，base64 后约 1.2MB 超限；
3. 服务端 reject 后调用 `req.destroy()`，响应未送达，前端 fetch 报「网络错误」（ECONNRESET），咨询单未创建。

## 期望行为

- 前后端上限一致：后端请求体上限覆盖前端单张 8MB 附件（base64 ≈ 10.7MB），取 12MB；
- 超限时服务端先应答完整 400 JSON（读干剩余请求体，不掐断连接），前端可读展示错误原因；
- 超限请求不影响后续请求处理。

## 关联（引入来源）

- 引入来源：REQ-20260907-001（Oncall 咨询看板引入截图附件以 base64 内嵌 JSON 提交、前端单张 ≤8MB 校验，与 server.mjs `readBody` 既有 1MB 请求体上限冲突，常见截图 >1MB 必失败）。
- 补充（未定位）：超限时 `req.destroy()` 先掐断连接再应答的行为来自服务端最早实现，项目无 git 历史可考（排查过程：`readBody` 自 server.mjs 初版即含 destroy 逻辑，先于 oncall 附件场景存在，本次一并修正）。

## 修复记录（BUG-20260907-004，zcode-batch-009-1）

- `scripts/server.mjs`：新增 `BODY_MAX_BYTES = 12MB`（对齐前端 `readAttachFile` 单张 8MB + oncall-store `ATTACHMENT_MAX_BYTES`，base64 后 ≈10.7MB + JSON 包装）；`readBody` 超限时不再 `req.destroy()`，改为标记超限并继续读干剩余字节（不累积），让上层统一应答 400 JSON，客户端拿到可读错误而非 ECONNRESET。
- 前端不改：8MB 单张校验与 store 落盘上限一致；多附件总量超 12MB 时由服务端返回 400「请求体过大（>12MB）」，前端 `api()` toast 展示。
- 测试：`scripts/tests/body-limit.test.mjs`（T1 2MB 附件创建成功落盘；T2 总量超限 400 带「请求体过大」；T3 `/api/new` 超限文本 400；T4 超限后服务继续可用）。修复前该测试以 `read ECONNRESET` 失败（红），修复后通过；全量 `npm test` 66 文件 0 失败。
