# 开源组件许可记录 — REQ-20260921-002

| 库名 | 版本 | 引入方式 | License | 仓库地址 |
| ---- | ---- | -------- | ------- | -------- |
| @gitgraph/js | 1.4.0 | vendor（官方 npm 包 `lib/gitgraph.umd.min.js` 构建产物原样复制到 `scripts/web/gitgraph.umd.min.js`，经 `index.html` 直接 `<script>` 引入） | MIT | https://github.com/nicoespeon/gitgraph.js |

## vendor 例外说明（REQ-20260909-015 口径）

- **复制范围**：仅官方发布的 `@gitgraph/js@1.4.0` npm 包内 `lib/gitgraph.umd.min.js` 单个 UMD min 构建产物（36,629 字节），不复制任何源码 / 类型声明 / 其他构建文件。
- **原因**：本产品 Web 前端为零构建链（无 npm 打包，第三方库以 vendor 的 UMD bundle 放 `scripts/web/` 直接引用为既有先例：highlight.js、marked），无法以 npm 依赖方式引入该浏览器渲染库。
- **上游状态**：gitgraph.js 仓库上游已归档，但 API 冻结、体积小（约 36KB）、MIT 许可，工具型项目风险可控（README 选型论证）。
