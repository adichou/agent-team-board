# 设计 — REQ-20260916-007 用户数据和应用数据要分离，commit 只需提交用户数据，应用数据不用 commit

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

旧布局 `docs/agent-team-board/` 单目录混放用户数据（条目文档）与应用数据（status.json、
计数器、各模块 settings/账本），靠目录内 `.gitignore` 逐文件忽略；326 个 `status.json`、
`config.json`、模块 settings 长期被 git 跟踪，日常运行后工作区大量脏文件。README 已由人工
确认重构方案（2026-09-17）：项目根新建 `agent-team-board/`，`data/`（用户数据，进 git）与
`runtime/`（应用数据，整目录忽略）物理分离；本项目仅支持单设备运行。

## 方案

### 1. 目录布局与定位（core.mjs）

- 常量：`BOARD_REL_DIR = 'agent-team-board'`（板根，相对项目根）；`dataDirFrom(cwd)` 语义改为
  「向上查找板根」——存在 `<dir>/agent-team-board/data` 或 `<dir>/agent-team-board/runtime` 即命中，
  返回 `<dir>/agent-team-board`。兼容导出 `DATA_REL_DIR = BOARD_REL_DIR`（错误提示与
  server `wouldWrite` 沿用该常量，口径 = 板根）。
- 用户数据根：`<板根>/data/`，其下 `requirements/<ID>/`、`bugs/<ID>/`、
  `requirements/<REQ>/bugs/<BUG>/`（存量归属 Bug，结构不变）。
- 应用数据根：`<板根>/runtime/`，收纳原 `docs/agent-team-board/` 下全部运行数据：
  `status/`、`.locks/`、`config.json`、`dispatch/`、`refine/`、`commits/`、`confirms/`、
  `holds/`、`oncall/`、`builds/`、`releases/`、`tasks/`、`discussions/`、`marketing/`、
  `test-runs/`、`test-audits/`、`README.md`（模板产物）及全部 `settings.json`/`policies.json`/
  `dispatches.json`/账本。新增共享辅助 `runtimePath(board, ...segs)`、`itemsRoot(board)`、
  `projectRootOfBoard(board)`（= 板根上一级）。
- `initData(cwd)`：`ensureDevWorkflow` 后创建 `data/{requirements,bugs}` 与
  `runtime/{status,.locks}`，`config.json` 落 runtime；**根** `.gitignore` 幂等追加
  `agent-team-board/runtime/` 一条；`DATA_README` 模板重写后落 `runtime/README.md`。
  不再创建 `docs/agent-team-board/`，不再维护板内 `.gitignore`。

### 2. status.json 迁出条目目录（runtime/status/）

- 新位置：`runtime/status/<ID>.json`（单文件一单；REQ/BUG 编号全局唯一，平铺即定位）。
- `readStatus(dir)` / `writeStatus(dir, st)` **保持（条目目录）签名不变**（35 处外部调用零改动）：
  以条目目录 basename 为 ID，向上有界查找含 `runtime` 子目录的祖先定板根，状态文件取
  `runtime/status/<ID>.json`。`createItem` 不再向条目目录写 status.json；`deleteItem` 删除
  条目目录同时删除对应状态文件。

### 3. 各 store 路径改造（机械迁移）

- 全部 `path.join(dataDir, '<runtime 段>')`（.locks/dispatch/refine/confirms/commits/
  releases/holds/config.json/builds/tasks/oncall/marketing/discussions/README.md/.gitignore）
  统一改插 `'runtime'` 段；`requirements|bugs` 改插 `'data'` 段；`path.resolve(dataDir,'..','..')`
  11 处改 `projectRootOfBoard(dataDir)`。atb.mjs / server.mjs / state-guard.mjs 同步。

### 4. 忽略规则极简化

- 唯一忽略规则：项目根 `.gitignore` 的 `agent-team-board/runtime/`（initData / 迁移 /
  运行期账本写入前幂等补齐，收敛为 `ensureRuntimeIgnore`）。旧逐文件规则（`.locks/`、
  `dispatch/runs/`、`commits/mgt/`、`confirms/` 等）全部废弃：`ensureLedgerIgnore`
  （git-flow / mgt-commit）改为调用 `ensureRuntimeIgnore`，板内 `.gitignore` 不再产生。

### 5. 自动收口归因同步（git-flow.mjs）

- doc 组前缀：新 `agent-team-board/`（板根前缀，实际脏路径只会来自 `data/`，runtime 已忽略）
  ＋过渡期旧前缀 `docs/agent-team-board/`（存量迁移产生的删除/搬移）。
- `owningItemIdOf` 按新口径：`agent-team-board/data/(requirements|bugs)/<ID>/...` 归属该单；
  旧前缀下仅「非 status.json 的 requirements|bugs 文档」归属该单（旧 status.json 删除属
  应用数据下线，归板级共享）；porcelain 重命名（R 码，`git mv` 搬迁）一律视为板级共享
  doc 组（纯位置搬移不按单排除），保障迁移提交完整成对入库（`--follow` 历史可循）。
- mgt-commit（REQ-20260914-007 整改）：`itemMgtFiles` 仅 `confirmations.md`、`decisions.md`
  （status.json 已迁 runtime 且被忽略，不再提交）；`versionMgtFile` 与
  `commitVersionMergeMgmt` 整体下线（版本计划账本属应用数据，本地留存，「同内容双分支
  提交」废弃；build-git 调用点与 'version' 重试入口移除）；账本 `runtime/commits/mgt/`，
  忽略行簿记（pendingIgnoreExtra）随整目录忽略失去意义，一并移除。

### 6. 守卫（state-guard.mjs）定位新目录

- 认领锁目录：向上找 `<dir>/agent-team-board/runtime/.locks`（新布局唯一口径）。
- file 模式：拦截直写 `agent-team-board/runtime/status/**.json`（机器状态文件）；旧
  `docs/agent-team-board/**/status.json` 规则随布局下线移除（迁移由 migrate 子命令承接）。
- bash 模式：改写意图命中 `agent-team-board/runtime/status/<ID>.json`（路径形态）即拦；
  流程外 commit 的「看板项目」判定（boardDirOf）与源码豁免同步新板根。

### 7. 存量迁移与一键迁移（migrate-layout.mjs）

- 入口：CLI `atb migrate [--dir <项目根>]`；Status Board 设置页「数据布局」分区
  （GET `/api/layout/state` 只读探测 + POST `/api/migrate` 执行，均不依赖 dataDir 已初始化）。
- 算法（幂等、可重试、失败如实报告不损坏数据）：
  1. 定位 `<root>/docs/agent-team-board`；不存在且新板根存在 → 「已是新布局」no-op 成功。
  2. 逐条目（requirements/bugs，含嵌套 bugs）：文档类文件逐个 `git mv`（已跟踪，保留历史；
     未跟踪则移动文件）至 `agent-team-board/data/...`；`status.json` 若被跟踪先
     `git rm --cached`，文件移至 `runtime/status/<ID>.json`。
  3. 其余目录/文件（应用数据，含 `.locks`、`dispatch`、`config.json`、模块 settings、
     `README.md`、`batch-execution.md` 源等）整体移入 `runtime/`；其中被跟踪者先
     `git rm -r --cached`（本地文件保留）。`batch-execution.md` 特例：迁
     `skills/agent-team-board/batch-execution.md` 并按整理口径重写（人工确认的用户数据）。
  4. 根 `.gitignore` 追加 `agent-team-board/runtime/`；对旧目录残留被跟踪文件做
     `git rm -r --cached --ignore-unmatch docs/agent-team-board` 兜底；移除空旧目录
     （`docs/` 为空则一并移除）。
  5. 核验：迁移前后条目清单（ID、状态、标题）一致，不一致即报错回执（不静默）。
- 迁移不自动 commit：变更留在工作区/索引，随本条目 report 收口提交（doc 组新口径收纳）。

### 8. 打包分发（plugin-pack.mjs，`atb pack <outDir>`）

- 以插件根为源整仓拷贝（维持现有口径），排除：项目根 `agent-team-board/`（data 与 runtime
  均不进包）、根 `AGENTS.md`、`node_modules/`、`electron/`、`output/`，另排除 `.git/`、
  `dist/`、`*.log`；`skills/` 完整随包。产物自校验不含被排除路径。

### 9. 文档与界面同步

- SKILL.md 数据规范节按新布局重写（含目录树示意图、单设备约束）；根 AGENTS.md、根
  README.md、`docs 地图`、worker-spec 引用、web（banner DEFAULT_PATH、app.js 文档链接
  `<root>/agent-team-board/...`、req-disc docRefPath、index.html 文案）与 i18n.js 中英文同步；
  `docs/agent-team-board/batch-execution.md` 迁 `skills/agent-team-board/` 并重写。

## 开源选型（REQ-20260909-015）

未引入开源库：本单为自有 Node 脚本的目录布局重构与数据搬移，无第三方库可替代
（自研理由：无合适库——搬移逻辑与本仓库 git-flow/账本强耦合）。

## 风险与边界

- **迁移期间的中断**：分步幂等设计，重跑 `atb migrate` 从现状续迁（git mv / rm --cached
  对已完成步骤天然 no-op），失败如实报错；不触碰用户项目源码。
- **旧项目升级**：新代码不再识别 `docs/agent-team-board`（除 migrate 入口），旧项目首次
  升级后须先迁移（设置页开关 / CLI），未迁移时明确报错指引，不误提交其应用数据。
- **单设备约束**：`runtime/` 不跨设备同步，条目状态与单号计数器以本地文件为准；多设备
  使用不在支持范围（README/SKILL 明示）。
- **守卫窗口**：新守卫只认新布局；本仓库迁移由本单一次性完成，窗口内不接受旧路径直写。
