# 设计 — REQ-20260910-029 新增发布模块：Git 远端与 Apple App Store 发布流水线

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板已有六模块（讨论 / 需求 / 任务 / 文件 / 营销 / 设置），无任何发布能力。本需求新增第七模块「发布」，
以可恢复、可追溯的流水线执行两类真实外部操作：Git 远端推送与 Apple App Store 构建发布。发布是实际执行
流程，必须有结构化阶段回执、实际执行证据与外部结果校验，不能以提示词 / 复制命令 / 人工勾选代替执行成功。

## 方案

### 总体形态（对齐既有模块先例）

- 前端：顶栏 `.module-nav` 增「发布」页签（营销 → **发布** → 设置），主视图容器 `#releaseView` 由新文件
  `scripts/web/release.js` 动态渲染（先例：`marketing.js`）；`app.js` 仅做接线（VIEWS / setView 容器切换 /
  enter 激活 / 快照与项目切换重置 / 模块副标题与搜索框隐藏），深链 `?view=release` 沿用既有机制自动生效。
- 界面信息架构：模块内左右分栏——左侧运行列表（目标类型筛选 + 状态筛选），右侧运行详情（头部摘要 →
  阶段进度条 → 概览 / 阶段日志 / 产物 / 操作历史四页签 → 底部操作区）；「+ 新建发布」为模块内独立入口，
  打开右侧侧拉面板（先例：REQ-20260910-014）；窄屏（≤960px）分栏改上下排列，深浅色全部走既有 CSS 变量。
- 后端：零依赖 Node（沿用本项目 http 服务约定），新增三个 lib 模块 + server 路由分流，全部数据落项目
  `docs/agent-team-board/releases/`，随项目进 git（与 requirements/bugs/dispatch 同口径：运行记录与证据
  属于项目文档，可追溯优先；敏感内容一律不落盘，见「脱敏与安全」）。

### 数据模型（scripts/lib/release-store.mjs）

```
<dataDir>/releases/
  config.json            模块配置：protectedBranches（受保护分支列表）、appleRepoPaths（app-info-repo、
                         ASC 凭据目录的本地路径引用）等；损坏报错不静默重建
  sku-map.json           Bundle ID → SKU 映射（Apple 首次收集后持久化复用；含默认值标记）
  runs/REL-YYYYMMDD-NNN/run.json    单次发布运行（冻结配置、阶段状态、证据、操作历史）
  runs/REL-YYYYMMDD-NNN/logs/<stage>.log   阶段日志（时间戳行，脱敏后落盘）
```

- 目标类型：`git`、`apple` 首期可执行；`web`、`storage` 仅保留在类型枚举中（`enabled:false` 扩展位），
  新建面板置灰标注「首期未开放」，store 层拒绝创建非可执行类型。
- 运行状态机：`draft → prechecking → running → waiting-manual | succeeded | failed | canceled`；
  阶段状态：`pending / running / done / failed / skipped`。
- 运行 ID：`REL-YYYYMMDD-NNN`（项目内递增，先例：REQ/BUG 编号）。
- 并发互斥：同项目同目标类型同时只允许一个活动运行（活动 = prechecking / running / waiting-manual）；
  重试 / 取消 / 刷新不受互斥限制，且只操作本运行，不覆盖其他运行状态。
- 服务重启恢复：运行记录全部持久化在 run.json；服务重启后内存无执行器时，读到的 running 阶段标记为
  failed（kind=interrupted，可重试），不自动重跑已开始的阶段；推送阶段被中断的重试先查询远端实际 ref
  再决定动作（见 Git 阶段 7）。

### Git 流水线（scripts/lib/release-git.mjs，七阶段）

配置冻结：remote 名、源分支、目标分支、可选标签、项目校验命令；记录源提交 OID、脱敏远端地址、明确
refspec（`refs/heads/<src>:refs/heads/<tgt>`，标签 `refs/tags/<tag>` 指向冻结提交）。

| # | 阶段 | 行为 |
|---|------|------|
| 1 | freeze 配置冻结 | 校验 remote 存在、源分支解析出 OID 并冻结、ref 名合法、校验命令存在；缺失 remote / 非法 ref / 缺失校验配置明确阻塞 |
| 2 | local-precheck 本地预检 | Git 仓库、非 detached HEAD、冻结提交仍存在、无未完成 merge/rebase、工作区与暂存区干净；未提交修改引导回现有提交功能（不自动 add/commit/stash）。例外：看板数据目录 `docs/agent-team-board/`（含本模块的运行记录与日志）是看板自身写入，不属于发布内容、不参与干净判定，否则流水线会被自身运行记录阻塞；其余任何脏路径（含暂存区）均阻塞 |
| 3 | fetch-remote 获取远端 | `git ls-remote` 读取目标 ref 远端 OID，判定 相同 / 可快进 / 落后 / 分叉；落后、分叉阻塞（不自动改写历史）；目标分支在 protectedBranches → 阻塞并展示 PR/MR 入口（远端地址派生） |
| 4 | quality-check 质量检查 | `git worktree add --detach <临时目录> <冻结OID>` 隔离工作目录执行校验命令，保存命令、退出码与日志；失败不可继续；结束清理 worktree |
| 5 | plan 推送计划 | 汇总待发布提交（`git log 远端OID..源OID`）、目标分支、可选标签、校验结果；分支+标签同批先 `--dry-run --atomic` 探测，远端不支持 atomic → 阻塞说明（不静默降级）；标签已存在且指向不同提交 → 拒绝；计划带指纹，执行时输入变化（源 OID / 远端 OID / 配置）→ 计划失效阻塞 |
| 6 | push 执行推送 | 只推明确选定的 refspec，默认仅快进（不用 force / mirror / `--all`）；分支+标签同批用 `--atomic`；执行前复核计划指纹；网络超时不立即判失败，交由阶段 7 查询远端实际结果 |
| 7 | verify 结果核验 | `git ls-remote` 读取远端实际 ref 与冻结 OID 比对，一致才标成功；不一致（含并发远端变化）失败并保留证据 |

命令执行统一走注入的 `exec`（真实实现 = spawn + 超时控制），便于在 exec 层模拟网络响应丢失（真实推送
已到达远端但客户端报超时 → verify 查询后判成功，不盲目重推）。

### Apple 流水线（scripts/lib/release-apple.mjs，八阶段 + 适配器）

外部系统（xcodebuild、ASC API）全部经适配器接口隔离，真实适配器做本机可验证的检查与调用，测试注入
模拟适配器验证状态 / 故障语义；模拟运行在证据中显式标注 simulated，不表述为真实上传成功。

| # | 阶段 | 行为 |
|---|------|------|
| 1 | locate 定位应用与材料 | 解析 project/workspace 的 target 与 Bundle ID（读 pbxproj）；多 target 匹配歧义要求显式选择（不误选）；按 app-info-repo `app.yaml` 匹配 SKU；首次无登记收集 SKU（默认 Bundle ID）并持久化 sku-map |
| 2 | env-credentials 环境与凭据 | 检查 macOS/Xcode、签名证书、profile、entitlements、ASC 权限；凭据只引用 `~/.appstoreconnect/config.json` 与私钥路径（存在性 / 引用），内容不复制、不落盘、不进日志 |
| 3 | materials 资料与合规 | 版本元信息、截图规格、隐私问卷、Review Notes、可选 IAP 校验；`PrivacyInfo.xcprivacy` 留在应用项目；资料沿用 SKU 目录，运行只保留材料摘要与内容指纹；私密材料存本地私有目录，记录脱敏引用 |
| 4 | build 版本与构建 | version/build 与 ASC 已有构建比较（重复可检测）；签名与加密合规检查后 archive/export/validate；产物留本地，记录产物路径、摘要（指纹）、源 OID、Xcode 版本与构建身份（产物可追溯到源提交） |
| 5 | upload 上传 TestFlight | 上传后等待 Apple 处理，仅目标构建 VALID 可继续；INVALID 展示原因；等待超时保持可恢复（不算失败）；重试 / 恢复先按应用 / 平台 / 版本 / build 查询已有上传，不重复上传 |
| 6 | submission-check 提审前检查 | 按 app-store-release skill 的首次 / 更新 checklist 核验必填资料与测试结果；API 无法设置的项目提供 ASC 人工处理入口，未完成阻塞后续 |
| 7 | review-data 准备审核数据 | 创建或复用准确版本、绑定已验证构建、同步文案 / 截图 / 审核资料并查询回验；只重试未完成操作（不重复创建版本）；完成后运行进入 waiting-manual（待人工提审），提供该应用 ASC 后台链接 |
| 8 | track 人工提审与跟踪 | 最终 Submit for Review 由用户在 ASC 手动操作，模块不调用最终提交接口；「刷新状态」读取真实审核 / 发布状态并区分 待审核 / 审核中 / 被拒（保留原因）/ 待开发者发布 / 处理中 / 已上线；仅确认商店上线标 succeeded；被拒保留原因，修订版本启动关联新运行（关联原运行 ID） |

ASC API 鉴权（真实适配器）：`~/.appstoreconnect/config.json` 内含 key id / issuer id / 私钥路径，按
ES256（node:crypto 原生签名，无第三方依赖）生成 JWT 走 ASC REST v1；无凭据时阶段明确阻塞并给配置指引。

### 服务接口（server.mjs 新增分流 handleReleaseApi，绑定 ?project=）

```
GET  /api/release/state               列表 + 环境摘要（git remote 可用性 / ASC 凭据配置情况；未初始化看板 → initialized:false）
GET  /api/release/targets             新建面板数据源：git remotes / 分支、Apple project/workspace 与 App 定位（脱敏）
POST /api/release/run                 创建草稿（target + 配置；非可执行类型 400）
POST /api/release/run/save            更新草稿配置（仅 draft / failed-waiting 前可改；执行中配置不可变）
POST /api/release/run/precheck        只跑只读阶段（Git 1–5 含 dry-run / Apple 1–3），不 push 不上传
POST /api/release/run/start           校验互斥与计划新鲜度后启动执行（阶段异步推进，逐阶段持久化）
POST /api/release/run/retry           重试失败 / 中断阶段（只重跑未完成操作；Apple 先查询已有上传 / 版本）
POST /api/release/run/cancel          取消后续阶段（已发送到远端的操作不宣称撤回，取消后仍核对外部结果）
POST /api/release/run/refresh         重新查询外部真实状态（Git verify / Apple track），不重复执行
GET  /api/release/run/:id             运行详情（含阶段、日志、产物、操作历史；404 未知）
POST /api/release/sku                 持久化 Bundle ID → SKU 映射
```

### 脱敏与安全

- 远端地址统一经 sanitize（剥离 `user:pass@` 凭据）后才入运行记录与日志；日志落盘前经敏感信息擦除
  （token / 私钥块 / Authorization 头）。
- ASC 凭据内容、私钥、私密截图 / 演示视频永不进入看板数据目录与日志，只存「路径引用 + 存在性」。
- 构建产物留本地项目外目录（运行记录只存路径 + 摘要指纹）。

### 开源选型（REQ-20260909-015）

自研理由：**无合适库 / 引入成本高于自研**。本模块核心是「看板数据层 + 状态机 + 流水线编排」，须与既有
零依赖 Node 架构（自研 http 服务、core 数据层、store 模式）同构；Git 操作是 `git` CLI 的薄封装（无成熟
npm 库能替代 CLI 语义且引入 nodegit（GPL 许可的 libgit2 绑定风险 / 原生编译依赖）成本显著高于 spawn 调用）；
ASC API 为 REST + ES256 JWT，node:crypto 原生可完成签名，无需第三方 SDK。故不引入任何开源库，
不创建 licenses.md。

### 影响面

- 新增：`scripts/lib/release-store.mjs`、`scripts/lib/release-git.mjs`、`scripts/lib/release-apple.mjs`、
  `scripts/web/release.js`、`scripts/tests/release-*.test.mjs`（5 个）。
- 修改（均为增量接线，先例：营销模块 REQ-20260910-019）：`scripts/web/index.html`（页签 + 容器 + script）、
  `scripts/web/app.js`（VIEWS / setView / 副标题 / 快照 / 项目切换重置）、`scripts/web/style.css`
  （.release-* 样式 + 窄屏断点）、`scripts/server.mjs`（import + /api/release 分流）。
- 不与任务（runs）模块共用状态；不触碰 REQ/BUG 状态机；发布模块不擅自接受或完成关联需求。

## 风险与边界

- 真实 Apple 联调需要已配置的应用与凭据，本期以适配器模拟状态 / 故障测试保证语义正确；模拟证据显式标注
  simulated，验收口径不把模拟表述成真实上传成功（用户环境真实执行时走同一代码路径）。
- 推送是外部副作用：通过「只推选定引用 + 默认仅快进 + 禁 force/mirror + atomic 探测 + 推后核验」收敛风险；
  网络响应丢失场景一律先查询远端实际 ref 再决定动作。
- 运行记录进 git 可能随日志增长：阶段日志按阶段单文件、超长截断（保留头部 / 尾部与摘要），证据存指纹
  而非全量产物。
