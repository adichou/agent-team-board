# 测试用例 — REQ-20260905-001 为看板增加 Electron 桌面壳（内嵌现有 Node 服务）

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/electron-shell.test.mjs`（静态契约 + 真实子进程集成，无需 Electron 运行时）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| V1 | package.json 契约：合法 JSON；`main` 指向 electron/main.mjs；`scripts.app` 以 electron 启动；devDependencies 含 electron 与 electron-builder | P0 | ✓ 通过 |
| V2 | electron/main.mjs 静态契约：BrowserWindow 1360×850、hiddenInset、loadURL 127.0.0.1、经 service 模块拉起服务、window-all-closed → stopService + app.quit | P0 | ✓ 通过 |
| V3 | electron/service.mjs 静态契约：以 ELECTRON_RUN_AS_NODE 拉起 scripts/server.mjs、/api/health 探活轮询、子进程提前退出不判死（EADDRINUSE 容忍） | P0 | ✓ 通过 |
| I1 | 空闲端口 ensureService：拉起 server.mjs 子进程并探活就绪（reused=false 且 child.pid>0），随后 GET /api/health 返回 200 | P0 | ✓ 通过 |
| I2 | 端口已有看板服务：ensureService 复用现有实例（reused=true、不新起子进程），原进程不被杀 | P0 | ✓ 通过 |
| I3 | stopService：子进程被终止（PID 消失），重复调用幂等 | P0 | ✓ 通过 |
| I4 | 端口被非看板进程占用：子进程 EADDRINUSE 退出、探活始终不通，maxWaitMs 超时后抛出含端口占用提示的错误，且不遗留子进程 | P1 | ✓ 通过 |

> 红→绿记录：7/7 用例先红（2026-09-05，文件未建），实现后 7/7 绿；现有 15 个测试文件回归全部通过。
> 版本备注：electron 锁 ^37.2.0、electron-builder 锁 ^25.1.8（本机 Node 17 不兼容 electron ≥44 的 ESM 版
> @electron/get ^5，详见 design.md「版本约束」）。
