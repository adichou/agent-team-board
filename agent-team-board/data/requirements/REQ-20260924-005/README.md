# REQ-20260924-005 看板项目业务源码写入层保护：无有效认领锁时禁止 Agent 改写业务源码

- 状态：submitted（待人工接受）
- 创建：2026-09-24T08:17:40.690Z

## 描述

现状空档：state-guard 仅保护 runtime/status 状态文件与插件自身源码；看板项目（含 agent-team-board/ 目录的项目）的业务源码（如 cili_search 的 background.js）Agent 可无锁随意 Edit/Write，Bash 用 sed/tee/重定向改写同样放行。乱改虽被提交门禁拦下进不了版本库，但污染工作区、可能混入人工提交或系统自动收口提交的变更集。

目标：业务源码与插件源码同口径——无有效认领锁（runtime/.locks/ 24h）时，Agent 不得改写看板项目内业务源码；改码必须先 /req 或 /bug 登记 → 人工接受 → /dev 认领。

要点：
1. file 模式：目标路径落在看板项目板根范围内且不在豁免清单 → 无锁拒绝并引导认领流程；新建文件同样覆盖（祖先回溯口径同 BUG-20260908-001）。
2. bash 模式：新增业务源码改写判定（sed -i / tee / 重定向 / mv / cp 等），与 bashRewritesPluginSource 平行，防 echo > 绕过 file 门禁；只读命令（cat/ls/grep）不受影响。
3. 豁免清单：agent-team-board/data/**（条目用户数据，文档讨论轮无锁可写）；runtime/status 已有专门规则；runtime/.locks 必须保护（防删锁绕过一切）。其余豁免口径在设计阶段定：
   - `.git` 等项目元数据；
   - 被管理项目根第一层纯文档（如项目自身 README.md / CHANGELOG.md 等文档类文件）——现状不在豁免清单，按要点 1 默认口径无锁会被拦；倾向与插件根发布文档口径对齐（无锁放行，同 REQ-20260918-002 / REQ-20260923-001）：改被管理项目自身文档属高频操作，纯文档乱改风险低且有提交门禁兜底，与 data/** 豁免理由同构。
4. 锁语义一期复用项目级 hasValidClaimLock（不绑定会话/条目，与插件源码保护同口径），二期可做锁-会话绑定。
5. 分支作用域（重构缺口）：业务源码门禁**仅在 dev 与 main 分支生效**；其他分支（如重构特性分支）下业务源码写入不受本门禁限制，留出重构等自由操作空间。分支判定以目标项目 git 仓库当前分支为准（hook.cwd 下 `git rev-parse --abbrev-ref HEAD`）；非 git 仓库、detached HEAD 或分支判定失败时按门禁生效处理（fail-closed）。注意：该豁免仅限业务源码写入层门禁，插件源码保护、runtime/status 保护与提交门禁不随分支放宽。

验收标准：
- 无锁时 Edit/Write 业务源码被拦（exit 2 + 引导提示「先登记→人工接受→认领」）；有锁放行。
- 无锁时 Bash 改写业务源码（sed/tee/重定向）被拦；只读放行。
- agent-team-board/data/ 下文档无锁编辑放行（文档讨论轮不受影响）。
- 删除 runtime/.locks/ 锁文件的命令被拦。
- dev/main 分支上门禁生效；切换到其他分支（如 git checkout -b refactor-x）后同样的无锁业务源码改写放行；detached HEAD 时门禁生效。
- 非看板项目（无 agent-team-board/ 目录）完全不受影响。
- 既有插件源码保护、status 保护、提交门禁行为无回归（三者均不随分支变化）。

## 验收标准

- [ ] （待补充）
