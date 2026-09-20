# 测试用例 — BUG-20260905-003 Electron 壳窗口交通灯与看板顶栏文字重叠

> 测试文件：`scripts/tests/electron-shell.test.mjs`（在 REQ-20260905-001 既有 V1–V3/I1–I4 基础上追加 V4）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| V4 | 注入契约：electron/shell-css.mjs 为纯 Node 模块（不 import electron）并导出 TRAFFIC_LIGHT_INSET_CSS（`.topbar` padding-left ≥ 70px）；main.mjs 经 webContents.insertCSS 注入该常量；scripts/web/style.css 不含 78px 且 `.topbar` 基础内边距保持 `10px 18px`（浏览器直连场景零改动） | P0 | ✓ 通过 |

> 红→绿记录：V4 先红（2026-09-06，shell-css.mjs 未建、main.mjs 无注入逻辑，既有 7 例不受影响），
> 实现后 electron-shell 8/8 绿；`npm test` 全套 20 个测试文件回归通过。
> `npm run app` 窗口内「交通灯与顶栏文字互不遮挡」为运行期视觉项，无法自动化，待人工验收。
