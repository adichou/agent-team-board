# 测试用例 — REQ-20260916-003 按 REQ-20260915-001 四仓库规范整理源码仓库入口文档：重写 README.md 并新建根 AGENTS.md

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> A 组为静态契约用例，落在 scripts/tests/req-doc-entry-20260916-003.test.mjs；B 组为命令实测核对，结果记入 test-report.md。

## A 组：静态契约（自动化，先红后绿）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| A1 | 根 README.md 存在，且其声明的每一个仓库内路径（scripts/lib 各模块、scripts/web 各界面、electron、bin、commands、hooks、skills、docs/agent-team-board 关键文档、.zcode-plugin/.codex-plugin manifest 等，清单内置于测试）在仓库中真实存在 | P0 | 通过 |
| A2 | README 记录的命令与事实一致：package.json `scripts.test` = `node scripts/tests/run-all.mjs`、`scripts.app` = `electron .`、`scripts.dist` = `electron-builder`；scripts/server.mjs 默认端口常量为 8888 且支持 ATB_PORT 覆盖 | P0 | 通过 |
| A3 | README「官网 / 用户文档 / 支持」节为待发布登记：含「尚未部署/待发布」表述，该节不出现 http(s) 链接 | P0 | 通过 |
| A4 | 根 AGENTS.md 存在，包含必需内容：看板流程（登记/人工接受/claim）、源码守卫与 REQ-20260901-003、`atb report` 自动收口、不手工 git commit、不自动 push、中英文资源与 BUG-20260912-001、开源选型与 REQ-20260909-015、npm test、常见拦截、与 SKILL.md 的边界说明 | P0 | 通过 |
| A5 | 双入口边界：AGENTS.md 引用的 skills/agent-team-board/SKILL.md 路径真实存在；AGENTS.md 表述「开发本产品 / 使用本产品管理任务」划界；不复制 SKILL 细则命令表（不含 `batch next`、`run receipt`、`refine next` 等 worker 细则字样） | P1 | 通过 |
| A6 | 两文件无私有运营信息：不含 `/Users/` 本机绝对路径、不含 app-info-repo 等私有运营仓库内部路径、不复制全局 ~/.zcode/AGENTS.md 规则（不含「模拟器」「人机界面指南」等全局条款字样）、无密钥形态字符串 | P1 | 通过 |

## B 组：命令实测核对（会话执行，结果记 test-report.md）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | `npm test` 全量通过（实测 Node v17.8.0，260 个测试文件 0 失败） | P0 | 通过（实测 263 个测试文件 0 失败，输出存档 runs/run-20260916-268/full-test-output.log） |
| B2 | `node scripts/server.mjs` 可启动：ATB_PORT=8899 临时拉起后 `/api/health` 返回 ok，随即关闭（8888 为本机常驻实例，不占用） | P0 | 通过 |
| B3 | Electron 接线核对：`./node_modules/.bin/electron --version` 可执行（实测 v37.10.3）；`npm run app` / `npm run dist` 与 package.json 脚本一致（不实际打开 GUI、不实际打包） | P1 | 通过 |
| B4 | `node scripts/atb.mjs list` 正常输出看板条目（CLI 入口可用） | P1 | 通过 |
| B5 | README 描述的界面入口与代码一致：顶栏页签 需求/构建/任务/设置（index.html data-view），发布/营销/讨论/文件为深链视图（app.js VIEWS 与 HIDDEN_VIEWS） | P2 | 通过 |
