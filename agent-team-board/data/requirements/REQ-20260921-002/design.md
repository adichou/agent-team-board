# 设计 — REQ-20260921-002 分支浏览提交记录升级为 git 提交树可视化并支持搜索

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

分支浏览右栏此前为 REQ-20260920-001 的自研行内泳道（每行一个 `<svg class="bld-graph">` + logGraph 纯函数
轨道布局）+ REQ-20260914-002 的服务端纯匹配过滤搜索。本需求把渲染层升级为 vendored @gitgraph/js，
搜索升级为双模式（高亮定位 / 过滤保留祖先）。

## 方案

**开源选型（REQ-20260909-015）**：见 README 选型结论——`@gitgraph/js@1.4.0`（MIT，npm 官方
`lib/gitgraph.umd.min.js` 构建产物原样 vendor 到 `scripts/web/gitgraph.umd.min.js`，约 36KB；
无构建链无法以 npm 依赖引入，vendor 例外口径与复制范围见本目录 licenses.md）。无复制库源码，
仅官方发布产物；无新增 npm 构建链。

**数据层（复用既有链路，只读扩展）**：

- `build-git.mjs`：`readCommitTags()`（`git for-each-ref refs/tags`，annotated 以 `%(*objectname)`
  解引用到实际 commit）为每条 commit 附 `tags: string[]`；`branchLog` / `branchUnionLog` 附着。
- `branchSearchLog(root, branch, { q, mode, limit, offset })` 双模式（server.mjs 透传 mode，非法值归一 filter）：
  - 匹配字段 = subject / author / 短 hash / 完整 hash（既有四字段）+ **tags** + **分支名**
    （选中分支名命中 ⇒ 数据集全部；双支 heads 名命中 ⇒ 对应 side 提交），忽略大小写子串。
  - `mode=filter`（q 默认）：保留集 = 匹配 ∪ 祖先闭包（沿全量 parents 回溯），保留集上分页；
    响应附 `matchedTotal` / `allTotal`，`total` = 保留集数——泳道连通不断线（取代旧「断档虚线」语义）。
  - `mode=highlight`：数据集与默认分页一致（不过滤），附全量命中清单 `matchedHashes` 与
    `matchedTotal`，`total` = 全量数（分页条口径不变）。

**渲染层（scripts/web/build.js）**：

- `treeData(commits, { heads, branchName })` 纯函数：commits（新→旧）→ gitgraph `import()`
  支持的扁平 DAG 数组（git2json 形态）。refs 组装分支名（双支 heads 命中行；单支模式最新行挂
  选中分支名）与 `tag: <名>`；parents 截断到集合内（页边界 / 闭包外父不外连，gitgraph 无页外
  虚线桩，页边界以「父提交在后续页，轨道继续」提示行补充）；合并行附 `mergeParents`。
- `mountTree(view)`（bindCommon 渲染后）：`window.GitgraphJS` 在位时 `createGitgraph`（metro 模板
  定制：`vertical-reverse`、等宽字体 message、浅深两套色板随 `prefers-color-scheme` + change 重画）
  + `import(treeData(...))`，每条提交注入 `onClick`（click 切换选中详情，沿用 REQ-20260920-001 口径）；
  vendor 加载失败 / 渲染异常降级为行式列表（`fallbackTreeHtml`，保底可读可交互）。
- `decorateTree` 渲染后处理：highlight 模式命中行 message text 加 `.hit` 并滚动定位首条；选中 `.sel`；
  合并提交 `.gg-merge` + `<title>` 悬停「合并 · N 父提交」。
- 自研 `logGraph` / `graphSvg` 行内 SVG 随渲染层替换移除（死代码不留）；详情区 / 并集提示 /
  merge-base 标注 / 分页条 / 空态口径全部保留。

**搜索 UI**：搜索行加模式 radio（默认「高亮定位」；模式为视图偏好，切分支不重置）；请求附
`q` + `mode`；计数行按模式显示「高亮 N 处匹配（message / 分支名 / tag）」或
「匹配 N 条 · 保留 M/T 条（含祖先，泳道连通）」；无匹配空态 / 一键清除 / 清空恢复 / 切分支重置
沿用既有口径（高亮模式无命中时数据集不变，计数 0 处、不出空态）。

**i18n（BUG-20260912-001）**：新增模式 label / 计数 / placeholder 词条（EN / EN_DYNAMIC）；
随虚线断档语义清理旧词条（「搜索已隐藏中间提交…」「◇ 个父提交未显示（虚线延续）」「共 ◇ 条匹配
（关键词：◇）」「搜提交说明 / 作者 / hash…」）。

**自研说明**：搜索闭包 / 匹配 / treeData 适配均为数据层自建（库不提供），与渲染库解耦可复用；
未引入其他库。

## 风险与边界

- **gitgraph.js 上游已归档**：API 冻结、体积小（36KB）MIT，风险可控（README 论证）；vendor 失败
  自动降级行式列表，不出失效入口。
- **import() 为上游 experimental API**：已用官方 UMD bundle 在最小 DOM 桩上冒烟验证（数据形态含
  refs / tags / onClick 可跑通），并以 fake GitgraphJS 注入测试锁定调用契约；后续升级版本需回归
  req-20260921-002 测试。
- **octopus（3+ 父）合并**：gitgraph merge 语义为双亲；treeData 数据层保真全部父（mergeParents
  计数），树渲染以 gitgraph 布局为准，极端拓扑以详情区父提交清单为准。
- **性能**：搜索为一次全量元数据读取 + Node 侧匹配闭包（与既有搜索同范式，无新增注入面）；
  树渲染按页（默认 50 条）导入，容器限高滚动。
