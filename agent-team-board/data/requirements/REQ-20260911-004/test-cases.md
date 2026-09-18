# 测试用例 — REQ-20260911-004 在设置中支持对 commit 到 git 的目录进行设置，默认只 commit 源代码相关目录

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/commit-scope-20260911-004.test.mjs`（U/E/S/W 全部）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| U1 | 默认与回退：未配置 / 配置文件损坏时 `loadTaskSettings` 的 commit 分区 = 默认清单（scripts/bin/commands/electron/hooks/skills/docs/ + rootFiles=true）且 `configured=false`；保存后 `configured=true` 并持久化可读 | 高 | 通过 |
| U2 | 保存校验：patch.commit 合法局部合并（dirs / rootFiles）；非法值整体拒绝且不落半截配置（非数组、嵌套路径、绝对路径、空串、`.`、`..`、rootFiles 非布尔、范围全空） | 高 | 通过 |
| U3 | 范围判定与文案：`commitScopeAllowsFile` 对根级文件（rootFiles 开关）/ 白名单顶层目录内 / 范围外三类正确；`commitScopeText` 含目录清单与根文件口径（关闭时不出现） | 高 | 通过 |
| E1 | 提示词与批次冻结：未配置时 create → batch.json 冻结 scope=默认，prompt 含范围行与「范围外不 add、不 commit、不丢弃，原样保留在工作区」；next 领取 spec 摘要携带同一范围 | 高 | 通过 |
| E2 | 范围内提交通过：默认范围下业务（scripts/）/ 测试（scripts/tests/）/ 条目文档（docs/ 条目目录，doc 类）三组提交 done 成功——既有口径不回归 | 高 | 通过 |
| E3 | 范围外改动保留工作区：output/ 下文件改动在本批提交流程后原样留在工作区（git status 可见、无暂存残留） | 高 | 通过 |
| E4 | 核验兜底（严格拒绝）：commit 误含范围外文件（output/）→ done 被拒，错误列出越界文件与允许范围；子代理改走 commit fail 收尾不被卡死 | 高 | 通过 |
| E5 | 生效时机：保存新范围（含自定义目录、关根文件）后再 create → 新批次 scope / prompt / next spec 均为新范围；旧（已终止）批次冻结 scope 不变 | 高 | 通过 |
| S1 | 服务端：GET /api/tasks/settings 返回含默认合并的 commit 分区；POST 保存 commit 分区持久化生效；非法 commit 值 400；保存后 /api/commit/create 的新批次提示词携带新范围 | 高 | 通过 |
| W1 | UI 契约：设置页「批量任务」之后渲染「批量 Commit」分区（两组复选框 data-cdir + 根文件开关、恢复默认、#csSave/#csStatus、说明含「仅对后续新创建的批量 Commit 任务生效」「范围外」「保留在工作区」、未配置信息条）；保存载荷仅含 `{ commit: { dirs, rootFiles } }`；空范围警示 + 保存禁用；保存成功 / 失败（草稿保留）就近反馈；加载中 / 失败态不渲染编辑与保存 | 高 | 通过 |
| W2 | 兼容不回归：`commit-batch-20260910-013` / `commit-serve-20260910-014` / `task-settings-simplify-20260909-001` 等既有测试不回归（run-all 全绿） | 高 | 通过 |
