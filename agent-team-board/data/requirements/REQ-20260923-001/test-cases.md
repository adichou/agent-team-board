# 测试用例 — REQ-20260923-001 发布看板中的文档编写页面，新增加的文档也要像README.md 一样豁免，允许 Agent 和人自由修改。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

口径落定（README「待确认」1/2/4 按「落定前不弱化既有拦截」保守执行；3 取「全部版本记录并集」并在 test-report.md 留痕待人工复核）：

- 语言变体（`<KEY>_<lang>.md` 与点号命名 `README.en.md`）不豁免；
- LICENSE.md、不在 v.customDocs 清单内的 DESIGN.md 不豁免（LICENSE 为保留名不可能进清单）;
- 自定义文档豁免 = 全部版本记录 `v.customDocs` 的并集（守卫做静态判定，无「当前活跃版本」可用；比活跃版口径宽的部分在报告中列明待人工落定）;
- 提交主题沿用「类型: 描述 单号」规范（复用 `validateCommitSubject`）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 无锁 file 模式编辑插件根第一层 CHANGELOG.md / FEATURES.md / AGENTS.md / README.md（绝对、软链别名、相对路径、apply_patch 目标）放行 | P0 | 通过 |
| R2 | 无锁 Bash 改写（sed -i / > / >> / tee）插件根第一层四类标准文档放行 | P0 | 通过 |
| R3 | 无锁编辑 / Bash 改写 v.customDocs 清单内自定义文档（MIGRATION.md，含多版本记录并集）放行；移出清单后恢复拦截（联动） | P0 | 通过 |
| R4 | 同批命令改受保护源码（scripts/ 等）仍拦，保护面不弱化 | P0 | 通过 |
| X1 | 豁免精确到根第一层单文件：根下其他文件（package.json / index.html / LICENSE.md）与语言变体（README_en.md / README.en.md / MIGRATION_en.md）仍拦 | P0 | 通过 |
| X2 | 目录内同名文件（skills/x/CHANGELOG.md、scripts/AGENTS.md）不获豁免仍拦；清单外同名自定义文档不豁免；docs/ 目录豁免对照不变 | P0 | 通过 |
| X3 | 既有守卫规则回归：runtime/status 直写、人工状态命令 / 接口、无锁改源码拦截不受影响 | P0 | 通过 |
| C1 | 无锁 git commit：pathspec 全为豁免文档（四类标准 + 清单内自定义）、主题「类型: 描述 单号」合规 → 放行（含 git -C / --message / 多 -m；真实插件根同验） | P0 | 通过 |
| C2 | 提交拦截不回退：pathspec 混入源码 / LICENSE.md、无 pathspec 裸提交、-a / --amend、主题无单号或不合规、清单外自定义文档 pathspec 均拦 | P0 | 通过 |
| C3 | REQ-20260917-002 条目目录用户数据提交通道与 REQ-20260918-002 README 通道不回归 | P0 | 通过 |
| L1 | 有效认领锁下原放行行为不变（豁免不引入新拒绝路径） | P1 | 通过 |
| B1 | 基线修订：req-20260918-002.test.mjs 中「AGENTS.md 被拦」的 X1/C2 断言随本单范围变化改订（改为恒不豁免的 LICENSE.md）、伪插件固件补 publish-flow.mjs 依赖；req-20260923-001 / req-20260918-002 / code-guard 三套件与全量 npm test 通过 | P0 | 通过 |
