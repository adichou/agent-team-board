# 设计 — REQ-20260830-003 /dev 支持 loop：连续开发直到所有已接受条目完成

## 背景

`/dev` 目前一次处理一个条目（`<ID>` 或 `next`）。用户需要批量开发模式：循环消化所有 accepted 条目直到清空。loop 是纯 Agent 行为规范（提示词层），没有运行时代码可改——交付物是命令文档与 skill 规范的更新。

## 方案

### 交付物

1. `commands/dev.md`：
   - `argument-hint` 增加 `loop`；
   - 新增「循环模式」一节，定义循环语义（见下）。
2. `skills/agent-team-board/SKILL.md`：
   - TDD 开发流程与「会话调度规则」补充 loop 语义，保持与命令文档一致。
3. `scripts/tests/loop-mode.test.mjs`：**文档契约测试**（node:test）——loop 语义无法用运行时单测覆盖，改为断言命令/skill 文档中必须存在的契约点，防止后续编辑意外丢失 loop 规范。

### 循环语义（规范）

- 入口：`/dev loop`。等价于反复执行 `/dev next`，直到终止条件。
- 选中规则与 `next` 相同：requirement 优先于 bug，同类型取创建最早，仅 accepted。
- 每个条目独立走完整流程：读三份文档 → 补 design/test-cases → claim → TDD 红→绿 → report。
- 跳过而非中断：claim 冲突（被他人认领）跳过继续；单条目开发失败如实 report 或登记 bug 后跳过继续，条目保持 in-progress 交人工处置。
- 终止：无 accepted 条目（正常结束）；或不可恢复错误（如实报告后停止）。
- 结束输出总结：完成（待确认）清单、跳过清单及原因、剩余条目状态分布。
- 铁律不变：不置 accepted/done；report 后条目停在 in-progress 等人工确认；submitted 不入选。
- 兼容：`/dev <ID>`、`/dev next` 行为不变。

### 影响面

仅文档与测试；不触碰 atb.mjs/server.mjs/前端。命令与 skill 更新后需同步到插件缓存目录（现有流程）。

## 风险与边界

- loop 速度可能快于人工确认：accepted 清空即正常结束，用户批量确认后再次执行 `/dev loop` 继续（README 已注明）。
- 契约测试是字符串断言，防丢规范而非验证 Agent 实际行为——实际行为由提示词约束，人工在使用中验收。
