# 测试用例 — REQ-20260916-005 如果 main 分支不存在则使用 master 分支，以兼容历史仓库

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 三类夹具（仅 master / main+master 并存 / 两者皆无）+ main 存在回归；
> 测试文件：scripts/tests/req-main-branch-fallback-20260916-005.test.mjs（真实临时 git 仓库 + exec 注入 + 前端载荷 vm/源码断言）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| G1 | 仅 master 夹具：resolveMainBranch='master'；ensureDevWorkflow 创建 dev 且不补建 main（分支列表无新增 main） | P0 | 通过 |
| G2 | main+master 并存：resolveMainBranch='main'（现状无回归）；gitBranchState.mainBranch 如实返回 | P0 | 通过 |
| G3 | 两者皆无（dev-only）：resolveMainBranch=null；ensureMainBranch 维持 BUG-20260914-003 根提交补建 main 口径 | P0 | 通过 |
| G4 | gitBranchState：非仓库 mainBranch=null；master-only='master' | P1 | 通过 |
| B1 | 仅 master：precheckMerge 通过（不再报 main 分支不存在）；mergeCommitsIntoMain 以 master 为目标 --no-ff 合并成功且消息含版本与条目号 | P0 | 通过 |
| B2 | dev-only：precheckMerge 仍报「main 分支不存在」（BUG-20260914-003 口径不回归）；main 存在仓库仍合并入 main | P0 | 通过 |
| B3 | listBranches 返回 mainBranch（master-only / 并存 / 皆无三类） | P1 | 通过 |
| B4 | syncRemote（本地 bare 远端）：master-only 跳过名单含 master；并存只跳 main；dev 等其余照常推送 | P0 | 通过 |
| B5 | build-store createVersion：传入 targetBranch='master' 如实记录；缺省仍 'main'（既有测试不回归） | P1 | 通过 |
| P1 | pipeline resolveMainBranchName（exec 注入）：master-only → 'master'；并存 → 'main'；皆无 → null | P0 | 通过 |
| P2 | prelGit.switchMainVerifyHead({mainBranch:'master'})：master-only 夹具 checkout master 并核对 HEAD；缺省 'main' 兼容 | P0 | 通过 |
| P3 | atomicPushBranches / precheckAtomicPushDryRun / verifyRemoteBranches（fake exec 捕获参数）：git 参数按 mainBranch 取 master；缺省 'main' | P1 | 通过 |
| P4 | collectCurrentInputs（master-only）：inputs.mainBranch='master'、mainSha=master 分支头 | P1 | 通过 |
| S1 | server.mjs from-build 冻结走 resolveMainBranchName、frozen.mainBranch 落库、merge 后主分支头按解析读取（源码接线静态断言） | P1 | 通过 |
| U1 | app.js gitWorkflowDescHtml：默认输出含「main 分支承载版本构建」；master 场景输出「master 分支承载…」（主分支名 span 拆分，i18n 可逐段命中） | P0 | 通过 |
| U2 | i18n：职责句拆分键中英同步（EN 词条 + 往返）；旧整句键移除（无死词条） | P0 | 通过 |
| U3 | build.js mainHint：master-only（载荷 mainBranch='master'）不渲染「本地缺少 main」误导提示；旧载荷（无 mainBranch、local 含 main）不误报 | P0 | 通过 |

既有测试同步更新（口径联动，非回归）：
- git-workflow-desc-20260912-001.test.mjs：T2/T4/T6 职责句断言改为「源码含插值模板 + 默认 main 输出完整句 + 拆分键词条」。

