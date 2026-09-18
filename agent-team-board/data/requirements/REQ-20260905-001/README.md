# REQ-20260905-001 为看板增加 Electron 桌面壳（内嵌现有 Node 服务）

- 状态：submitted（待人工接受）
- 创建：2026-09-05T07:50:41.653Z

## 描述

目标：给 Status Board 包一层 macOS 桌面壳（Electron），复用现有零依赖 Node 服务，现有业务代码零改动。
界面：单窗口 1360×850，macOS hiddenInset 标题栏（交通灯融入页面左上）；窗口内容即现有看板网页 http://127.0.0.1:7736，壳层不额外加 UI。
交互与状态反馈：启动时以 ELECTRON_RUN_AS_NODE 拉起 scripts/server.mjs 子进程，轮询 /api/health 就绪后再加载页面；服务未就绪期间页面自带「○ 服务离线」指示即启动等待反馈；关闭窗口 → 结束子进程并退出应用；终端已起服务时沿用 EADDRINUSE 提示逻辑，GUI 直连不冲突。
技术要点：Electron 主进程约 30 行；新增 electron/main.mjs 与 package.json（devDependencies：electron、electron-builder）；后续可用 electron-builder 打包 .app/.dmg。
验收：npm run app 能打开桌面窗口并显示看板；看板数据读写、派发、File Board 在窗口内可用；关窗后子进程被回收。

## 验收标准

- [ ] `npm run app` 打开 1360×850 桌面窗口，hiddenInset 标题栏，窗口内显示看板页面
- [ ] 看板数据读写、派发、File Board 在窗口内可用（与浏览器版一致）
- [ ] 终端已起服务时，壳层复用现有实例直连，不冲突（EADDRINUSE 容忍）
- [ ] 关闭窗口后子进程被回收，应用整体退出
- [ ] `node scripts/tests/electron-shell.test.mjs` 全部通过（静态契约 + 服务拉起/探活/回收集成）
