# 设计 — REQ-20260830-002 File Board：浏览项目相关文件夹并支持语法高亮

> 状态：选型调研初稿（2026-08-30，上网调研结论），待人工接受后进入开发时细化。

## 背景

- Status Board 是零依赖 Node `http` 服务（`scripts/server.mjs`），无打包器、无框架，前端为原生 JS 单页（`scripts/web/`）。
- 第三方库的引入模式是 **vendor 单文件**：`web/marked.min.js`（~35KB）。新增能力必须沿用此模式，不引入构建步骤。
- 本需求明确约束：不自己发明轮子，文件树与语法高亮均复用成熟开源库。

## 方案

### 选型 1：语法高亮 → highlight.js

| 方案 | 质量 | 体积/集成 | 无打包器 vendor 可行性 | 结论 |
| ---- | ---- | ---- | ---- | ---- |
| **highlight.js** | 良好，190+ 语言，自带语言自动检测 | 官方单文件浏览器版（`highlight.min.js` ~130KB + 一个 CSS 主题） | ✅ 与 `marked.min.js` 完全同构 | **推荐** |
| Prism.js | 良好，社区插件多，[基准测试](https://chsm.dev/blog/2025/01/08/comparing-web-code-highlighters)中最快 | 核心单文件，按需语言依赖 autoloader 动态拉取 | ⚠️ 可行（需 vendor autoloader + 逐语言 grammar） | 备选 |
| Shiki | 最佳（VS Code 同款 TextMate 引擎与主题） | 最重、最慢（[约为 Prism 的 1/7 速度](https://chsm.dev/blog/2025/01/08/comparing-web-code-highlighters)） | ❌ [需 WASM 引擎 + 按语言加载 grammar/theme 资产](https://shiki.style/guide/bundles)，无打包器时要 vendor 几十个文件 | 质量优先再考虑 |

调研来源：

- [Shiki vs Prism vs highlight.js 2026 – pkgpulse](https://www.pkgpulse.com/guides/shiki-vs-prismjs-vs-highlightjs-syntax-highlighting-2026)
- [Comparing Web Code Highlighters – chsm.dev（2025-01 基准）](https://chsm.dev/blog/2025/01/08/comparing-web-code-highlighters)
- [highlight.js #3625：Prism vs Highlight.js 官方讨论](https://github.com/highlightjs/highlight.js/issues/3625)
- [Shiki 浏览器/无打包器场景的 WASM 资产问题（octref/shiki#22）](https://github.com/octref/shiki/issues/22)

理由：只读浏览场景，highlight.js 的单文件 + 语言自动检测 + 主题 CSS 最贴合零构建 vendor 模式；Shiki 的质量优势不值得几十个资产的复杂度。

### 选型 2：文件树 → Wunderbaum

| 方案 | 依赖 | 状态 | 结论 |
| ---- | ---- | ---- | ---- |
| **Wunderbaum** | 无（[Fancytree 作者的原生重写版](https://github.com/mar10/wunderbaum)） | 活跃维护，支持懒加载/过滤/键盘导航/大数据量 | **推荐** |
| jsTree / Fancytree | jQuery | 维护模式/近乎不活跃，[社区在迁离](https://forum.xwiki.org/t/removing-the-jstree-dependency-overhaul-of-the-tree-macro/12802) | 排除 |
| 原生 `<details>/<summary>` 自绘 | 无 | — | 违背「不造轮子」，仅作降级 |

### 集成设计（草案）

1. `server.mjs` 新增只读 API：
   - `GET /api/fs?path=<相对路径>` → 目录列表（名称/是否目录/大小/mtime）；服务端 `fs.realpath` 校验必须位于项目根内，拒绝 `node_modules/`、`.git/` 等越界请求（防路径穿越）；
   - `GET /api/fs/file?path=…` → 文件内容，限 1MB、非二进制，超限返回提示。
2. 前端 `web/` 顶部 Tab 切换 Status / File 两视图；vendor `highlight.min.js` + 主题 CSS + Wunderbaum dist。
3. 文件树默认展开 `docs/agent-team-board/`，可导航至项目根；点击文件按扩展名 + highlight.js 自动检测高亮渲染。

## 风险与边界

- Wunderbaum dist 若为多文件 ESM，需确认 vendor 后离线可用（无 CDN 依赖）；不可用则树降级原生 `<details>`、高亮降级 Prism（均为单文件）。
- 「相关文件夹」范围以 README 验收标准为准：默认 `docs/agent-team-board/`，可导航至项目根。
- 只读：File Board 不提供编辑/写入，不触碰状态机。
