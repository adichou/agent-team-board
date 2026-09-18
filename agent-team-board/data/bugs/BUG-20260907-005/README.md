# BUG-20260907-005 看板 API 无 Origin/Host 校验：任意网页可跨站代替人工「接受」与「确认完成」（CSRF）

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T09:00:50.700Z

## 现象

## 现象
server.mjs 对全部 /api/* 不校验 Origin/Host/Content-Type。恶意网页可用 fetch 发 text/plain 简单请求（无预检）直击 127.0.0.1:8888：
- POST /api/item/<ID>/status {"to":"accepted"} —— 代替人工接受
- {"to":"done"} —— 代替人工确认完成（会释放认领锁）
- POST /api/new、/api/register、/api/oncall/* 等全部可跨站调用

## 复现（沙盒实例实测）
携带 Origin: http://evil.example、Content-Type: text/plain 的状态流转请求返回 200，条目被置为已接受（两轮稳定复现）。

## 建议
校验 Origin/Referer 白名单（127.0.0.1）、或要求自定义头（如 X-Requested-With）触发预检；至少对人工专属流转接口收紧。

## 影响
本地服务端口固定、无鉴权，浏览器里打开任意网页即可能篡改看板状态（接受/完成/新建单据），破坏「人工专属状态」的核心人机分工约定。

## 复现步骤

1. 启动 Status Board（默认 127.0.0.1:8888），看板上存在 submitted 条目。
2. 模拟恶意网页（跨站 fetch 不带自定义头即不触发预检）：
   `curl -X POST http://127.0.0.1:8888/api/item/<ID>/status -H "Origin: http://evil.example" -H "Content-Type: text/plain" --data '{"to":"accepted"}'`
3. 修复前返回 200，条目被置为 accepted；`{"to":"done"}` 同理可代替人工确认完成并释放认领锁。

## 期望行为

- /api/* 收到跨站来源（Origin/Referer 指向非本机源）的请求时返回 403，条目状态不变；
- Host 头非回环（DNS rebinding 特征）的请求返回 403；
- 同源看板页面（含 localhost/[::1] 别名打开）与本机非浏览器客户端（curl、Electron 探活，不带 Origin/Referer）不受影响。

## 关联（引入来源）

- 引入来源：未定位（排查过程：server.mjs 的 /api/* 自项目初始脚手架即无任何来源校验——最早可追踪条目 REQ-20260829-001 已是看板页面布局优化，说明 HTTP API 先于看板数据目录建立；项目非 git 仓库，无提交历史可考。此后 REQ-20260902-004（一键派发）、REQ-20260906-002/003（批量实施/Codex 派发）、REQ-20260907-001（Oncall）等只是持续在其上增加端点，均未引入校验）。

## 修复记录（BUG-20260907-005，zcode-batch-009-1）

- `scripts/server.mjs`：新增 `/api/*` 跨站防护（BUG-20260907-005 注释节）：`apiGuardReason(req)` 在进入业务路由前依次校验——① Host 头主机名必须回环（127.0.0.1/localhost/[::1]/::1；显式 `ATB_HOST` 时按绑定值放宽，0.0.0.0 视为明示局域网共享），拦截 DNS rebinding；② 携带 Origin（含 `null`，视为非同源）时必须同源（`http://<Host>` 严格相等或回环别名 + 端口一致），拦截恶意网页 fetch/表单简单请求（text/plain 无预检）；③ Origin 缺席再看 Referer 的 origin 部分，同规则；非浏览器客户端两头皆无、维持原可用性。拒绝统一 403 JSON 带可读原因，业务处理与错误分支不受影响。
- 静态资源（web UI）不设防：仅返回本插件自带文件，无状态副作用。
- 测试：`scripts/tests/origin-guard.test.mjs`（T1 恶意 Origin+text/plain 代替人工接受 → 403 且状态不变；T2 无来源头本机客户端流转可用；T3 同源 Origin 确认完成可用；T4 恶意 Referer 403；T5 可疑 Host 403；T6 跨站 GET 只读接口 403；T7 localhost 别名/同源 Referer 放行；T8 拒绝后服务仍可用）。修复前 T1 以 200/状态被改跑红，修复后通过；全量 `npm test` 67 文件 0 失败。