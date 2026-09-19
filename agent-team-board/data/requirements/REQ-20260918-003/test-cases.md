# 测试用例 — REQ-20260918-003 clone 后从 git 历史重建看板状态（atb rebuild）

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 判定与写入：有提交（主题含单号）→ done；无提交 → submitted；提交正文含单号 → done（历史消息含单号口径）；嵌套 Bug 覆盖；标题 / 创建时间从 README 解析（缺失兜底）；history 留痕 from null → 判定状态、by=atb-rebuild | 高 | 通过 |
| R2 | 状态文件结构与现有一致（id/type/title/status/parent/owner/createdAt/updatedAt/agentCompletedAt/lastReport/history），`core.listItems` 全量可读（4 条含嵌套 Bug） | 高 | 通过 |
| R3 | 依据提交：done 项给命中提交完整 hash 与主题（正文含单号时主题行展示），hash 存在于真实 git 历史；submitted 项 basis=null | 高 | 通过 |
| R4 | 安全边界：`runtime/status/` 已有非 rebuild 产生的条目状态（活看板 createItem 产物）时拒绝执行并报错说明，既有文件不动 | 高 | 通过 |
| R5 | 幂等可重试：重跑不重写、不追加 history、不翻转已判定状态（新增含单号提交后仍保持 submitted）；删除部分状态文件模拟中断后重跑补齐剩余，最终与一次完整执行一致 | 高 | 通过 |
| R6 | CLI：`atb rebuild` 输出逐条清单（ID → 状态 + 依据提交 hash10+主题 / 无提交痕迹）与汇总计数（done N · submitted M）；usage 帮助文本登记；`--help` 可用；重建后 `atb list --json` / `atb show` 正常 | 高 | 通过 |
| R7 | 只读保障：重建前后 git HEAD / 提交数 / 分支列表 / `data/` 文档内容 / `runtime/config.json` 均不变（不产生提交、不建分支、不损坏计数器） | 高 | 通过 |
| R8 | 空看板（data/ 无条目）如实提示「无可重建内容」退出 0；未初始化目录执行报「未找到 agent-team-board」（与现有命令一致）退出 1 | 中 | 通过 |
| R9 | 非 git 项目兜底：不崩溃，全部条目按无提交痕迹判 submitted，CLI 附「不是 git 仓库」提示 | 中 | 通过 |

测试文件：`scripts/tests/req-20260918-003.test.mjs`（`node scripts/tests/req-20260918-003.test.mjs`）。
多分支场景（仅存在于其他分支的提交）按 README 验收口径默认不纳入（仅当前检出分支历史），未单列用例。
