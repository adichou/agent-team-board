# 设计 — REQ-20260910-030 在发布模块中支持将 electron app 构建成 mac app 和 Windows app

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

发布模块（REQ-20260910-029）已落地 git / apple 两条可执行流水线与「web / storage 仅扩展枚举」的目标类型表。
本需求新增第三个可执行目标 `electron`（桌面应用），复用既有状态机 / 互斥 / 重试 / 取消 / 中断恢复 / 脱敏日志机制，
用项目既有 devDependency electron-builder 把当前项目构建为 macOS 应用包（dmg）与 Windows 安装包（NSIS exe）。
当前仓库没有任何 electron-builder 构建配置，本需求一并补齐（package.json `build` 字段）。

## 方案

### 1. 数据层（release-store.mjs）

- `TARGET_TYPES` 新增 `{ key: 'electron', label: '桌面应用（Electron）', enabled: true }`（apple 之后、web 之前）；
  `EXECUTABLE_TARGETS` 自动纳入，同目标互斥 / 状态机 / `recoverInterrupted` / `resetForRetry` / `cancelRemaining` 全部复用，零改动。
- 新增 `ELECTRON_STAGES` 五阶段（README 口径）：
  1. `freeze` 配置冻结 — 解析 HEAD 源提交 OID、读项目 package.json（appName=productName||name、projectVersion、main、electron / electron-builder 依赖声明版本），确定生效 version（config 覆盖 > 项目 version）与 platforms / macArch / outDir；
  2. `local-precheck` 本地预检（只读）— Git 仓库且工作区 / 暂存区干净（沿用「看板数据目录豁免」口径）、Electron 工程判定（main 指向文件存在 + devDependencies 含 electron 与 electron-builder）、electron-builder 构建配置就绪（package.json `build` 字段或 electron-builder.{yml,yaml,json,json5,toml}）、node / npm 可用（`node -v` / `npm -v`）；
  3. `deps-install` 依赖安装 — 在冻结提交的隔离 worktree 内执行（有 package-lock.json → `npm ci`，否则 `npm install`），失败不可继续；
  4. `build` 桌面构建 — 同一 worktree 内逐平台执行 `node_modules/.bin/electron-builder --<mac|win> <dmg|nsis> --<arch> -c.extraMetadata.version=<version> -c.directories.output=<项目根下 outDir 绝对路径>`；逐平台记录成败，任一平台失败即阶段失败（不以部分产物冒充成功）；阶段开头复核源提交 OID 未变化（变化 → plan-stale）；
  5. `verify` 产物核验 — 在输出目录按平台期望形态找产物（mac → `.dmg`、win → `.exe`，跳过 `.blockmap` 等伴随文件），逐个记录 路径 / 大小 / SHA-256 / 源提交 OID / electron 与 electron-builder 实际版本（读 worktree `node_modules/{electron,electron-builder}/package.json`），`signed: false`（首期不做签名 / 公证，不伪造签名状态）；全部平台产物齐备才标成功，成功后清理隔离 worktree。
- 配置字段与校验（`validateConfig` electron 分支）：
  - `platforms`：`['mac','win']` 非空子集（去重排序）；
  - `macArch`：`arm64 | x64 | universal`，可空（默认取主机 `process.arch`，arm64 主机即 arm64）；
  - `winArch`：首期固定 `x64`；
  - `version`：可空（默认项目 package.json version）；非空须 `/^\d+(\.\d+){0,2}$/`；
  - `outDir`：默认 `dist`，必须相对路径且不含 `..`（electron-builder 会向该目录写产物，禁止逃出项目根）；
  - `appName`：前端从 `/api/release/targets` 带入的展示名（冻结阶段以 package.json 实际值为准）。
- `stagesFor` / `runLabel` / `summarizeRun` 三分支化：label 为 `应用名 版本 · 平台组合`（mac→macOS、win→Windows，` + ` 连接）。
- 预检口径：`through: 'local-precheck'` 只跑 freeze + 本地预检（均只读，不 npm、不构建），完成回 draft。

### 2. 流水线（release-electron.mjs 新文件）

- 仿 release-git.mjs：`ElectronStageError`（kind 定位失败原因）、`runElectronPipeline({ dataDir, projectRoot, runId, exec, cfg, through, from })` 阶段驱动（阶段前核对取消、逐阶段持久化、失败截断、预检回 draft、全量标 succeeded）。
- 隔离 worktree 生命周期：deps-install 创建（`git worktree add --detach <tmp/atb-release-el-*> <oid>`）并安装依赖，workDir 记入阶段 result 与 `run.frozen`；build 复用；verify 成功后清理（best-effort）。build / verify 失败或取消时保留 worktree——重试只重跑失败阶段（deps-install 已 done 不重装，node_modules 仍在），残留 worktree 交由系统 tmp 清理。
- 版本与命令注入：electron-builder 经 `-c.extraMetadata.version` 覆盖打包版本；输出目录解析为 `<projectRoot>/<outDir>` 绝对路径（产物落用户项目本地，`.gitignore` 已忽略 `dist/`）。
- 交叉构建边界：macOS 主机构建 Windows 产物按 electron-builder 官方能力尽力执行（部分场景可能需要额外工具链）；做不到的组合在 build 阶段以真实报错明确失败并摘录 electron-builder 报错原文，不假成功、不预检硬拦。

### 3. server.mjs 集成

- `kickReleaseRun` 增加 electron 分支；预检 `through: 'local-precheck'`；refresh 对 electron 重跑 verify（产物核验只读）；start / retry / cancel / 互斥 / 409 处理完全复用。
- `/api/release/state` env 增加 `electron` 摘要：packageJson 存在、appName、version、mainOk / depsOk / buildConfigOk / nodeOk / npmOk（前端空态给指引）。
- `/api/release/targets` 增加 `electron`：appName、defaultVersion、默认 macArch、平台与架构可选值（前端新建面板默认值数据源）。

### 4. 前端（release.js / style.css）

- `TARGETS` 同步新增 electron；chip 第三种配色 `.chip.electron`（style.css 取主题变量）。
- 新建面板 electronFields：目标平台多选（macOS / Windows 复选）、macOS 架构 select（默认主机架构）、版本号（默认项目 version）、输出目录（默认 dist）；应用名从 targets 摘要自动并入 config（不给用户填）。
- 计划确认弹层 electron 分支：平台 / 架构 / 版本 / 输出目录 / 冻结源提交 + 「产物未签名（未配置证书）」提示，确认即授权该明确计划。
- 详情「产物」页签 electron 分支：逐产物展示 文件名、平台架构、大小、SHA-256 截断、源提交、electron-builder 版本、未签名标注；无产物时明确说明。
- 预检通过判定 / 启动按钮 gating：electron 以 `local-precheck` done 为准。
- 列表卡片、筛选器、阶段进度（五阶段）、深浅色与 ≤960px 窄屏全部沿用既有实现。

### 5. electron-builder 构建配置（package.json `build` 字段）

```json
"build": {
  "appId": "com.adichou.agent-team-board",
  "productName": "Agent Team Board",
  "directories": { "output": "dist" },
  "files": ["electron/**/*", "scripts/**/*", "package.json"],
  "asarUnpack": ["scripts/**/*"],
  "mac": { "target": ["dmg"], "category": "public.app-category.productivity" },
  "win": { "target": ["nsis"] }
}
```

- `files` 覆盖默认（排除 node_modules：本项目无 runtime dependencies，devDependencies 不进产物）；
- `asarUnpack: scripts/**`：桌面壳以 `ELECTRON_RUN_AS_NODE` 拉起 `scripts/server.mjs`，Node 模式不识别 asar，须落真实文件；
- 产物形态：mac=dmg（应用包）、win=nsis（安装包），与 verify 阶段期望一一对应；架构由运行时 CLI 参数（`--arm64` 等）传入，不写死在配置。

### 6. ui-demo.html（条目目录）

既有演示（需求阶段产物）覆盖了分栏 / 五阶段 / 新建面板基础结构，但缺：平台多选、预检 / 计划确认 / 启动闭环、失败重试 / 取消、同目标互斥提示、空 / 加载 / 加载失败态切换、产物页签未签名标注。本次补全为可交互单文件（内联 CSS/JS、无外部资源）。

## 开源选型（REQ-20260909-015）

不引入新开源库：构建工具复用项目既有 devDependency `electron-builder@^25.1.8`（MIT，白名单内，以 npm 依赖方式引入，无源码复制）。流水线 / 预检 / 核验逻辑为对既有发布模块（自研）的扩展，无合适可直接复用的更高层库，且需求要求与既有流水线语义（冻结 / 互斥 / 重试 / 脱敏）同构，引入成本高于自研。未新增第三方依赖，故不创建 licenses.md。

## 风险与边界

- **macOS 交叉构建 Windows**：electron-builder 在 macOS 上构建 win 目标可能需要额外工具链（如 wine 处理图标），实测为准；失败时以报错原文明确失败，不预检硬拦（README「待确认」项，首期按真实执行结果呈现）。
- **签名 / 公证**：首期一律不签名（产物与界面标注「未签名」，`signed:false` 恒定），不伪造签名状态；Developer ID / 公证 / Windows 证书留待后续需求。
- **依赖安装耗时**：npm ci 需下载 Electron 平台二进制（数百 MB），依赖安装与构建阶段耗时较长只展示进行中状态，不因耗时长判失败；命令级超时沿用模块 `cfg` 口径（构建 30 分钟上限）。
- **产物仅存本地**：输出目录在项目根下（默认 `dist/`，`.gitignore` 已忽略），不自动上传 / 分发到任何渠道。
- **worktree 残留**：失败 / 取消运行的隔离 worktree 保留供重试复用，属 tmp 目录，交由系统清理；成功运行核验后即清理。
