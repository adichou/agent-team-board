# 测试用例 — REQ-20260916-002 补充发布流水线可识别的 Web App 静态入口（仓库根 index.html 产品落地页）

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/root-index-webapp-entry-20260916-002.test.mjs`（纯文件内容断言，无子进程、无端口）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T01 | 仓库根存在 `index.html` 且为 HTML 文档（`<!DOCTYPE html>`、`<html>`、UTF-8 charset、`<title>` 齐备） | P0 | 通过 |
| T02 | 自包含：无外部资源引用——不允许 `src="http(s)://…"`、`href="http(s)://…"`、`<script src=…>`、`<link …>` 外链样式、`@import` 外链；仅允许页内锚点 `href="#…"` | P0 | 通过 |
| T03 | 页面正文包含发行版本号字符串 `1.0.0`（发布回验 `body.includes(run.version)` 口径） | P0 | 通过 |
| T04 | 双语：主体中文（`lang="zh"` 起始）且包含英文摘要区（存在 `lang="en"` 标注区块及 English 标题） | P1 | 通过 |
| T05 | 内容完整性：含产品介绍、核心能力、启动 Status Board 服务（`server.mjs` 与 8888 端口说明）、Electron App（`npm run app` / `npm run dist`）四类文案 | P1 | 通过 |
| T06 | 无构建步骤泄漏：页面不引用任何打包器产物路径（`/assets/`、`.js` 模块外链、`vite`/`astro` 等构建标识）；`package.json` 无 `scripts.build`（静态形态判定不被破坏）、版本号保持 `0.1.0` 不动 | P1 | 通过 |
| T07 | 交互自包含：复制按钮等内联 JS 正常内嵌（存在 `<script>` 内联块），无 `fetch`/`XMLHttpRequest` 网络请求 | P2 | 通过 |
