# 设计 / 实施记录 — BUG-20260905-003

## 根因与引入来源

- 引入来源：REQ-20260905-001（Electron 壳采用 hiddenInset 后未给页面顶栏预留交通灯安全区）。
- 根因：`electron/main.mjs` 建窗时设置 `titleBarStyle: 'hiddenInset'`，macOS 交通灯
  （关闭/最小化/最大化）悬浮于窗口内容左上，约占 70px 宽；而看板页顶栏 `.topbar` 左内边距仅 18px
  （`scripts/web/style.css` 的 `.topbar { padding: 10px 18px; }`），顶栏左上的 `.brand`
  （logo「▦」+ 标题「智能体团队看板」+ 数据目录路径）因此被交通灯遮挡。浏览器直连没有标题栏，
  不存在该问题——属壳层（hiddenInset）专属回归。

## 修复方案（已实现）

按 README 修复方向修在壳层，`scripts/web/` 业务代码零改动：

- 新增 `electron/shell-css.mjs`：纯 Node 常量模块（禁止 import electron，与 service.mjs 同一可测约定），
  导出 `TRAFFIC_LIGHT_INSET_CSS`，内容为 `.topbar { padding-left: 78px; }`
  （交通灯约 70px 宽 + 8px 安全边距）。
- `electron/main.mjs`：在 `loadURL` 前注册 `webContents.on('did-finish-load')`，
  经 `insertCSS(TRAFFIC_LIGHT_INSET_CSS)` 注入——挂在事件上，页面重载也会重新注入；
  注入失败（如窗口已销毁）静默忽略，不影响退出路径。
- 作用域：注入样式仅在 Electron 窗口内生效（insertCSS 为壳层 webContents 专属 API），
  浏览器直连 http://127.0.0.1:7736 不加载该规则，顶栏渲染与原先一致。

## 测试

- `scripts/tests/electron-shell.test.mjs` 新增 V4 注入契约用例：断言 shell-css 为纯 Node 模块且导出
  `TRAFFIC_LIGHT_INSET_CSS`（作用于 `.topbar`、padding-left ≥ 70px）；main.mjs 经 `insertCSS`
  使用该常量；`scripts/web/style.css` 不含 78px 且 `.topbar` 基础内边距保持 `10px 18px`
  （浏览器场景零改动的静态证明）。
- TDD：V4 先红（shell-css.mjs 未建、main.mjs 无注入逻辑，其余 7 例通过）→ 实现后 8/8 绿；
  `npm test` 全套 20 个测试文件回归通过。
- 运行期视觉项（`npm run app` 窗口内交通灯与顶栏文字互不遮挡）无法自动化，待人工验收。
