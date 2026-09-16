# 设计 — BUG-20260916-001 发布能力不要复用原来的发布模块，请在构建模块中重新设计。另外设置模块中没有官网仓库目录的设置，请添加

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260915-002**（已 `atb list` 核验存在）。`git log -S '/api/product-release' --reverse -- scripts/web/build.js` 证实 ae698d5（REQ-20260915-002）首次把 `/api/product-release/*` 系列接口接入构建模块 build.js：从已合并版本发起发布直接复用旧产品发布模块的后端 API、执行器与运行存储，官网仓库目录表单也保留在旧模块 `release.js renderProductConfig()`，设置模块从未获得独立入口。BUG-20260915-014（f7ad437）后续修复跳转问题时沿用了该接入方式（补充关联，非源单）。

## 根因分析

1. **发布能力复用旧模块**：REQ-20260915-002 实现跨仓库产品发布时，将构建模块的「创建发布 / 预检 / 计划 / 执行 / 结果」整体建立在旧 `/api/product-release/*` 与 `product-release-pipeline.mjs` 之上；构建内发布没有自己的后端 API、执行器与运行存储，旧模块被隐藏后链路依旧耦合其配置与初始化。
2. **设置缺官网仓库入口**：官网仓库根目录的读写（server.mjs `/api/product-release/config`，按项目 dataDir 存储）只服务于旧发布模块，输入表单留在 `release.js renderProductConfig()`；设置模块（app.js settings 视图）从未加入该配置，用户无从在设置中完成发布前配置。

## 方案

**开源选型（REQ-20260909-015）**：本单为自研模块拆分与界面重组——复用项目内既有的零依赖 Node 基建（`core.mjs` 的 AtbError / writeJsonAtomic、node:child_process、node:http），不引入任何第三方开源库（无合适库：方案是本项目业务模块的独立化重构，不构成可复用的通用库场景；引入成本高于自研）。未引入开源库，不创建 licenses.md。

实施拆分（2026-09-16，人工确认边界后）：

- **存储** `scripts/lib/build-publish-store.mjs`：全局配置（`~/.agent-team-board/build-publish.json`，`ATB_BUILD_PUBLISH_CONFIG` 可覆盖；homepageRepoRoot + revision 递增）与独立运行存储（项目 dataDir 下 `builds/publish-runs/BPUB-<uuid>/run.json`，按项目隔离）。`validateRepo` 校验绝对路径、可访问、Git 仓库根、main 分支；保存失败不覆盖旧有效值。`directoryInfo` 按运行快照给目录可用性与原因（生成中 / 未生成 / 读取失败 / 未记录）。
- **执行器** `scripts/lib/build-publish.mjs`：五阶段（sync-source / webapp-build / webapp-verify / site-deploy / site-verify）只读预检 + 计划 token（输入指纹）确认后才执行；main/dev 原子推送 + 远端 SHA 回验、冻结源码 worktree 构建、本机静态服务回验（Web App 版本、官网双语页面与站内链接）、官网产品目录材料核验；同项目同时仅一个活动发布（active Map + status 双保险）；`openDirectory` 仅打开运行快照目录（macOS `/usr/bin/open -a Finder`，注入式便于测试）；服务重启 recover 将滞留 running/prechecking 落为 failed 待重试。
- **API** `scripts/lib/build-publish-api.mjs` + server.mjs 路由 `/api/build-publish/*`（config GET/POST、state、from-build、run/:id（GET/plan/precheck/refreeze/start/retry/cancel/open））；不调用、不依赖旧 `/api/product-release/*` 与旧执行器/存储；旧模块本身不删（独立 ≠ 删除授权）。
- **前端构建发布页** `scripts/web/build.js`：发布页签切换到 `/api/build-publish/*`；操作区常驻「发布」主按钮（缺配置 / 未预检 / 执行中 / 已发布各有禁用原因，plan 弹窗「确认发布」携 token 启动，取消不执行）；「创建并预检」创建后自动预检一次；结果下方「发布目录」区并列展示构建物目录 / 官网目录（完整路径可选中复制、注明官网仓库根目录），各自独立「在 Finder 中打开」按钮（防重复、失败留原因可重试）；迟到响应以 seq 防串。failed 重试入口改经计划确认（不再直发 retry）。
- **设置模块** `scripts/web/app.js`：新增「官网仓库」全局共享配置区（回显 / 保存校验反馈 / 失败保留输入与旧值）；「前往设置」事件携带来源项目与版本，「返回发布」回到原版本发布页签。

## 风险与边界

- 工作区干净判定必须用 `--untracked-files=all`：`normal` 会把看板数据目录折叠成 `?? docs/` 导致运行记录被误判为脏（本单测试跑红后修复，注释见 build-publish.mjs clean()）。
- 官网配置全局共享：revision 变化使各项目旧预检指纹失效（inputs 含 homepage.revision），须重新预检；已生成的运行目录快照不随设置变更。
- 历史不迁移：旧 `/api/product-release/*` 运行记录不进新模块列表；新模块从自身首次运行起记录（人工 2026-09-16 确认）。
- Finder 真机行为（`/usr/bin/open -a Finder`）在单测中为注入 mock，真实打开效果留待人工验收；非 darwin 平台明确报「Finder 仅在 macOS 本机可用」。

## 本轮核对（2026-09-16）

先前只读核对提出的两个问题见 `../../dispatch/runs/run-20260916-266/blocker.md`。该历史记录中的“复用后端、项目级配置”仅为当时建议，已被下述人工决策替代。未改业务代码、未运行测试或真实发布。

## 人工确认后的方案边界（2026-09-16）

1. 构建模块独立拥有发布 UI、后端 API、执行器及运行存储。新流程不得调用旧 `/api/product-release/*`、依赖旧发布执行器或读写其运行存储；具体新接口和存储命名由实施时确定。独立不等于授权删除其他旧功能，删除范围须以实际依赖核对为准。
2. 旧发布尚未正式使用，无历史迁移、旧接口兼容或旧存储读取要求。新模块从自身首次运行起按项目、版本、运行保存结果及目录快照；原 README 的历史展示要求适用于这些新记录。
3. 官网仓库根目录存于服务管理的全局配置作用域，不再使用项目级发布模块配置。所有项目设置页回显同一值，并明确标注“所有项目全局共享”；无旧配置，不设计迁移或旧配置回退。
4. 保存时验证绝对路径、可访问目录、Git 仓库及 main 分支；失败保留输入和原有效值。全局配置变更令各项目基于旧配置的预检失效，执行前核对配置版本，重新预检及人工确认后才能启动。已生成的运行目录快照不随设置变更。
5. 保留当前版本上下文、双发布目标、冻结范围、真实执行证据、发布主按钮、目录展示及 Finder 打开全部要求。新运行存储按项目隔离，即使官网根目录共享也不能串运行、版本或结果。

## 确认与实施的区分

上述为用户明确确认的实施边界。本轮仅文档落盘，没有修改条目机器状态、接受需求、确认完成、自动复工、提交或推送；原阻塞回执保留历史真实性。后续实施通过现有人工复工/批次核对机制处理。真实 Finder 集成、现场版本、引入来源等未被本次决策覆盖的待核实事项仍保留。

## 实施与测试记录（2026-09-16，/dev 手动轮）

- 实施主体为认领（zcode-batch-0916-02，2026-09-15 17:01 快照）后落盘的独立模块三件（store / 执行器 / api）+ server 路由 + build.js / app.js 前端改造；本轮 `/dev BUG-20260916-001`（人工授权继续实施）完成调试收口。
- **TDD 跑红**：`scripts/tests/build-publish-20260916-001.test.mjs` 首跑在「真实临时 Git 双目标执行」用例失败——预检「工作区」检查用 `--untracked-files=normal`，git 把看板运行记录目录折叠为 `?? docs/`，`docs/` 不匹配排除前缀 `docs/agent-team-board/` 被误判脏。修复：`clean()` 改 `--untracked-files=all` 展开完整路径后排除（与 BUG-20260915-013 同族误判，模式不同）。
- **回归适配**（均为本单改动直接导致，断言迁移而非行为回退）：
  - `i18n-coverage`：设置区与官网配置 10 条新文案补入 `scripts/web/i18n.js` EN / EN_DYNAMIC；
  - `settings-runparams-removed-20260909-011`：官网仓库分区按项目惯例改用 `cx-config homepage` 语义 class（裸 `cx-config` 正则保持原意）；
  - `commit-rollback-20260911-006` E1：设置页分区数 2 → 3（官网仓库 + 批量任务 + Git 工作流）；
  - `bug-release-tab-inplace-20260915-014`：整套 mock 迁移至 `/api/build-publish/*`（logs 形状对齐数组）；failed「重试失败阶段」断言更新为经计划确认入口（不再直发 retry）；「确认启动发布」→「确认发布」；
  - `product-release-ui` H1：断言创建发布走独立 `from-build` 且 build.js 不再调用旧产品发布 API。
- **测试结果**：`node scripts/tests/build-publish-20260916-001.test.mjs` 5/5 通过（含真实临时 Git 双目标执行、计划确认 token、防重复、全局配置失效、目录快照与 Finder 注入）；`npm test` 全量 260 个测试文件全部通过。
- 未运行真实发布、未推送、未部署；真实 Finder 打开效果留待人工验收（README 验收第 3 条）。
