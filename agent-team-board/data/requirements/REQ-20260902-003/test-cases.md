# 测试用例 — REQ-20260902-003 atb serve 一键启动

> V1–V3 由 `scripts/tests/serve.test.mjs` 覆盖。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| V1 | serve 子命令契约：探活（api/health）、后台拉起（spawn/detached）、--open 系统浏览器 | P0 | ✓ |
| V2 | serve --help 输出用法且不起服务 | P0 | ✓ |
| V3 | 集成：已运行实例探活复用（不重复起服务、原进程存活） | P0 | ✓ |
| V4 | 冷启动实测：30441 端口后台启动 → health 200 → 输出 PID/日志路径 | P0 | ✓（手工实测） |

## 执行记录（2026-09-03）

- serve.test.mjs V1–V3 全绿（先红后绿）。冷启动手工实测通过（V4）。
- 过程修复三处：serveCmd 漏解构 parseOpts 包装（opts.help 取错层）、漏 import path/fs（仅冷启动路径触发）；
  测试 V3 首版用 fetch（本机 node 17 无全局 fetch，改 node:http）。
- 「右侧面板」边界按对齐默认：--open 打开系统浏览器，输出中提示右侧面板需会话内 /board。
