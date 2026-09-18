# 设计 — REQ-20260916-003 按 REQ-20260915-001 四仓库规范整理源码仓库入口文档：重写 README.md 并新建根 AGENTS.md

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260915-001 落定四仓库规范：源码仓库 README 是开发者与 Agent 共用的入口；根 AGENTS.md 承载开发本产品的行动规则；区分「开发本产品」（根 AGENTS.md）与「使用产品管理任务」（skills/agent-team-board/SKILL.md）；未部署页面不冒充可用链接。本单把该规范落到本仓库的根 README.md 与根 AGENTS.md。

## 现状核对结论（2026-09-16 实测）

- 根 README.md 停留在早期版本：目录结构缺 scripts/lib 39 模块、web 构建/发布界面、electron、tests；安装写 `~/plugins/agent-team-board`；状态机无 planned。
- 实际安装形态：ZCode 插件缓存 `~/.zcode/cli/plugins/cache/personal/agent-team-board/<版本>/` 为本仓库 GitHub 地址的 git 克隆（remote 已核实），插件从缓存加载 skills/commands/hooks。
- `npm test`（= node scripts/tests/run-all.mjs）实测通过：260 个测试文件、0 失败，环境 Node v17.8.0。
- `node scripts/server.mjs` 默认端口 8888（ATB_PORT 可覆盖），零运行时 npm 依赖；8899 端口实测启动 + health ok。
- Electron v37.10.3（devDependency），`npm run app` = `electron .`（桌面壳，主进程 electron/main.mjs 拉起 server 子进程），`npm run dist` = electron-builder（mac dmg / win nsis，产物 dist/，已在 .gitignore）。
- 界面结构：scripts/web/index.html 顶栏页签 需求(status)/构建(build)/任务(runs)/设置(settings)；发布(release)/营销(marketing)/讨论(oncall)/文件(files) 为深链视图（app.js `VIEWS`/`HIDDEN_VIEWS`）。
- 看板服务已在本机 8888 常驻运行（health ok，多项目）。

## 方案

**交付物**：根 README.md 重写；根 AGENTS.md 新建；新增静态契约测试 scripts/tests/req-doc-entry-20260916-003.test.mjs。两份最终文案先以草稿落在本条目目录（draft-README.md、draft-AGENTS.md），claim 后原样落盘到仓库根并跑绿测试。

**README.md 结构**（保留开发知识、不做成营销页）：
1. 项目定位（是什么/解决什么）与安装形态一句（git 克隆进 ZCode 插件缓存）；
2. 三栏协作体系表（Project/Discussion/Status Board）+ 更新版状态机（submitted→accepted→planned→in-progress→done，含回退边与「待测试」「待人工决策」注记）+ 人机分工表（补置计划/移出计划、待人工确认作答、收口提交为系统自动）；
3. 目录与模块职责：根清单（manifests、skills、commands、hooks、bin、electron、scripts、docs/agent-team-board、output 素材）+ scripts/lib 分组表（core 数据层与自动提交 / 批量与派发 / 构建模块 / 发布模块 / 其他业务）+ scripts/web 清单（骨架 app.js、模块页、i18n、vendored 库）+ scripts/tests；
4. 环境与运行方式：Node 版本口径（未声明 engines、零运行时依赖、当前验证环境 v17.8.0）、npm test、Status Board 启动（8888/ATB_PORT）、Electron app/dist、atb CLI 与 cli install——全部为实测命令；
5. 关键机制索引：认领锁与源码守卫（core.mjs O_EXCL + state-guard.mjs，REQ-20260901-003）、report 自动收口提交（git-flow + manual-closeout，REQ-20260911-009 / BUG-20260915-007）、批量任务（batch/refine/hold/confirm + scheduler）、构建版本与发布流水线（build-store/build-git、build-publish* 独立事实源 BUG-20260916-001、release-git/apple/electron、product-release-pipeline 六阶段、mgt-commit）、中英文资源（i18n.js，BUG-20260912-001）；
6. 官网/用户文档/支持入口：登记待发布状态（规划于 app-homepage-repo），不提供未核验链接，上线后回填；
7. 按任务类型导航表：改 CLI/状态机、改看板界面、改批量派发、改构建发布、改桌面壳、改钩子守卫、开发流程入口各看哪里。

**AGENTS.md 结构**（仅开发本产品的规则）：双入口说明（头部+文末）→ 开发必须走看板（登记→人工接受→移入计划→claim；源码守卫 REQ-20260901-003；状态铁律）→ TDD 与收口（先红后绿；report 后系统自动收口提交，不手工 commit、不自动 push、不置 done）→ 质量基线（中英文资源 BUG-20260912-001；开源选型 REQ-20260909-015；提交主题带单号）→ 测试与拦截速查表 → 文档地图。

**关键取舍**：
- 不另建 docs/development/：本仓库按需详读的工程知识事实源已是 docs/agent-team-board/（历史单据 + batch-execution.md），AGENTS.md/README 直接导航过去，避免双头维护（REQ-20260915-001 的 docs/development/ 是通用约定，本仓库以既有目录承接）。
- 版本号不写入 README（package.json 0.1.0、manifest 0.3.15、server health 0.1.1 三处口径不一，不在入口文档固化任何单一数字）。
- 根 dispatch/、output/ 为素材与本地运行产物，README 不展开（非产品结构）。

**测试设计**：A 组静态契约见 test-cases.md，路径清单内置于测试文件（A1 逐个 fs.existsSync + README 文本包含断言；A2 解析 package.json 与 server.mjs 源码常量；A3/A4/A5/A6 文本断言）。先写测试跑红（当前 README 未更新、AGENTS.md 不存在），落盘两文件后跑绿。

**开源选型（REQ-20260909-015）**：本单为文档整理 + 静态契约测试，不引入任何新开源依赖，不创建 licenses.md。

## 风险与边界

- 状态守卫钩子对 Bash 命令中的 `2>` 片段敏感（写重定向误判），实测核对时避免在受保护目录命令里使用 `2>&1` 等写重定向写法。
- 只重写 README.md 与新建 AGENTS.md 两个根文件；不改动 SKILL.md、commands、docs/agent-team-board 既有内容（边界与导航靠引用，不复制）。
- 官网/支持入口在上游关联发布需求部署上线前保持「待发布」登记，回填动作不在本单范围。
