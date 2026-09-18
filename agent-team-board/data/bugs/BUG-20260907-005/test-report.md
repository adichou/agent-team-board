# 测试报告 — BUG-20260907-005 看板 API 无 Origin/Host 校验：任意网页可跨站代替人工「接受」与「确认完成」（CSRF）

- 时间：2026-09-07T15:47:30.604Z
- 执行者：zcode-batch-009-1
- 测试框架：node:assert + 隔离 HTTP 服务集成测试
- 覆盖率：95%

## 总结

server.mjs /api/* 前置跨站防护：Host 回环白名单（拦 DNS rebinding）+ Origin/Referer 同源校验（拦恶意网页 text/plain 简单请求代替人工接受/确认完成），Origin:null 视为跨站；同源页面（含 localhost/[::1] 别名）与本机非浏览器客户端（curl/Electron 探活）不受影响，拒绝统一 403 JSON。新增 origin-guard.test.mjs 8 断言组，修复前主场景 200 跑红、修复后通过；全量 npm test 67 文件 0 失败。引入来源未定位（初始脚手架即无校验，非 git 仓库无历史，排查过程见 README 关联节）

## 明细

（可粘贴命令输出、失败用例说明等）
