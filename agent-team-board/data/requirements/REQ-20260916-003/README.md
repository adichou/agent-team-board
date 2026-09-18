# REQ-20260916-003 按 REQ-20260915-001 四仓库规范整理源码仓库入口文档：重写 README.md 并新建根 AGENTS.md

- 状态：submitted（待人工接受）
- 创建：2026-09-16T03:17:20.297Z

## 描述

源码 README 是开发者与 Agent 共用的项目入口（REQ-20260915-001「源码 README 与 Agent 阅读」节）。现状内容明显滞后：

- 目录结构停留在早期：缺少 scripts/lib 的 40 个模块（批量/派发/构建/发布/营销等）、scripts/web 的构建与发布界面、electron 桌面壳、scripts/tests 测试体系；
- 安装路径写的 `~/plugins/agent-team-board` 已不实：插件实际以 git 克隆装入 ZCode 插件缓存（remote 指向本仓库 GitHub 地址）；
- 状态机与人机分工缺 planned（已计划）、批量开发/完善、待人工决策、report 自动收口提交等新机制；
- 四仓库规范要求的官网/用户文档/支持入口、按任务类型的导航完全缺失。

本单重写根 README.md（保留并更新开发知识，不做成营销页），并新建根 AGENTS.md 承载「开发本产品」的仓库级行动规则（与插件 SKILL.md「使用本产品管理任务」划界，不复制内容）。

## 验收标准

- [ ] README 重写后包含：项目定位与三栏协作体系、更新后的人机分工与状态机、目录与模块职责（scripts/lib 按组、scripts/web、electron、bin、commands、hooks、docs/agent-team-board）、环境与运行方式、关键机制索引、官网/用户文档/支持入口待发布登记、按任务类型导航。
- [ ] README 引用的仓库内路径全部真实存在，记录的命令与 package.json / 代码事实一致（新增静态契约测试把关）。
- [ ] 官网/用户文档/支持入口按「未部署页面不冒充可用链接」原则登记待发布状态；两文件无私有运营信息（不出现私有仓库内部路径、本机绝对路径、密钥）。
- [ ] 根 AGENTS.md 新建，包含：开发必须走看板（登记 → 人工接受 → 移入计划 → claim，源码受 PreToolUse 钩子硬保护 REQ-20260901-003）、TDD 与 report 自动收口（不手工 git commit、不自动 push、不置 done）、中英文资源同步（BUG-20260912-001）、开源选型（REQ-20260909-015）、测试命令与常见拦截速查、与 skills/agent-team-board/SKILL.md 的双入口边界说明；不复制全局 ~/.zcode/AGENTS.md 规则与 SKILL 内容。
- [ ] 新增静态契约测试 scripts/tests/req-doc-entry-20260916-003.test.mjs，先红后绿；npm test 全量通过。
- [ ] 命令实测核对记录（npm test、server 启动、Electron、atb CLI）写入 test-report.md；report 后系统收口提交到 dev。

## 界面展示

本单交付物是文档（根 README.md 重写 + 根 AGENTS.md 新建），不改动看板代码；但重写后的 README 须如实描述的界面即 Status Board 看板（三栏协作体系中的第三栏）。本节固化 README 中与界面相关内容的描述口径，供落稿与评审对照。

- 可交互演示：[./ui-demo.html](./ui-demo.html)（单文件、无外网依赖、无构建步骤，浏览器直接打开；示例条目均为演示数据）。

### 界面布局

- 顶栏：项目名 + 轮询指示（每 2 秒轮询 `/api/board`）+ 中/EN 语言切换；下方页签 需求（status）/ 构建（build）/ 任务（runs）/ 设置（settings），发布（release）/ 营销（marketing）/ 讨论（oncall）/ 文件（files）为深链视图、默认隐藏（`?view=…` 进入）。
- 需求视图：六档状态筛选条（待接受 / 已接受 / 已计划 / 开发中 / 待测试 / 已完成，默认选中第一档，无「全部」档）；条目列表逐行展示编号、标题、状态徽标，上报未确认的条目带「待测试」角标，待人工决策条目带「待人工决策」角标。
- 点击条目行从右侧打开详情抽屉：条目信息（状态 / 类型 / 上报记录 / 说明）+ 按角色分组的操作按钮（人工操作 / Agent 操作）。

### 交互行为

- 页签与深链切换视图；六档筛选条按状态过滤列表，档位上实时显示条目数。
- 人工操作（真实看板入口在详情抽屉按钮或 `atb status` 命令）：接受（submitted → accepted）、移入计划（accepted → planned）、移出计划（planned → accepted 回退）、确认完成（待测试 → done）、驳回完成（done / 待测试 → in-progress）、驳回接受（accepted → submitted）、待人工决策作答并复工。
- Agent 演示操作：认领（planned → in-progress，`atb claim` 原子认领锁）、上报（in-progress → 待测试，`atb report` 后系统自动收口提交）、声明待人工决策（条目保持 in-progress，等人工作答）。
- 状态铁律可交互体验：点「越权置 done（演示拦截）」可见 Agent 侧置 accepted / planned / done 被钩子确定性拦截的反馈（对应 scripts/state-guard.mjs，README 人机分工表口径）。

### 状态反馈

- 正常：数据轮询返回后渲染列表，轮询无变化不重渲染；操作结果以即时提示（成功 / 拦截 / 信息）呈现。
- 空：当前档位无条目时展示「该档暂无条目」空态。
- 加载中：骨架屏 + 「正在加载 /api/board …」提示（演示约 2 秒后自动恢复，模拟轮询返回 200 OK）。
- 失败：红色错误条「无法连接 Status Board 服务」+ 重试按钮，点击重试回到加载中再恢复。
- 深浅色跟随系统并可手动切换；界面文案中英文可切换（对应 README 中 i18n.js「中文原文为键」机制的口径）。

## 关联

- 上游规范：REQ-20260915-001（四仓库职责与源码 README/AGENTS 要求）。
