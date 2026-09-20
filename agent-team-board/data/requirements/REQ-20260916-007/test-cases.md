# 测试用例 — REQ-20260916-007 用户数据和应用数据要分离，commit 只需提交用户数据，应用数据不用 commit

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1 | initData 创建 `agent-team-board/data/{requirements,bugs}` 与 `runtime/{status,.locks}`、`runtime/config.json`、`runtime/README.md`；不创建 `docs/agent-team-board`；根 `.gitignore` 含 `agent-team-board/runtime/` 单条规则；板内无 `.gitignore` | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| L2 | createItem：文档落 `data/requirements/<ID>/`，状态落 `runtime/status/<ID>.json`，条目目录内无 `status.json`；listItems/claim/report/setStatus 全链路正常（状态读写走 runtime） | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| L3 | nextId 计数器读写 `runtime/config.json`；认领锁落 `runtime/.locks/` | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| L4 | check-ignore：`runtime/` 命中忽略、`data/` 代表性路径（README/design/test-cases/test-report/licenses/ui-demo/attachments/decisions.md）不命中且可被 git 跟踪 | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| L5 | 守卫 file 模式：直写 `agent-team-board/runtime/status/<ID>.json` 被拦；写条目 `data/**/README.md` 放行 | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| L6 | 守卫 bash 模式：重定向改写 `runtime/status/<ID>.json` 被拦；只读 cat 放行；流程外 git commit 拦截仍生效（新板根识别）；无锁改插件源码拦截仍生效（新锁目录识别） | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| L7 | report 自动收口：新布局下 doc 组提交仅含 `agent-team-board/data/` 与过渡期旧前缀路径，绝不包含 `runtime/` 任何路径（`atb commit log` 核验） | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| M1 | 迁移（临时 git 仓库造旧布局）：条目文档 `git mv` 至 `data/`（`git log --follow` 历史保留）、status.json/config.json/模块 settings 移入 runtime 且退出 git 跟踪（本地文件保留）、旧目录移除、根 `.gitignore` 更新、条目数量与状态迁移前后一致 | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| M2 | 迁移幂等：重复执行 no-op 成功；新布局无旧目录时报「已是新布局」；迁移后 atb 全流程（list/claim/report）正常 | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| M3 | 迁移服务接口：GET /api/layout/state 探测（legacy/new/none）；POST /api/migrate 执行迁移（含 CLI 等价性） | P1 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| G1 | mgt-commit：确认完成自动提交仅收集 `data/` 下 `confirmations.md`/`decisions.md`，不再提交 `status.json`；`git log` 无任何 runtime 路径提交 | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| G2 | 版本合并 `version.json` 自动入库取消：build-git 合并成功后不再产生 version.json 管理提交（`commitVersionMergeMgmt` 调用点与重试入口下线） | P1 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| P1 | 打包：`atb pack <out>` 产物排除根 `agent-team-board/`、`AGENTS.md`、`node_modules/`、`electron/`、`output/`；`skills/` 完整随包；产物内无被排除路径 | P1 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| D1 | 全仓检索（源码/SKILL.md/AGENTS.md/README.md/钩子/测试，迁移模块与其测试除外）无 `docs/agent-team-board` 残留引用；`req-doc-entry-20260916-003` 断言同步（batch-execution.md 新位置） | P0 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
| D2 | 文案中英文同步：设置页「数据布局迁移」分区、初始化目标路径提示等新增文案在 i18n.js 双语登记（跑 i18n 相关测试） | P1 | 通过（data-layout / layout-migration / mgt-auto-commit / plugin-pack / code-guard 等测试） |
