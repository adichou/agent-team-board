# 批量实施执行规范（Zcode worker）

适用：REQ-20260906-002 Zcode 批量实施。本文件由看板创建批次时快照到项目
`docs/agent-team-board/dispatch/worker-spec.md`，主调度提示词只引用该路径。
每个子 Agent 读取本规范后**只实施一项**，完成后结束；不得再派发其他子 Agent。

`$ATB` 指代 `node <插件>/scripts/atb.mjs`（提示词中的「批次摘要入口」已带全量命令）。

## worker 单项流程

1. **领取**：`$ATB batch next --by zcode-batch-<批次尾号>-<序号> --dir <项目根>`。
   - 返回单项规范（runId/itemId/itemDir/docs/workerSpec），没有队列。
   - `stop: paused|blocked|finished` 时按提示结束，不要重试。
   - 互斥占用说明已有其他执行在实施本项目：如实返回原因并结束。
2. **读文档**：条目 `README.md`、`design.md`、`test-cases.md`（Bug 只读 README）。信息不足先在条目内澄清或补文档。
3. **认领**：`$ATB claim <itemId> --by <与 next 相同的 --by>`。
   - 认领冲突（被他人抢先）：`$ATB run release <runId> --reason "认领冲突"` 后回到第 1 步换单。
   - 其他失败：不要 reset/clean/stash 用户工作区；如实按第 5 步收尾。
4. **TDD 实施**：test-cases.md 补用例跑红 → 实现 → 跑绿 → 重构。新问题按 /bug 登记（不填引入来源）。
   修 Bug 必须归因引入来源（REQ-/BUG- 编号经 `atb list` 核验，或写「未定位（排查过程）」）。
5. **上报**：
   - 成功：`$ATB report <itemId> --coverage <N> --framework <框架> --summary "<要点>" --by <同上> --run <runId>`，
     然后 `$ATB run receipt <runId> --result reported --report-ref test-report.md`。
   - 阻塞（依赖/信息缺失，可继续其他项）：`$ATB run receipt <runId> --result blocked --reason "<短句>"`。
   - 失败（环境错误/实施失败，不可继续）：`--result failed --reason "<短句>" --no-safe-to-continue`。
   - reason ≤200 字，完整错误与测试输出写入 `docs/agent-team-board/dispatch/runs/<runId>/` 下文件后引用。
6. **回执**：把 receipt 命令输出的一行 JSON 原样返回给主会话（≤2 KiB），然后结束。
   不返回完整代码、测试日志或整份报告。

## 约束

- 不代替人工接受条目或确认完成；不直接写任何 `status.json`。
- 不修改/删除用户未提交改动；不自动 commit/push。
- 同一时间本项目只存在一个实施任务（impl 互斥锁保护），收尾命令会自动释放。
- 上报后条目保持 in-progress 待人工确认，即可让主会话继续派下一项。
