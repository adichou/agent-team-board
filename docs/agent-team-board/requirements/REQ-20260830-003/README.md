# REQ-20260830-003 /dev 支持 loop：连续开发直到所有已接受条目完成

- 状态：submitted（待人工接受）
- 创建：2026-08-29T17:07:07.888Z

## 描述

为 /dev 命令增加 loop 参数：进入循环模式，按顺序（requirement 优先、同类型取创建最早）逐个开发 accepted 条目，每个走完整 TDD 流程（读文档→claim→测试红→实现绿→report），report 后立即取下一个，直到没有 accepted 条目为止。状态机铁律不变：report 后条目停在 in-progress 等人工确认，loop 不触碰 accepted/done 人工状态。

## 验收标准

- [ ] `/dev loop` 进入循环模式：反复执行「选最早 accepted 条目 → 完整 TDD 流程 → report」，直到没有 accepted 条目（requirement 优先于 bug，同类型取创建最早）。
- [ ] 每个条目独立走完整流程（读文档、补 design/test-cases、claim、测试红→实现绿、report），不因批量模式跳过环节。
- [ ] 循环终止条件：无 accepted 条目（正常结束，汇报本轮完成清单）；或遇到不可恢复错误（如实报告后停止）。
- [ ] 单个条目开发失败不中断整个循环：如实 report/登记 bug 后跳过该条目继续下一个（条目保持 in-progress，交人工处置）。
- [ ] claim 冲突（被其他会话认领）视为跳过而非错误，继续下一个。
- [ ] 状态机铁律不变：不置 accepted/done，report 后条目停在 in-progress 等人工确认；`submitted` 的条目不会被 loop 选中。
- [ ] 循环结束输出总结：本轮完成（待确认）清单、跳过清单及原因、剩余条目状态分布。
- [ ] 不影响 `/dev <ID>`、`/dev next` 的现有单条目行为。
