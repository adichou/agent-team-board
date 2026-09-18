# 设计 — REQ-20260910-017 新建条目中支持对截图进行双击放大查看

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

新建需求 / Bug 表单（REQ-20260909-009 截图区块）在提交前只能看 128×84 缩略图，无法核对截图
文字与内容。已有条目文档的 `linkupDocImages()` 走 `#oncallLightbox`（点击任意处关闭、无文件名 /
加载反馈），且面向服务端附件 URL；本需求面向创建前的本地 `newShots`（dataUrl 已在内存），交互
与反馈口径不同（文件名 + 关闭按钮、加载 / 失败 / 重试、焦点管理、Esc 分层），不复用该灯箱。

## 方案

纯前端自研，零新增依赖：

- **节点常驻**：预览层 `#shotPreview` 常驻 `index.html`（`role="dialog" aria-modal="true"`，
  对齐 `#shortcutHelpWrap` 先例），含顶部 `#shotPreviewName`（文件名，窄窗口截断）+
  `#shotPreviewClose`（不收缩，始终可见）与内容区 `#shotPreviewBody`（aria-live）。
- **层级**：`.shot-preview` fixed 全屏、`z-index 35`——盖过新建侧拉面板 `.side-panel`（25），
  低于 toast（40）；背景表单被遮罩覆盖不可操作（防误触创建）。
- **打开路径**：`renderShots()` 给每张缩略图补「查看大图」按钮（`type=button`，原生 Enter/Space
  可达）与 `data-shot-i`；双击绑定在卡片上，`target.closest('.shot-x, .shot-view')` 守卫使双击
  落在按钮上不触发；卡片无 click 绑定（单击不开预览不提交）。文件选择与粘贴共用 `newShots`，
  天然同一路径。
- **三态**：打开即挂载隐藏 `img` + 「图片加载中…」提示；`load` 后只显示大图（等比
  `object-fit:contain`，`max-width/max-height:100%` 不超视口）；`error` 换「图片无法加载」+
  重试 + 关闭，重试仅按 `shotPreview.idx` 重载当前图，不新增附件。
- **迟到结果失效**：`shotPreview.token` 在打开 / 关闭 / 重试时递增，旧 `load`/`error` 回调比对
  token 后丢弃——关闭或切换图片后不被上一张的迟到结果覆盖。
- **Esc / Tab**：预览打开时注册 `window` keydown 捕获（对齐 uiConfirm 先例）：Esc `preventDefault +
  stopPropagation` 只关预览（不外溢关闭背景新建面板，一次只关一层），Tab 走 `trapShotPreviewFocus`
  圈定（对齐快捷键帮助面板先例）；`onGlobalKeydown` Escape 链头部补同语义分支兜底。关闭恢复
  触发入口焦点；`closeModal` / `openModal` 同步 `shotPreviewClose({restoreFocus:false})` 清理，
  退出表单无遗留遮罩。
- **影响面**：`scripts/web/index.html`（常驻节点 + 双击提示）、`scripts/web/app.js`
  （`renderShots` 模板与绑定、预览函数组、`openModal`/`closeModal` 清理、Esc 链分支、绑定段
  接线）、`scripts/web/style.css`（`.shot-preview*` 与 `.shot-view`）。不触碰截图校验口径
  （≤9 张 / 8MB）、提交数据结构（`attachments` 按序携带）与 `linkupDocImages()` 既有行为。

**开源选型（REQ-20260909-015）**：未引入开源库——自研理由：引入成本高于自研。本交互面很小
（单图查看 + 三态反馈 + 焦点圈定），成熟 lightbox 库（如 PhotoSwipe）需构建链 / 打包产物，
而本项目 web 前端为无构建的零依赖 vanilla JS（vendor 的 marked/highlight/wunderbaum 均为渲染
必需的单文件），且需求要求与项目既有 uiConfirm / shortcutHelp 的 Esc 分层、焦点圈定、常驻
节点模式一致；库的能力（多图轮播 / 缩放手势 / 历史 API）在本需求中明确不需要。未使用开源
库，不创建 licenses.md。

## 风险与边界

- `window.addEventListener` / `removeEventListener` 采用可选调用（`?.`）：真实浏览器恒存在，
  仅兼容项目测试沙箱的最小 window 桩，行为无差。
- 预览只在新建面板打开期间存在，与 `#oncallLightbox`（讨论模块）互不同时出现，互不影响。
- 模拟 DOM 测试环境的「初始 hidden 态」需与 index.html 对齐：`shortcuts-20260910-007` 的
  `INITIALLY_HIDDEN` 清单与 `impl-entry-ui` E10 的初始隐藏桩已按既有维护模式补 `#shotPreview`
  （同 `#shortcutHelpWrap` 先例）。
