# 测试报告 — REQ-20260908-004 回退 CI 看板

- 时间：2026-09-08T03:09:29.954Z
- 执行者：zcode-batch-013-1
- 测试框架：node:test 风格自研用例（scripts/tests/revert-ci-board.test.mjs）
- 覆盖率：100%

## 总结

回退 REQ-20260902-002 引入的 CI 看板：删除 lib/ci-store.mjs / web/ci.js / tests/ci-board.test.mjs；server.mjs 移除 /api/ci/* 路由、selfRestart、ATB_BIND_RETRY 绑定重试与 server.json 端口持久化（端口恢复 ATB_PORT>8888）；index.html 去 CI 页签与容器、app.js 去 ci 视图注册、style.css 去 .ci-* 样式；同步回退 workbench-layout W2 与 default-port V1 契约。TDD：revert-ci-board 用例先红后绿 5/5，npm test 80 文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
