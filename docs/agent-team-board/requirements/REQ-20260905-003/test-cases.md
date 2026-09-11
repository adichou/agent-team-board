# 测试用例 — REQ-20260905-003 Status Board 默认端口改为 8888

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 对应测试文件：`scripts/tests/default-port.test.mjs`

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 未设 ATB_PORT 启动 server.mjs，`/api/health` 返回 `port=8888`（8888 被占时跳过并说明） | P0 | ✅ 通过（本机 8888 空闲，实际验证） |
| 2 | `ATB_PORT=7737` 启动，`/api/health` 返回 `port=7737`（环境变量覆盖能力不变） | P0 | ✅ 通过 |
| 3 | server.mjs 默认端口为 8888、文件头注释同步；EADDRINUSE 提示的示例端口用动态 `PORT` 表达式，无硬编码 7737 | P1 | ✅ 通过 |
| 4 | 默认端口引用点同步：atb.mjs serve、electron/main.mjs、electron/service.mjs 缺省值均为 8888 | P0 | ✅ 通过 |
| 5 | state-guard.mjs 端口启发式包含 8888（保留 7736 以兼容仍在运行的旧实例） | P1 | ✅ 通过 |
| 6 | 文档与清单（README.md、commands/board.md、skills/agent-team-board/SKILL.md、两个 plugin.json）无 `\b7736\b` 残留且含 8888 | P0 | ✅ 通过（测试曾抓出 SKILL.md 简介行漏改，已修复） |
| 7 | traceability.test.mjs 对 board.md 的断言正则与新端口同步（7736 → 8888） | P2 | ✅ 通过 |
| 8 | npm test 入口可用：package.json 注册 test script，顺序执行 scripts/tests/*.test.mjs，任一失败非零退出 | P1 | ✅ 通过（新增 scripts/tests/run-all.mjs） |
