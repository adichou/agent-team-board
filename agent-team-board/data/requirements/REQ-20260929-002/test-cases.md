# 测试用例 — REQ-20260929-002 发布模块删除 Web App 构建目标，不再校验任何构建目标

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/build-publish-20260929-002.test.mjs`（新增）；
> 既有测试同步更新：`build-publish-20260916-001.test.mjs`、`build-publish-site-vite-20260916-004.test.mjs`（执行阶段删除后的新口径）、`bug-20260928-012.test.mjs`、`bug-20260928-002.test.mjs`、`bug-release-tab-inplace-20260915-014.test.mjs`（未配置官网仓库禁用断言随口径删除）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| E1 | Chrome 扩展形态（无 package.json / 无根 index.html / 无远端 / 无官网配置）全链路发布成功：预检通过且结果不含 profile 字段；plan 步骤恰 1 条且不含推送 / 构建文案；start 后 run 即 succeeded 且不产生 stages / targets / directories；全程无 git push（bare 远端无任何 refs） | P0 | 通过 |
| E2 | 确认落账：start 后版本计划 release.confirmedAt 固化、isReleased=true、releasedAt=确认时点；成功后再次 start 拒绝（状态不可发布） | P0 | 通过 |
| E3 | token 错误拒绝发布；未合并（非 merged）版本 create 拒绝 | P1 | 通过 |
| E4 | 已发布不可逆：同版本号再 create 拒绝「已发布」；已发布版本 saveInfo / addItems 抛 PUBLISHED_READ_ONLY | P0 | 通过 |
| E5 | 存量兼容：旧形态 run.json（含 stages / targets / directories / succeeded）原样读取不报错；publishedByBld 对存量 succeeded 运行（版本计划无确认账）不回退已发布标识；GET run 详情 API directories 装配保留 | P0 | 通过 |
| E6 | 发布不依赖官网配置与物料：官网仓库未配置（空配置）、或已配置但 apps.js 未注册 / content 材料缺失——预检通过、发布成功 | P0 | 通过 |
| E7 | inputs / create / precheck 不再要求源码远端：无 remote 的项目不报「源码远端缺失或歧义」 | P0 | 通过 |
| E8 | i18n 键清理：「请先配置官网仓库」「请先配置官网仓库后再发布」「无法识别冻结源码的 Web App 构建方式（…）」两语言键已同步移除 | P1 | 通过 |
| E9 | build.js 静态断言：发布步无「请先配置官网仓库」「前往设置」「推送主分支」「动作一 · 推送远端」等入口残留 | P1 | 通过 |
| E10 | 前端假 DOM：未配置官网仓库时「发布」按钮不再因未配置禁用；检查通过后二次确认弹窗展示发布计划（1 条，来自服务端 plan） | P1 | 通过 |
| E11 | 落账失败反馈：版本计划记录缺失时 start 失败（run failed + 原因可重试），不产生假成功、不误锁版本 | P1 | 通过 |

补充：E5b（仅确认账无 succeeded 运行也推导已发布——publishedByBld 并集口径新分支）与 E10c（确认发布后结果面板显示发布成功与发布时间）随主用例一并通过。既有测试同步更新：`build-publish-20260916-001`（全链路改新口径 + 官网配置变化不再使指纹失效）、`build-publish-site-vite-20260916-004`（官网各形态与发布成败解耦；productIds / config API 保留）、`bug-20260928-011`（profile 落库删除）、`bug-20260928-014`（无执行阶段 / 不推送口径）、`bug-20260928-015`（失败口径收敛为落账失败）、`bug-20260929-003`（计划 1 条、不推送）、`bug-20260928-004`（两动作区删除契约 + 死键清理）、`bug-20260928-005 / 002 / 012`、`bug-release-tab-inplace-20260915-014`、`bug-build-ver-published-chip-20260917-001`（publishedByBld 迁移调用点）、`req-20260920-003 / req-20260921-007 / req-20260921-008 / req-20260926-002`（发布步两动作断言随删除更新）。`npm test` 全量 384 个测试文件通过。
