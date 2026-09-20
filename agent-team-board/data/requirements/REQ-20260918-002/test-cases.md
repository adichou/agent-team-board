# 测试用例 — REQ-20260918-002 根目录下的 README.md 不受实施互斥锁约束，允许用户和 Agent 更新以及提交

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：scripts/tests/req-20260918-002.test.mjs（子进程实测 state-guard file/bash 两模式，
> 参照 code-guard.test.mjs 与 state-guard-20260917-002.test.mjs 形态）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 无锁 file 模式 Write/Edit 指向插件根 README.md 放行；软链别名路径与相对路径定位同一文件同样放行 | 高 | 通过 |
| R2 | 无锁 Bash 改写插件根 README.md（sed -i / > / >> / tee）放行 | 高 | 通过 |
| R3 | 无锁同批命令改 scripts/、commands/、skills/、hooks/ 受保护源码仍拦（保护面不弱化） | 高 | 通过 |
| X1 | 豁免范围精确：根 AGENTS.md、package.json、index.html、bin/ 下文件、README.en.md 无锁改写仍拦 | 高 | 通过 |
| X2 | scripts/、skills/ 目录内同名 README.md 不获豁免仍拦（fake-plugin 隔离复现） | 高 | 通过 |
| X3 | 既有守卫规则回归：runtime/status 直写、atb status 人工专属状态、atb new --accept、hold/confirm、人工 API 拦截不变 | 高 | 通过 |
| C1 | 无锁 Bash 提交「类型: 描述 单号」+ pathspec 全为插件根 README.md 放行（相对/绝对/-- 分隔/-C 基准/--message=/多段 -m；参数文本提及 git commit 不误拦） | 高 | 通过 |
| C2 | 提交拦截不回退：pathspec 混入源码或根其他文件拦；裸提交/-a/--amend/无 -m 拦；git add 夹带后裸提交拦 | 高 | 通过 |
| C3 | 主题不合规拦：无单号、类型前缀不合规（docs:）、无前缀、描述为空、描述超 120 字、单号不在主题行 | 高 | 通过 |
| C4 | REQ-20260917-002 条目目录用户数据提交通道回归放行（无单号仍拦） | 高 | 通过 |
| L1 | 有认领锁时原放行行为不变：file/bash 改源码放行、根 README.md 改写放行（临时看板锁复现，不依赖真实锁） | 中 | 通过 |
| E1 | fake-plugin 内伪 git 仓库端到端：根 README.md 提交守卫放行且真实落库；预先 git add 源码后 pathspec 提交不夹带（diff-tree 仅含 README.md） | 中 | 通过 |
| D1 | 文档同步：根 AGENTS.md「改前先登记」与根 README.md「认领锁与源码守卫」含根 README.md 无锁更新提交口径；state-guard.mjs 顶部注释同步 | 中 | 通过 |
