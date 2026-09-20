# 设计 — REQ-20260916-002 补充发布流水线可识别的 Web App 静态入口（仓库根 index.html 产品落地页）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

发布执行器（scripts/lib/build-publish.mjs）仅识别两种 Web App 形态：冻结仓库根存在 `index.html`
的静态站，或 vite/astro/CRA/vue-cli/nuxt 的 `build` 产物。本项目 Web 端由 server.mjs 动态服务、
无打包器，导致 BLD-20260914-001 预检失败。本单在仓库根新增自包含 `index.html` 产品落地页，
使冻结源码满足「静态站」形态判定，且页面正文包含版本号 1.0.0 供发布回验 `body.includes(run.version)`。

## 方案

（技术选型、接口设计、影响面）

- 形态：单文件静态页 `index.html`（仓库根）。内联 CSS/JS，无 `<link>`/`<script src>`/`@import`
  外链、无 `http(s)://` 资源引用、无 fetch/XHR 网络请求，浏览器直接打开可用，无构建步骤。
- 内容：产品介绍（三栏协作）、核心能力六卡片、Status Board 启动说明（atb init / server.mjs / :8888
  / cli install）、Electron 桌面 App（npm run app / npm run dist）、英文摘要区（`lang="en"`）、
  页脚含「版本 1.0.0」。
- 交互：纯静态展示，无表单；「English」锚点平滑滚动（scroll-behavior）；代码块「复制」按钮内联
  JS 实现，优先 `navigator.clipboard`，非安全上下文降级 `execCommand('copy')`，失败自动选中文本
  并提示手动复制；成功态「已复制」1.5s 后还原。
- 外观：深浅色跟随系统 `prefers-color-scheme`（CSS 变量 + color-scheme），窄屏（≤640px）能力
  卡片降为单列。
- 开源选型（REQ-20260909-015）：自研，理由为「引入成本高于自研」——单文件静态落地页不满足任何
  依赖引入条件（页面约束为无外部依赖、无构建步骤），引入任何库（CSS 框架/JS 库）都必须外链或
  vendor 源码，直接违反本单「自包含、无外网依赖」验收标准；未使用开源库，不创建 licenses.md。
- 影响面：仅新增 `index.html` 与测试 `scripts/tests/root-index-webapp-entry-20260916-002.test.mjs`
  （纯文件断言，无子进程/端口，随 run-all.mjs 自动发现纳入 npm test）。不改 package.json
  （不加 `scripts.build`、版本保持 0.1.0）、不改 server.mjs/electron/scripts 现有模块。

## 风险与边界

- 发布回验以页面正文含 `1.0.0` 为准：后续版本号变更时需同步更新本页头部徽标、`<title>` 与页脚
  （三处），否则 webapp-verify 会失败——该维护点已在 README 验收标准中写明。
- 本单不做发布操作；完成后由人工合并入 BLD-20260914-001 再回到发布页签重新预检。
- 页面文案为产品级展示内容，不承载看板数据逻辑，与 Status Board 服务零耦合。
