# BUG-20260905-003 Electron 壳窗口交通灯与看板顶栏文字重叠

- 状态：in-progress（Agent 实施完成并 report，待人工确认完成）
- 归属需求：REQ-20260905-001
- 创建：2026-09-05T09:50:51.498Z

## 现象

`npm run app` 打开 Electron 桌面窗口后，macOS `hiddenInset` 交通灯（关闭/最小化/最大化）压在
看板顶栏左上的 `.brand` 区域上——logo「▦」与标题「智能体团队看板」、数据目录路径被遮挡，无法阅读。

## 复现步骤

1. 项目根目录执行 `npm run app`
2. 观察窗口左上角：交通灯与顶栏第一组文字（logo + 标题）重叠

## 期望行为

交通灯悬浮于页面左上但不遮挡任何文字，顶栏内容整体为交通灯让出横向空间；浏览器直连看板时展示不变。

## 修复方向（设计）

- 修在壳层：`electron/main.mjs` 经 `webContents.insertCSS` 注入让位样式（`.topbar` 增大左内边距），
  仅对 Electron 窗口生效；`scripts/web/` 业务代码零改动，浏览器场景不受影响。
- 交通灯占用宽度约 70px，注入 `.topbar { padding-left: 78px; }` 留出安全边距。

## 验收标准

- [ ] `npm run app` 窗口内交通灯与顶栏文字互不遮挡（运行期视觉项，待人工验收）
- [x] 浏览器直连 http://127.0.0.1:7736 时顶栏展示与原先一致（无多余左内边距）——V4 静态契约验证：scripts/web 零改动
- [x] `node scripts/tests/electron-shell.test.mjs` 全部通过（含新增注入契约用例 V4，8/8）

## 关联（引入来源）

- 引入来源：REQ-20260905-001（Electron 壳采用 hiddenInset 后未给页面顶栏预留交通灯安全区）
