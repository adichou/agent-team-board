# 设计 — BUG-20260920-002 main 分支的 git log 显示需要优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260913-001**（构建模块「分支浏览」落地单支读取口径：右侧提交记录 = 所选分支可达集合，
  从一开始就不含另一条分支的独有提交与分支头）+ **REQ-20260920-001**（在该单支数据之上引入行内历史拓扑图，
  沿用单支 `git log <branch>`，且颜色按槽位序号分配、无引用 / merge-base 元数据，四项缺陷一并固化）。
  两编号均经 `atb list` 核验真实存在（REQ-20260913-001 done / REQ-20260920-001 in-progress）。

## 根因分析

1. **单支读取**：`scripts/lib/build-git.mjs` 的 `branchLog` / `branchSearchLog` 执行 `git log <branch>`，
   只返回所选分支可达提交——选中 main 时 `main..dev` 的提交与 dev 分支头完全缺席（本仓库实测 11 条）。
2. **无分支身份元数据**：提交格式 `%H %h %an %aI %P %s` 不含任何引用信息，前端无从标注分支头。
3. **配色与分支无关**：`logGraph`（scripts/web/build.js）按行内槽位序号分配 `lg-c0..` 色类，
   同一分支翻页 / 搜索后颜色不稳定。
4. **无汇聚点表达**：后端不计算 merge-base，前端只画真实父子边，无汇聚连线与标注。

## 方案

固定双分支模型（本产品 Git 工作流 = main + dev，`git-flow.mjs` 的 `resolveMainBranch` / `DEV_BRANCH`）：

- **后端（只读，server.mjs 接口签名不变）**：`branchLog` / `branchSearchLog` 在「所选分支为主分支或 dev，
  且两支本地并存」时切换并集口径——`git log <main> <dev>`（refs 顺序固定 main 在前，main / dev 选择
  同一并集同一排序）、total = `rev-list --count main dev`；`rev-list <main>..<dev>` 求 dev 独有集合，
  逐提交附 `side: 'dev' | 'main'`（共享历史随 main）；响应附 `heads: [{name, hash}]`（两支头）与
  `mergeBase`（`git merge-base`，无共同祖先为 null）。其余分支（feature / origin-*）保持单支口径不变；
  搜索 / 分页在并集上沿用既有归一（limit clamp [1,500]、offset、四字段匹配）。
- **前端（scripts/web/build.js）**：`logGraph` 纯函数扩展 `colorOf(hash) → 色号` 与 `mergeBase` 两个可选参数——
  命中时节点 / 父边按分支稳定配色（main→lg0 蓝 / dev→lg1 橙，同 hash 恒同色，翻页 / 搜索不跳变；汇聚点
  按 main 侧配色不因上线 dev 色误染），mergeBase 命中行输出 `mergeBase` / `mbTo`（水平汇聚虚线车道）；
  未传参数时行为与既有完全一致（单支零回归）。渲染层：heads 命中行加分支头名称标签（bt-main / bt-dev，
  按轨道色 + 头节点外圈），mergeBase 行加「Merge-base」虚线描边标签（非颜色提示）与 `lg-mb` 水平虚线，
  详情区选中汇聚点时加「main ∩ dev 汇聚点」标注；双支态顶部加并集提示行（真实分支名插值）。
- **样式（scripts/web/style.css）**：`.bld-branch-tag`（bt-main / bt-dev / bt-mb）、`.lg-mb`、`.lg-head`、
  `.bld-log-union`。
- **i18n（scripts/web/i18n.js）**：新增静态 EN 两条（merge-base 悬停提示、详情标注）与 EN_DYNAMIC 一条
  （并集提示，◇ 与 ◇ 插值分支名）。
- 不改状态机、不切分支、不写任何引用：全程只读；合并双圈节点与「合并 · N 父提交」标签、分页 / 搜索 /
  刷新 / 加载 / 空 / 失败重试等既有能力零回退。

**开源选型（REQ-20260909-015）**：未引入开源库（不创建 licenses.md）。自研理由：引入成本高于自研——
图形库（如 gitgraph.js）自带完整渲染与数据模型，与本实现「行内 SVG + 服务端分页 / 搜索断档虚线 + 只读
纯函数 logGraph」架构不匹配，替换整库需重做分页 / 搜索 / 断档口径且回归面大；本修复是既有纯函数与
git 只读命令的增量扩展（union 读取 + 三个元数据字段 + 着色钩子），无新增第三方依赖。

## 风险与边界

- 并集口径仅覆盖 main + dev（含 master 回退）；其他本地 / 远端分支组合维持单支（README 已声明待确认，
  本单不扩大范围）。
- `rev-list <main>..<dev>` 全量求 dev 独有集合：规模 = 未合并提交数（正常工作流下小；搜索模式本就全量读取）。
- 不相关历史（无 merge-base）时 mergeBase=null，界面不虚构汇聚点。
- 远端分支行点击仍是既有「分支不存在」报错口径（单支 rev-parse refs/heads 校验，非本单范围）。
