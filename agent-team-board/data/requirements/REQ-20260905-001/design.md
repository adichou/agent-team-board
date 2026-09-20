# 设计 — REQ-20260905-001 为看板增加 Electron 桌面壳（内嵌现有 Node 服务）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

Status Board 目前靠 `node scripts/server.mjs` / `atb serve` 在终端里跑，再手动开浏览器。本需求给它一个 macOS 桌面壳：`npm run app` 直接出现看板窗口，终端可不再管服务生命周期。现有业务代码（server.mjs / web / atb.mjs）零改动。

## 方案

新增三个文件，均为壳层自有代码：

```
package.json          # 项目首个 package.json：main 指向壳入口；devDependencies: electron、electron-builder
electron/main.mjs     # Electron 主进程（约 30 行）：建窗、加载页面、关窗回收
electron/service.mjs  # 纯 Node 模块（不 import electron）：服务拉起/探活/回收，供 main 与测试共用
```

### service.mjs（可测核心）

- `probeHealth(port)` — GET `http://127.0.0.1:<port>/api/health`，200 即就绪（与 `atb serve` 同款探活）。
- `ensureService({ port, serverPath, projectRoot, maxWaitMs, execPath, env })`：
  1. 先探活，已运行 → 复用（`{ reused: true, child: null }`），不新起进程 —— 终端已起服务时 GUI 直连不冲突；
  2. 未运行 → `spawn(execPath, [serverPath])`，`execPath` 缺省 `process.execPath`（Electron 下即 Electron 二进制），
     子进程 env 强制 `ELECTRON_RUN_AS_NODE=1`（把 Electron 二进制当纯 Node 用，避免二次依赖），
     另传 `ATB_PORT` / `ATB_HOST=127.0.0.1`；stdio 追加写入 `/tmp/agent-team-board-electron.log`（保留 EADDRINUSE 提示原文）；
  3. 轮询探活至 `maxWaitMs`（缺省 10s）：就绪即返回；子进程提前退出不算失败（正对 EADDRINUSE：端口被占时
     server.mjs 会打印提示退出，若期间健康检查转 OK 仍视为就绪），超时未就绪则杀掉子进程并抛带端口占用提示的错误。
- `stopService(handle)` — 结束 ensureService 返回的子进程（无子进程时幂等空操作）。

### main.mjs（壳层）

- `app.whenReady()` → `ensureService({ port })` → `BrowserWindow({ width: 1360, height: 850, titleBarStyle: 'hiddenInset' })`
  → `loadURL('http://127.0.0.1:<port>')`；`hiddenInset` 让交通灯融入页面左上，壳层不加任何额外 UI。
- 服务未就绪/启动失败 → `dialog.showErrorBox` 呈现原因后退出（页面自带「○ 服务离线」指示作为窗口内等待反馈）。
- `window-all-closed` → `stopService()` + `app.quit()`（不做 macOS 常驻特例，关窗即全退，符合验收）。
- 端口：`ATB_PORT` 环境变量可覆写，缺省 7736，与服务一致。

### package.json

- `"main": "electron/main.mjs"`、`"scripts": { "app": "electron .", "dist": "electron-builder" }`、
  `"devDependencies": { "electron": "^37.2.0", "electron-builder": "^25.1.8" }`。
- **版本约束（实施中确认）**：本机仅有 Node v17.8.0，electron ≥ 44 的 postinstall 依赖 ESM 版
  `@electron/get ^5`，Node 17 无法 `require()`，二进制下载直接失败；electron 37 仍依赖 CJS 版
  `@electron/get ^2`（node≥14 可用），ESM 主进程（≥28 支持）、hiddenInset、ELECTRON_RUN_AS_NODE 能力完全一致，
  故锁定 37 线；electron-builder 同理取 25 线（engines node≥14）。用户日后升级 Node 后可自行上浮版本。
- electron-builder 仅登记依赖与 dist 脚本，打包 .app/.dmg 属 README 中的「后续」，不在本条实施。

## 测试策略

`scripts/tests/electron-shell.test.mjs`，沿用现有测试风格（静态契约 + 真实子进程集成）：

- 静态：package.json 契约；main.mjs 建窗/尺寸/hiddenInset/关窗回收契约；service.mjs 的
  ELECTRON_RUN_AS_NODE、探活、EADDRINUSE 容忍契约。
- 集成（无需 Electron 运行时，纯 Node 跑真 server.mjs）：空闲端口拉起即就绪；已有服务复用不新起；
  stopService 回收子进程；端口被非看板进程占用时明确报错。
- 隔离：测试经 `ATB_REGISTRY` 指向临时文件、`ATB_PORT` 用随机空闲端口，不污染用户注册表（同 multi-project.test.mjs）。

## 风险与边界

- **验收中的「窗口显示」人工确认**：TDD 覆盖到子进程与服务逻辑及静态契约；真正的 `npm run app` 窗口观感
  （交通灯位置、页面渲染）需人工打开确认——Agent 遵守「不自动运行 app」约束，不代跑 GUI。
- Electron ESM 主进程需 ≥ v28，选 ^44 无兼容问题；`ELECTRON_RUN_AS_NODE` 是 Electron 官方文档化的用法，非私有 API。
- 端口竞争窗口（探活失败后、spawn 前他人抢占）：由「子进程 EADDRINUSE 退出 + 探活续查」兜底，最坏是明确报错。
- 退出兜底：`window-all-closed` 与 `before-quit` 双路径都调 `stopService`（覆盖 Cmd-Q）；唯一残余边界是
  就绪轮询进行中（≤10s）用户强制退出，子进程可能残留——行为等同 `atb serve` 的后台服务，下次启动会被健康探活复用，可自愈。
- server.mjs 以壳层传入的 `projectRoot` 为 cwd 启动，默认项目即本项目，行为与 `atb serve` 一致。
