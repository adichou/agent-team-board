# 测试报告 — BUG-20260905-003 Electron 壳窗口交通灯与看板顶栏文字重叠

- 时间：2026-09-05T16:19:50.036Z
- 执行者：atb-0906-5776
- 测试框架：node:assert 自研测试脚本（静态契约+真实子进程集成，scripts/tests/electron-shell.test.mjs）
- 覆盖率：90%

## 总结

根因：REQ-20260905-001 的 Electron 壳采用 hiddenInset 后，交通灯悬浮窗口左上约 70px 宽，而顶栏 .topbar 左内边距仅 18px，遮挡 .brand 文字（引入来源：REQ-20260905-001）。修复：修在壳层——新增 electron/shell-css.mjs 纯 Node 模块导出 TRAFFIC_LIGHT_INSET_CSS（.topbar padding-left:78px），main.mjs 经 webContents.insertCSS 于 did-finish-load 注入（重载亦生效），scripts/web 零改动、浏览器直连不受影响。TDD：electron-shell 新增 V4 注入契约用例先红后绿（8/8），npm test 20 个测试文件回归全过。npm run app 视觉项待人工验收。

## 明细

（可粘贴命令输出、失败用例说明等）
