# 测试用例 — REQ-20260921-002 分支浏览提交记录升级为 git 提交树可视化并支持搜索

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现文件：`scripts/tests/req-20260921-002.test.mjs`；受影响旧口径（自研行内轨道 → gitgraph 树、
> q 过滤 → 双模式）同步更新 req-20260920-001 / bug-20260920-002 / build-ui 测试。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | 真实仓库：branchLog 每条提交附 tags（lightweight 与 annotated 均按指向 commit 归位；无 tag 为 []），既有字段不破坏 | 高 | 通过 |
| B2 | 真实仓库：branchSearchLog mode=filter（q 默认模式升级）——保留集 = 匹配 ∪ 祖先闭包（沿 parents），total=保留集数、matchedTotal=匹配数，分页在保留集上 | 高 | 通过 |
| B3 | 真实仓库：mode=highlight——数据集与默认分页一致（不过滤），附 matchedHashes（全量命中 hash）与 matchedTotal | 高 | 通过 |
| B4 | 真实仓库：匹配范围覆盖 message / 作者 / hash / tag 名 / 分支名（选中分支名与双支 heads 名按 side 归属），忽略大小写 | 高 | 通过 |
| B5 | 真实仓库：双支并集（main∪dev）下 filter / highlight 两模式口径一致（heads/mergeBase/side 保留，闭包沿并集 parents） | 高 | 通过 |
| B6 | 真实仓库：无匹配时 filter 返回空集 + matchedTotal=0；mode 非法值回退 filter；q 空白走默认分页（回归） | 中 | 通过 |
| T1 | treeData 纯函数：commits → git2json 数组（refs 组装：heads 命中行带分支名、tags 带 `tag:` 前缀；parents 截断到页内集合；merge 行标记） | 高 | 通过 |
| T2 | treeData：页边界截断（父在集合外 → parents 视为空，树不画向页外父）；高亮集合（matchedHashes）与选中传参保留 | 中 | 通过 |
| R1 | vm 注入 fake GitgraphJS：mountTree 走 gitgraph 路径——createGitgraph + import(treeData) 被调、orientation/template 生效、commit onClick 绑定 selectLogRow → 详情区 | 高 | 通过 |
| R2 | 降级：无 GitgraphJS（加载失败 / 测试桩）→ 行式列表（data-log-row）+ 详情交互与合并标签保留，不出现失效入口 | 高 | 通过 |
| R3 | 双模式搜索 UI：模式 radio（高亮定位 / 过滤（保留祖先）），请求附 mode；高亮计数「高亮 N 处匹配（message / 分支名 / tag）」；过滤计数「匹配 N 条 · 保留 M/T 条（含祖先，泳道连通）」 | 高 | 通过 |
| R4 | 搜索状态回归：无匹配空态（区分「该分支暂无提交」）+ 一键清除；清空恢复全量；切分支重置搜索；翻页 / 每页条数 / 失败重试带 mode | 高 | 通过 |
| R5 | 深浅色：matchMedia(prefers-color-scheme) 选浅 / 深两套 gitgraph 模板配色（树重画口径） | 中 | 通过 |
| S1 | index.html 在 build.js 之前引入 /gitgraph.umd.min.js；vendor 文件存在且为官方 1.4.0 UMD（含 GitgraphJS 全局与 license 头） | 高 | 通过 |
| S2 | style.css：树容器 / 模式控件 / 命中高亮（svg text.hit 浅深两套）/ 选中 / 合并标识样式类存在 | 中 | 通过 |
| I1 | i18n：新增文案（模式 label / 计数 / 空态）进 EN / EN_DYNAMIC，值无中文、静态值唯一（BUG-20260912-001 口径） | 高 | 通过 |
