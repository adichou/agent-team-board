# 测试用例 — BUG-20260916-001 发布能力不要复用原来的发布模块，请在构建模块中重新设计。另外设置模块中没有官网仓库目录的设置，请添加

> 用例编号对应 `scripts/tests/build-publish-20260916-001.test.mjs`（自动化）与既有回归套件（迁移适配）；人工验收项对应 README 验收说明。引入来源：REQ-20260915-002（见 design.md）。

## 自动化用例（build-publish-20260916-001.test.mjs）

| # | 用例 | 断言要点 | 结果 |
| --- | --- | --- | --- |
| A1 | 全局配置验证失败不覆盖有效值，变化递增修订 | 保存有效 Git 仓库根目录成功；相对路径 / 非 Git 目录报错且 `readConfig` 保持旧值；重复保存同值 revision 不变 | PASS |
| A2 | 独立运行存储隔离项目、版本，旧产品记录不可读取 | 运行落盘 `builds/publish-runs/BPUB-*/run.json`；其他 dataDir 列表为空；按 bldId 过滤；非法编号拒绝读取 | PASS |
| A3 | Finder 仅使用结果路径，未生成禁用，删除后拒绝，不读取最新配置 | 打开目标 = 运行快照中记录的目录；site 未生成时不可用；目录删除后报「目录不可访问」且不调用 open | PASS |
| A4 | 新模块不导入旧发布 API、执行器或存储 | 三个新模块源码不 import 旧 product-release / release-store / release-git 等模块；build.js 不再出现 `/api/product-release` | PASS |
| A5 | 真实临时 Git 双目标执行、计划确认、防重复、全局改动失效与成功目录快照 | 临时源码仓库 + 裸远端 + 官网仓库全流程：伪造 token 拒绝启动 → 预检通过 → 计划 token 错误拒绝 → 正确 token 执行成功（webapp/site 双目标 done）→ 运行中重复 start 拒绝 → 远端 main SHA 与冻结一致 → 同版本重复创建拒绝 → 全局配置改为新仓库后旧计划失效（指纹不匹配）→ 已完成运行的目录快照不随设置变化 | PASS |

### A5 跑红记录（TDD）

首跑失败于预检「工作区」检查：`clean()` 用 `--untracked-files=normal` 时 git 把看板运行记录目录折叠为 `?? docs/`，不匹配排除前缀 `docs/agent-team-board/` 被误判为脏。修复为 `--untracked-files=all` 后通过（详见 design.md 实施记录）。

## 回归迁移用例（既有套件，本单适配断言）

| # | 套件 | 适配点 | 结果 |
| --- | --- | --- | --- |
| B1 | i18n-coverage | 设置区官网仓库 10 条新文案补入 EN / EN_DYNAMIC，英文值无中文 | PASS |
| B2 | settings-runparams-removed-20260909-011 | 官网仓库分区使用 `cx-config homepage` 语义 class，运行参数分区删除契约不变 | PASS |
| B3 | commit-rollback-20260911-006 E1 | 设置页就绪态恰三个分区（官网仓库 + 批量任务 + Git 工作流），保存载荷仍仅含 refine | PASS |
| B4 | bug-release-tab-inplace-20260915-014 | mock 全套迁移 `/api/build-publish/*`（19 用例：页签、就地查看、创建落点、项目/版本隔离、状态反馈、计划确认、防重复、i18n、静态契约）；failed 重试经计划确认；确认按钮文案「确认发布」 | PASS |
| B5 | product-release-ui H1 | 创建发布走独立 `/api/build-publish/from-build`；build.js 不再调用旧产品发布 API；旧模块 release.js 自身用例（H2–H5）不回归 | PASS |

全量回归：`npm test` 260 个测试文件全部通过。

## 人工验收项（不自动化，对应 README 验收说明）

| # | 验收点 | 方式 |
| --- | --- | --- |
| M1 | 发布主按钮始终可见与禁用原因、计划弹窗取消不启动、确认发布才执行、执行中防重复 | Status Board 构建 → 版本计划 → 发布页签实操 |
| M2 | 成功后构建物目录 / 官网目录并列展示、路径可复制、历史快照不随设置改写、项目/版本/运行不串目录 | 对照运行记录与目录区 |
| M3 | 真实 Finder 打开两个目录（构建物目录、官网产品内容目录而非仓库根目录）、失败原因与重试 | 本机 macOS 实操（单测为注入 mock，不覆盖真机行为） |
| M4 | 设置官网仓库区域：保存有效目录回显；空值/相对路径/非 Git/缺 main 的明确原因；失败不覆盖旧值 | 设置页实操 |
| M5 | 缺配置「前往设置」→ 保存 →「返回发布」回到同一项目与版本，草稿与发行版本号不丢 | 页面流转实操 |
| M6 | 修改配置后旧预检失效，重新预检并确认后才能启动；界面标注全局共享 | 实操 + 观察预检失效提示 |
