# 开源组件许可记录 — BUG-20260923-002

| 库名 | 版本 | 引入方式 | License | 仓库地址 |
| ---- | ---- | -------- | ------- | -------- |
| mermaid | 11.17.2 | vendor（官方 npm 包 `mermaid@11.17.2` 的 `dist/mermaid.min.js` IIFE min 构建产物原样复制到 `scripts/web/mermaid.min.js`；不静态引入，由 `scripts/web/md-rich.js` 首次遇到图表围栏时动态注入 `<script>` 懒加载） | MIT | https://github.com/mermaid-js/mermaid |

## vendor 例外说明（REQ-20260909-015 口径）

- **复制范围**：仅官方发布的 `mermaid@11.17.2` npm 包内 `dist/mermaid.min.js` 单个 IIFE min 构建产物（3,572,661 字节，含 bundle 尾部上游许可注释），不复制任何源码 / 类型声明 / 其他构建文件。
- **原因**：本产品 Web 前端为零构建链（无 npm 打包，第三方库以 vendor 的 UMD/IIFE bundle 放 `scripts/web/` 直接引用为既有先例：marked、highlight.js、gitgraph），无法以 npm 依赖方式引入该浏览器渲染库。体积较大（约 3.5MB），故采用懒加载：仅在首次渲染 mermaid 围栏时动态注入，常规页面加载零成本。
- **上游许可**：mermaid 为 MIT（版权 Knut Sveidqvist 等）；bundle 内联依赖（cytoscape、dagre-d3、lodash 等）均为 MIT 系许可，随官方构建产物的尾部注释保留。
- **下载口径**：`https://registry.npmjs.org/mermaid/-/mermaid-11.17.2.tgz` 官方 tarball，`package/dist/mermaid.min.js` 原样复制，未做任何修改。
