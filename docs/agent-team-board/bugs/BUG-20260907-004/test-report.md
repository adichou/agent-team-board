# 测试报告 — BUG-20260907-004 咨询单图片附件超约 750KB 必失败：前端 8MB 校验与后端 1MB 请求体上限矛盾，且连接被掐断无明确报错

- 时间：2026-09-07T15:35:53.459Z
- 执行者：zcode-batch-009-1
- 测试框架：node:assert + 隔离 HTTP 服务集成测试
- 覆盖率：100%

## 总结

server.mjs readBody 上限放宽至 12MB 对齐前端单张 8MB 附件 base64（≈10.7MB）；超限不再 req.destroy()，读干后应答完整 400 JSON；新增 body-limit.test.mjs 4 断言组（修复前 ECONNRESET 跑红），全量 66 测试文件 0 失败；归因 REQ-20260907-001（destroy 先掐连接行为未定位，已附排查）

## 明细

（可粘贴命令输出、失败用例说明等）
