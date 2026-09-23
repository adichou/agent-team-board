中文 | [English](./README.en.md)

# Agent Team Board（智能体团队看板）

ZCode 插件：需求 / Bug 的文件化管理 + Agent TDD 开发流程 + 本地网页看板（Status Board）。

本仓库是插件源码仓库（开发分支 `dev`，发布主干 `main`）：插件以 git 克隆形式装入 ZCode 插件缓存后加载生效（缓存副本的 remote 即本仓库的 GitHub 地址）。面向最终用户的安装说明与使用文档规划于官网（见「官网 / 用户文档 / 支持」，尚未发布）。

> Agent 开发本产品前先读根 [AGENTS.md](./AGENTS.md)（流程硬约束与收口规则）；用本产品管理其他项目任务时读 [skills/agent-team-board/SKILL.md](skills/agent-team-board/SKILL.md)。

## 文档与版本

- 当前版本：**20260920-001 全功能基线版：需求看板 · AI 分析和开发 · 版本发布**（版本计划 BLD-20260920-001，2026-09-20）。
- 版本变化：[CHANGELOG.md](./CHANGELOG.md)；功能清单：[FEATURES.md](./FEATURES.md)；开发协作规则：[AGENTS.md](./AGENTS.md)。
- 英文对照：[README.en.md](./README.en.md) / [CHANGELOG.en.md](./CHANGELOG.en.md) / [FEATURES.en.md](./FEATURES.en.md) / [AGENTS.en.md](./AGENTS.en.md)。

## 三栏协作体系

| 栏 | 载体 | 本插件职责 |
| -- | ---- | ---------- |
| Project Board | ZCode 自带项目/会话列表 | 不改 UI，靠「文件为事实源」+ skill 调度规则 |
| Discussion Board | 聊天窗口 + 命令 | `/req` `/bug` `/dev` `/board` 四个命令（commands/）+ skill 行为规范 |
| Status Board | 插件起的本地网页 | 零依赖 Node http 服务（scripts/server.mjs，默认端口 8888），单服务多项目 |

### 状态机与人机分工

状态单向流转，**accepted / planned / done 仅限人工**，由 PreToolUse 钩子确定性拦截 Agent 越权（scripts/state-guard.mjs）：

```
submitted ──人工──▶ accepted ──人工──▶ planned ──Agent claim──▶ in-progress ──人工──▶ done
   ▲                                    │                          │
   └──────────────── 不存在此路径 ───────┼──────────────────────────┘
                                        │            done ──人工驳回──▶ in-progress
                                        └──人工移出计划──▶ accepted（回退边）
```

认领后开发上报（`atb report`）条目呈「待测试」；实施受阻可声明「待人工决策」（条目保持 in-progress，等人工作答后复工）。

| 操作 | Agent | 人工 |
| ---- | ----- | ---- |
| 创建需求 / Bug（→ submitted） | ✅ `/req` `/bug` | ✅ 看板表单 |
| 接受（→ accepted） | ⛔ 钩子拦截 | ✅ 看板 / 终端 |
| 置计划 / 移出计划（accepted ↔ planned） | ⛔ 钩子拦截 | ✅ 看板 |
| 认领（→ in-progress，原子锁） | ✅ `atb claim` | — |
| 上报测试报告（呈「待测试」） | ✅ `atb report` | 查看 |
| 收口提交（report 后自动 commit 到 dev） | 系统 | — |
| 确认完成（→ done）/ 驳回完成 | ⛔ 钩子拦截 | ✅ 看板 / 终端 |
| 待人工决策作答 / 复工 | ⛔ 钩子拦截 | ✅ 看板「待人工确认」 |

人工入口：Status Board 按钮，或终端 `node scripts/atb.mjs status <ID> accepted|done`；`node scripts/atb.mjs cli install` 可装出 `atb` 短命令（bin/atb）。

## 目录与模块职责

```
agent-team-board/
├── .zcode-plugin/plugin.json     # ZCode manifest（displayName：智能体团队看板）
├── .codex-plugin/plugin.json     # Codex 兼容 manifest（仅 skills；Codex 无命令/钩子）
├── AGENTS.md                     # 开发本产品的仓库规则（Agent 必读）
├── AGENTS.en.md                  # 上述规则的英文对照版
├── README.md                     # 本文件：项目入口与模块地图（中文版，顶部可切 English）
├── README.en.md                  # 英文对照版 README（章节与中文版一一对应）
├── CHANGELOG.md / CHANGELOG.en.md   # 版本更新日志（中英对照，版本级归纳）
├── FEATURES.md / FEATURES.en.md     # 版本功能特性清单（中英对照）
├── index.html                    # 仓库根产品落地页：自包含单文件介绍页（含 Status Board 启动与 Electron 说明，REQ-20260916-002）；区别于 scripts/web/index.html（看板前端骨架）
├── skills/agent-team-board/SKILL.md   # 「使用本产品管理任务」的行为规范
├── commands/{req,bug,dev,board}.md    # 四个斜杠命令提示词
├── hooks/hooks.json              # PreToolUse 状态守卫（Edit|Write / Bash → scripts/state-guard.mjs）
├── hooks/codex.json              # Codex 侧钩子配置
├── bin/atb                       # 终端命令包装器（cli install 符号链接到 PATH）
├── electron/                     # 桌面壳：main.mjs 主进程 / service.mjs server 子进程 / shell-css.mjs 壳层样式
├── scripts/
│   ├── atb.mjs                   # CLI 入口
│   ├── server.mjs                # Status Board 服务（默认 8888，ATB_PORT 覆盖）
│   ├── state-guard.mjs           # 钩子脚本（状态守卫 + 认领锁源码守卫）
│   ├── lib/                      # 数据层与业务模块（见下表）
│   ├── web/                      # 看板前端（单页多视图，见下表）
│   └── tests/                    # 测试：run-all.mjs 聚合入口 + *.test.mjs 用例
├── agent-team-board/
│   ├── data/                     # 看板用户数据（进 git）：requirements/、bugs/ 条目文档（README/design/test-cases/test-report/licenses/ui-demo/attachments/decisions）
│   └── runtime/                  # 看板应用数据（不进 git，本地留存）：status/ 条目状态、config.json 计数器、.locks/、dispatch/、refine/、commits/、holds/、confirms/、builds/、releases/、tasks/、marketing/、oncall/、discussions/ 等
└── output/                       # 品牌素材（logo 等）
```

### scripts/lib 模块分组

| 分组 | 模块 | 职责 |
| ---- | ---- | ---- |
| 核心数据层 | core.mjs | 状态机、编号、O_EXCL 原子认领锁；CLI 与 server 共用的事实源访问层 |
| | git-flow.mjs、manual-closeout.mjs、commit-store.mjs | dev 分支工作流；report 后按认领快照自动收口提交；提交规范校验与提交索引（确认完成不再触发管理记录提交，BUG-20260918-002 下线） |
| 批量与派发 | batch.mjs、dispatch-store.mjs、dispatch.mjs、scheduler.mjs、execution-verifier.mjs | 批量开发批次与执行账本、run 账本、派发构造纯函数、Codex 后台自动派发调度、完成证据核对 |
| | codex-adapter.mjs、codex-preflight.mjs、codex-model-config.mjs、task-settings.mjs | codex exec 进程适配、派发前静态检查、模型/推理档位配置解析、任务类型×Agent 四路子代理配置 |
| | refine-store.mjs、refine-states.mjs、hold-store.mjs、hold-states.mjs、confirm-store.mjs、confirm-states.mjs | 批量完善三态索引；待人工决策三段闭环；自动提交不完整 / AI 分析挂起确认 |
| 构建模块 | build-store.mjs、build-git.mjs | BLD 版本事实源与版本状态机（draft→merging→merged/failed）；受限 git 操作（分支浏览/同步/合并入 main） |
| | build-publish.mjs、build-publish-store.mjs、build-publish-api.mjs | 构建发布执行器与独立事实源（BUG-20260916-001 起与旧发布模块解耦） |
| 发布模块 | release-store.mjs、release-git.mjs、release-apple.mjs、release-electron.mjs | REL 发布运行事实源；Git 远端七阶段 / Apple App Store 八阶段 / Electron 桌面五阶段流水线 |
| | product-release-pipeline.mjs、product-release-store.mjs、product-release-git.mjs、site-materials.mjs、site-lang.mjs、webapp-profile.mjs | PREL 产品发布六阶段（源码同步→官网构建→核验→材料→部署→回验）；官网双语材料、语言选择、Web App 识别与本机部署 |
| 其他业务 | marketing-store.mjs、growth-store.mjs、oncall-store.mjs、req-disc-store.mjs、legacy-recovery.mjs | 营销档案与定价版本、增长工作流、开放式讨论、需求文档引用讨论、历史运行处理证据存档 |
| | migrate-layout.mjs、plugin-pack.mjs | 旧数据布局一键迁移（`atb migrate`：docs/agent-team-board/ → agent-team-board/{data,runtime}，CLI 与看板设置页双入口）；插件分发打包（`atb pack`：整仓拷贝、排除看板数据 / 桌面构建链等，含产物自校验，REQ-20260916-007） |

### scripts/web 界面

| 文件 | 职责 |
| ---- | ---- |
| index.html、app.js | 看板骨架：2 秒轮询 /api/board；顶栏页签 需求（status）/ 构建（build）/ 任务（runs）/ 设置（settings）；发布（release）/ 营销（marketing）/ 讨论（oncall）/ 文件（files）为深链视图 |
| build.js、release.js、marketing.js、oncall.js、req-disc.js | 构建、发布、营销、开放式讨论、需求文档引用讨论各模块界面 |
| i18n.js | 中英文国际化：集中词典（中文原文为键）+ 运行时 DOM 翻译层 |
| banner.js、splitter.js、diff-view.js | File Board 横幅层栈状态机（纯函数）、分栏拖拽、文件差异视图 |
| style.css、wunderbaum.css、highlight-github.min.css、highlight-github-dark.min.css、marked.min.js、highlight.min.js、wunderbaum.umd.min.js 等 | 界面样式、树表与代码高亮资源 + vendored 第三方库（引入与更新按 REQ-20260909-015 在对应条目 licenses.md 登记） |

## 环境与运行方式

以下命令均在本仓库实测核对（2026-09-19，Node v17.8.0）：

- **Node**：运行时零 npm 依赖（dependencies 为空，devDependencies 仅 electron / electron-builder）；仓库未声明 engines 下限，当前开发验证环境为 Node v17.8.0。
- **测试**：`npm test`（= `node scripts/tests/run-all.mjs`）顺序执行 scripts/tests/ 全部 `*.test.mjs`（当前 278 个测试文件，2026-09-19 实测），任一失败即非零退出；单个文件直接 `node scripts/tests/<name>.test.mjs`。
- **产品落地页**：浏览器直接打开仓库根 `index.html`——自包含单文件产品介绍页（REQ-20260916-002，含 Status Board 启动步骤与 Electron 桌面说明）；与 `scripts/web/index.html`（看板前端骨架，由 server.mjs 服务）是两个不同文件，注意区分。
- **Status Board**：`node scripts/server.mjs`（默认端口 8888，环境变量 `ATB_PORT` 覆盖；单服务多项目，`?project=<项目根绝对路径>` 切换数据源）。桌面壳 `npm run app` 会自动拉起同一服务。
- **桌面壳**：`npm run app`（`electron .`，主进程 electron/main.mjs 以子进程拉起 server 并加载看板页）；打包 `npm run dist`（electron-builder，macOS dmg / Windows nsis，产物在 dist/）。
- **CLI**：`node scripts/atb.mjs <子命令>`；`node scripts/atb.mjs cli install` 把 bin/atb 符号链接进 PATH，之后终端直接敲 `atb …`。
- **插件打包**：`node scripts/atb.mjs pack <输出目录>` 生成分发产物（排除 agent-team-board/ 看板数据、根 AGENTS.md、node_modules/、electron/、output/；skills 完整随包，REQ-20260916-007）。

## 关键机制索引

- **认领锁与源码守卫**：core.mjs 用 O_EXCL 原子锁实现认领（runtime/.locks/，24 小时过期）与项目实施互斥；hooks/hooks.json 两条 PreToolUse 守卫 → state-guard.mjs：拦直写 runtime/status 条目状态、拦人工专属状态、无有效认领锁时拦改插件源码（REQ-20260901-003）。根 `README.md` 例外（REQ-20260918-002）：用户与 Agent 无需认领锁即可直接更新，并可经 Bash 提交仅含该文件、主题带条目编号且符合提交规范的改动。
- **report 自动收口提交**：`atb report` 后由 git-flow.mjs + manual-closeout.mjs 按认领时工作区快照归因，自动把本单代码 / 测试 / 文档提交到 dev（只 commit 不 push）；批量 run receipt 同口径（REQ-20260911-009、BUG-20260915-007）。
- **批量任务**：批量开发（从 planned 队列取单，主会话每轮派一个子 Agent，worker 规范见 skills/agent-team-board/worker-spec.md，批次创建时快照到 agent-team-board/runtime/dispatch/）、批量完善（accepted 单补文档）、待人工决策（hold）与挂起确认（confirm）闭环；总览见 skills/agent-team-board/batch-execution.md。
- **构建版本与发布流水线**：构建模块管理 BLD 版本（build-store.mjs 版本状态机，build-git.mjs 合并入 main）；构建发布独立执行（build-publish.mjs 等，BUG-20260916-001），官网目标已适配 Vite + Vue 新架构（REQ-20260916-004）——`src/data/apps.js` 产品注册与 `content/<产品id>/` 双语成对材料预检（productIds 覆盖映射可在设置中配置）、site-deploy 在官网仓库执行 `npm install` + `npm run build`（产物以 dist/ 为准）、site-verify 本机静态服务做 SPA 回退与 zh/en 镜像路由校验、子路径 base 从官网 vite 配置解析；发布模块三条 REL 流水线（release-git.mjs / release-apple.mjs / release-electron.mjs）；产品发布 PREL 六阶段打通源码与官网（product-release-pipeline.mjs + site-materials.mjs / site-lang.mjs / webapp-profile.mjs）。
- **中英文资源**：界面文案集中在 scripts/web/i18n.js（中文原文为键，静态精确 EN + 动态 EN_DYNAMIC 插值），改文案必须同步两语言（BUG-20260912-001）。

## 官网 / 用户文档 / 支持

按 REQ-20260915-001 四仓库规范，官网、安装与用户文档、FAQ、公开更新日志与支持入口规划在官网仓库 app-homepage-repo（复用 myblog 站点架构：Vite + Vue，GitHub Pages 子路径部署）。仓库内 [CHANGELOG.md](./CHANGELOG.md) / [FEATURES.md](./FEATURES.md) 是版本级事实源，官网公开页上线后由其同步。

**截至 2026-09-16 尚未部署上线**：本节先登记待发布状态，不提供未核验链接；上线后回填官网地址、用户文档入口与支持入口并逐条核验。私有运营资料（定位、调研、推广）在独立私有仓库维护，不进入本仓库。

## 按任务类型导航

| 要改什么 | 看哪里 |
| ---- | ---- |
| CLI / 状态机 / 数据层 | scripts/atb.mjs、scripts/lib/core.mjs 及对应 *-store.mjs；测试在 scripts/tests/ |
| 看板界面 | scripts/web/（骨架 app.js；模块页 build.js / release.js / marketing.js / oncall.js；文案改 i18n.js 并同步中英） |
| 批量任务与派发 | scripts/lib/batch.mjs、dispatch-store.mjs、scheduler.mjs、codex-adapter.mjs 等；规范见 skills/agent-team-board/batch-execution.md 与 worker-spec.md |
| 构建与发布 | scripts/lib/build-*.mjs（构建）、release-*.mjs（REL 流水线）、product-release-*.mjs（产品发布）；界面 build.js / release.js |
| 桌面壳 | electron/ |
| 钩子与守卫 | hooks/hooks.json、scripts/state-guard.mjs |
| 项目入口文档（中英双语） | 根 README.md（中文）与 README.en.md（English），顶部互链切换、章节一一对应，改一方须同步另一方 |
| 版本发布文档（中英成对） | 根 CHANGELOG.md / CHANGELOG.en.md（版本变化）、FEATURES.md / FEATURES.en.md（功能清单）；版本范围以构建模块版本计划（BLD）为准，改一方须同步另一方 |
| 开发流程与规则 | 根 AGENTS.md（开发本产品必读）→ skills/agent-team-board/SKILL.md（使用产品管理任务）→ commands/ |

## 使用与初始化（开发视角）

新项目接入看板：项目内任一会话执行 `node scripts/atb.mjs init`（或看板网页点「初始化」），生成 `agent-team-board/` 事实源目录（`data/` 用户数据进 git、`runtime/` 应用数据本地留存；结构见 agent-team-board/runtime/README.md 与 skills/agent-team-board/SKILL.md 数据规范节）。旧布局（docs/agent-team-board/）项目用 `atb migrate` 或看板设置页「数据布局迁移」一键迁移。日常 `/req` `/bug` `/dev` `/board` 用法与状态机细则见 skills/agent-team-board/SKILL.md；人工操作（接受 / 置计划 / 确认完成）入口在 Status Board 或 `atb status` 命令。
