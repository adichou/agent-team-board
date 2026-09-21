# 测试用例 — REQ-20260921-015 版本计划详细内容页签的合并入 main 页面去掉隔离分析下方的一大堆红色字体的文字，并提供一键加入所有依赖提交的按钮

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | 后端 add-dependencies：dev 上 A(依赖,done) 先于 B(所选)——一键加入后 A 的条目与最新提交进版本 items，隔离分析收敛为无未选祖先（重算 publish-plan mergeAnalysis.perItem 全空） | 高 | ✅ |
| B2 | 后端归因口径：依赖提交归属条目（主题含单号）→ 纳入；无单号提交（无法归属）→ skipped 含原因，不静默丢失 | 高 | ✅ |
| B3 | 后端校验沿用 addItems：依赖条目未 done → skipped；被其他版本占用 → skipped（含占用版本号）；同条目多个依赖提交 → 取最新（%cI） | 高 | ✅ |
| B4 | 后端锁定态：merging → 409；已推送（pushed）→ 409；无依赖 → 200 added 空幂等；加入后 docs.scopeStale 标记生效（markDocsScopeStale 联动） | 高 | ✅ |
| F1 | 前端有依赖：合并页渲染一行汇总（发现 N 个未选祖先（依赖）提交 · 影响 M 个所选条目）＋「一键加入所有依赖提交」按钮＋明细 details；不再渲染红色长文（blocked 拼接段 / notes 长句 / 逐条目重复长句） | 高 | ✅ |
| F2 | 前端无依赖：保持「所选提交无未选祖先：变更可独立进入主分支。」空态，无一键加入按钮 | 高 | ✅ |
| F3 | 前端单行状态：门禁锁定 / 不在 dev / 合并失败均以单行（bld-iso-note，非 rel-form-err）呈现且文本保留；混合提交单行 + title 全文 | 高 | ✅ |
| F4 | 前端一键加入交互：点击 → 执行中（加入中… 防重复）→ 成功后发布范围更新 + 隔离分析收敛 + 跳过清单展示；失败 toast 可重试；merging / pushed 态 aria-disabled + title | 高 | ✅ |
| F5 | 静态契约：renderMergePane 源码不再输出 rel-form-err 红色长段（加载失败/读取态除外）；mergeBlockReason 增补 blocked 档；i18n 新词条中英同步（EN 值唯一 / 无中文，EN_DYNAMIC 有 ASCII 锚点） | 高 | ✅ |
| R1 | 回归：既有合并页契约（BUG-20260921-014 M1/M2/M3 文本与顺序、BUG-20260920-006 点击必反馈）不回归 | 高 | ✅ |
