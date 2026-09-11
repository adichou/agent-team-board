# REQ-20260911-002 营销和发布模块隐藏

- 状态：accepted（已接受；实际状态以 status.json 为准）
- 创建：2026-09-11T04:13:29.279Z

## 描述

本项是**暂态隐藏，不是功能删除**：参照 REQ-20260909-013（讨论 / 文件模块暂隐藏）的既有口径，仅让「营销」「发布」两个模块在界面上不可见、不可达；营销档案、渠道 / 实验 / 行动、指标 / 复盘、发布运行等数据与全部服务端接口保留不动，并要求以低成本可恢复的方式实现（具体手段由开发阶段 design.md 定稿）。

### 范围与现有依据（均已在代码核实）

- 顶栏模块导航现状为「需求 / 任务 / 营销 / 发布 / 设置」（`scripts/web/index.html` 33–37 行，`data-view` 依次为 `status` / `runs` / `marketing` / `release` / `settings`；「讨论」「文件」已由 REQ-20260909-013 暂隐藏）。本项只隐藏「营销」「发布」两个入口，导航收敛为「需求 / 任务 / 设置」。
- 营销模块（REQ-20260910-019 及营销规划系列 020 / 021 / 022 等）：`#marketingView` 容器 + `scripts/web/marketing.js`（`window.ATBMarketing`，四页签：概览 / 定位与定价 / 渠道与行动 / 效果与复盘；`enter` 幂等拉取；未初始化时给「初始化营销档案」空态引导）。服务端 `server.mjs` 保留 `/api/marketing/*` 全套路由（state / init / profile / pricing / board / channel / experiment / activity / effect / metric / observation / import / review / growth 等）；数据落 `docs/agent-team-board/marketing/`（profile.json + metrics/ 等）。
- 发布模块（REQ-20260910-029，含 REQ-20260910-030 桌面应用目标）：`#releaseView` 容器 + `scripts/web/release.js`（`window.ATBRelease`，运行列表 + 运行详情四页签：概览 / 阶段日志 / 产物 / 操作历史；目标为 Git 远端 / Apple App Store / 桌面应用（Electron）；进入模块后按 `pollTimer` 轮询）。服务端保留 `/api/release/*` 路由（state / targets / run、run/save、run/precheck、run/start、run/retry、run/cancel、run/refresh、sku 等）；数据落 `docs/agent-team-board/releases/runs`。
- 间接入口盘点（代码核实）：两个模块的常规入口只有顶栏按钮与 URL 深链 / 刷新快照——boot 接受 `?view=marketing` / `?view=release`（`VIEWS` 数组含两项，`app.js` 1062 行），刷新快照 `snap.view` 复用同一 `setView`（`app.js` 7003 行）。全网页源码无 `data-goto-view="marketing"` / `"release"` 跨模块跳转；搜索反馈条在营销 / 发布视图只出现「在需求查看」返回入口；无键盘快捷键切换模块；需求 / Bug 详情抽屉与统一新建弹窗（类型仅 REQ / BUG）均无指向两模块的入口。因此除导航按钮与深链 / 快照兜底外，无其他需收敛的间接入口。
- 隐藏机制先例：`app.js` 1068 行的 `HIDDEN_VIEWS` 集合（现为 `{'oncall','files'}`）——`setView` 内统一兜底：隐藏视图回落需求模块 + 一次性 toast，URL 由 `syncProjectUrl` 重写（view 参数清理、project 等无关参数保留）。本项预期沿同一开关扩展，具体由 design.md 定稿。
- 副标题表现 `MODULE_SUB` 含 `marketing` / `release` 两键（`app.js` 1052–1053 行）；REQ-20260909-013 先例是随入口把 oncall / files 两键移出 `MODULE_SUB`、恢复时再加回。

### 待确认

1. 隐藏动机与恢复时机（与同日登记的 REQ-20260911-003「批量 commit 功能隐藏」是否同属一批界面收敛），待确认；不影响本项验收口径。
2. `MODULE_SUB` 中 `marketing` / `release` 两键是否随入口移出（沿用 oncall / files 先例，恢复时加回），待确认；倾向沿用先例。
3. 营销模块未保存的表单草稿：草稿仅存内存、不进快照（既有边界「表单草稿与未保存内容不进快照」）。若隐藏生效时恰有未保存草稿，同一会话内恢复入口前无法再访问该草稿（刷新本就会丢失，属既有行为）；是否需要在隐藏时给出提示，待确认。
4. 发布模块轮询：`pollTimer` 仅在进入模块后调度（隐藏期间不进入即无轮询、无网络请求）；进行中的发布 run 在隐藏期间没有界面观察渠道（服务端 run 执行不受 UI 隐藏影响），是否接受，待确认。
5. 快照兼容：刷新前停留在营销 / 发布模块的会话快照（`snap.view` 为 marketing / release）在隐藏生效后刷新应经 `setView` 兜底回落需求；恢复隐藏开关后旧快照可直接续用，不要求做快照版本迁移——沿用现状机制即可，口径待确认。

## 验收标准

- [ ] 顶栏模块导航仅隐藏「营销」「发布」两个入口，收敛为「需求 / 任务 / 设置」；剩余入口点击切换正常，当前视图高亮正确，导航行无被隐藏入口的空占位；「设置」仍为行末辅助入口（`nav-extra`）。
- [ ] 地址栏带 `?view=marketing` 或 `?view=release` 打开 / 刷新页面：回落到需求模块，无空白视图、无控制台报错；URL 的 view 参数被清理或改写为有效视图，project 等与模块无关的参数保留；回落有一次一次性提示。
- [ ] 刷新快照兜底：刷新前停留在营销 / 发布模块的会话快照，在隐藏生效后刷新回落需求模块（不得恢复进入隐藏模块）；快照中 marketing / release 子状态（页签 / 选中版本 / 筛选等）不做破坏性清理，恢复隐藏后可继续使用。
- [ ] 隐藏生效后全流程不发出两模块的网络请求：进入模块、轮询、主轮询链路与刷新均不出现 `/api/marketing/*` 与 `/api/release/*`（含 `/api/marketing/state`、`/api/release/state`）。
- [ ] 需求 / 任务 / 设置三模块与既有能力零回归：需求列表 / 详情抽屉 / 统一新建、任务页签、设置视图行为不变；模块搜索在剩余视图中的解释不变。
- [ ] 服务端接口与数据零改动：`server.mjs` 的 `/api/marketing/*` 与 `/api/release/*` 路由全部保留；`docs/agent-team-board/marketing/` 与 `releases/` 目录无删改；`curl` 抽查 `/api/marketing/state`、`/api/release/state` 仍可用（带 project 参数）；`marketing.js` / `release.js` 源文件、`#marketingView` / `#releaseView` 容器与脚本引用保留（仅收敛入口，不删模块代码）。
- [ ] 暂态可逆：以 REQ-20260909-013 的 `HIDDEN_VIEWS` 同一开关扩展（或等价的单一开关）实现；恢复步骤（移除两键 + 还原 index.html 两个导航按钮 + 按「待确认 2」还原 `MODULE_SUB` 两键）记录在 design.md。
- [ ] 既有断言口径随本项同步更新且 `npm test`（`node scripts/tests/run-all.mjs`）全绿——涉及导航口径的测试（现状断言以代码为准）：`workbench-layout.test.mjs` W2 导航顺序断言（现为 `['status','runs','marketing','release','settings']` 与「营销」栏目名断言）、`hide-modules-20260909-013.test.mjs` H1（「营销 / 发布入口保留」断言）、`marketing-ui.test.mjs` 与 `marketing-serve.test.mjs`（index.html 含 `data-view="marketing"` 断言）、`release-ui.test.mjs`（营销 → 发布导航顺序断言）、`layout-topbar-rail-20260910-012.test.mjs`（T3 页签循环含 marketing / release）；若按「待确认 2」移出副标题键，`release-sub-generic-20260911-002.test.mjs` C3 的 MODULE_SUB 断言同步更新。不删除与本项无关的断言。
- [ ] 界面验证：深浅色两种外观下导航行无被隐藏入口的空占位、无残留样式（错位 / 残影）。

## 界面展示

- **布局**：唯一界面收敛点是顶栏模块导航——由「需求 / 任务 / 营销 / 发布 / 设置」收敛为「需求 / 任务 / 设置」，导航行不再出现「营销」「发布」按钮及其空位，「设置」保持行末辅助入口。其余界面（需求工作区、任务、设置、详情抽屉、统一新建）不动。营销（四页签：概览 / 定位与定价 / 渠道与行动 / 效果与复盘）与发布（目标筛选 + 运行列表 + 概览 / 阶段日志 / 产物 / 操作历史）两模块界面整体不可达，但模块源码与容器保留。
- **交互**：导航按钮点击切换模块（目标态仅剩需求 / 任务 / 设置三个入口，点击切换即时生效）；旧深链 / 刷新快照指向 marketing / release 时经 `setView` 兜底回落需求模块；目标态下模拟打开旧链接 `?view=marketing` / `?view=release` 触发一次性提示并清理 URL 的 view 参数（project 参数保留）。
- **状态反馈**：正常态（导航切换即时生效、高亮正确）；回落态（旧深链 / 快照回落需求 + 一次性提示 + URL 重写）；空态（营销档案未初始化空态、发布无运行空态——仅现状场景可达，用于对照）；加载态（发布模块进入时列表加载指示）；失败态（发布列表拉取失败提示与重试，重试恢复列表）；网络面（目标态全流程无 `/api/marketing/*`、`/api/release/*` 请求）。深浅色适配沿用看板 `prefers-color-scheme` 双主题。

可交互演示：[./ui-demo.html](./ui-demo.html)（单文件、无外网依赖、无构建步骤，浏览器直接打开；内置现状 / 目标场景切换、导航与旧深链回落、快照刷新模拟与网络请求对照）。

### 演示核对路径

1. 切换「目标（隐藏后）」：导航仅剩 需求 / 任务 / 设置，无「营销 / 发布」按钮与空位；三入口可正常切换、高亮正确。
2. 目标场景下分别模拟打开 `?view=marketing`、`?view=release` 旧链接：回落需求模块、提示条出现、地址栏 view 参数被清理（project 保留）。
3. 切回「隐藏前」进入营销 / 发布模块：查看营销四页签与未初始化空态（含「初始化营销档案」演示）、发布目标筛选与运行列表的加载 / 失败重试（右侧网络记录显示请求发出）；再切到目标场景，检查自动回落与请求抑制的对照。
4. 点击「模拟刷新（快照恢复）」：现状场景停留在营销 / 发布后切目标再刷新，验证回落需求模块且不发出两模块请求。演示使用虚拟数据与模拟请求，不访问真实服务、不写任何数据。
