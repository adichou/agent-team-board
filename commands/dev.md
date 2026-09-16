---
description: 认领需求或 Bug 并按 TDD 开发
argument-hint: <ID | next | loop>
skills: agent-team-board
---

按 `agent-team-board` skill 的 TDD 开发流程处理，目标参数（`<ID>` / `next` / `loop`）
取自用户本条输入，缺省按 `next`。状态机、铁律、会话名约定等细则见 skill 正文，此处只列流程骨架。

1. **确定目标**：编号直接用；`next`/留空则 `node <插件根>/scripts/atb.mjs list --json` 选创建最早的
   planned（已计划）条目。没有 planned：请用户到 Status Board 接受并「移入计划」，停止。
2. **读文档**：条目 `README.md`、`design.md`、`test-cases.md`（Bug 读 README 与 design 的引入来源节）。信息不足先澄清或补文档
   （直接编辑 markdown，允许）；实施要点写入 design.md 作为实施记录。
3. **认领**：`node <插件根>/scripts/atb.mjs claim <ID> --by <会话语义名>`（如 `dev-login-view`；accepted/planned → in-progress）。
   被他人认领或状态不符时如实说明并停止；用户明确授权该条目例外开发时，按下述收尾规则的例外分支执行。
4. **TDD**：test-cases.md 补用例**写测试跑红** → 实现**跑绿** → 重构。新问题按 `/bug` 登记（登记时不填引入来源）。
   **开源选型（REQ-20260909-015）**：方案优先复用成熟开源库，以依赖方式引入（npm / SPM / CocoaPods），禁止复制
   开源库源码进项目仓库（仅 vendor 例外且须标注复制范围与原因）；仅用开源友好许可（MIT / Apache-2.0 /
   BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense），GPL / LGPL / AGPL / SSPL 及 License 不明禁止引入；
   引入开源库须在条目目录维护 `licenses.md`（库名 / 版本 / 引入方式 / License / 仓库地址），未使用不创建；
   自研须写三选一理由：引用了哪些库 / 无合适库的原因 / 引入成本高于自研的原因。
   **修复 Bug 必须归因**：根因分析与 test-report 写明引入来源（REQ-/BUG-编号，`atb list`/`show` 核验存在），
   写入 Bug design.md「引入来源（源单）」节，并在 Bug README 开头头部元信息区补写 `- 引入来源：…` 行
   （「创建」行之前、有「归属需求」行则其后，打开第一屏即见，样式见 BUG-20260907-017；末尾「关联」节仅作可选补充关联）；
   定位不到写「未定位（排查过程：…）」，禁止编造。
5. **提交与待测试**：执行 [收尾规则](../skills/agent-team-board/dev-closeout.md)：测试通过 → report → 本单 Git 提交 → 核验 hash 与本轮待测试状态。规则也覆盖例外授权与失败收尾，不得只留工作区修改或手写报告就宣称完成。
6. **交付**：汇报提交 hash、测试结果和待测试状态，请用户测试后到 Status Board 点「确认完成」。不自动置 done，不自动 push。

## 循环模式（`/dev loop`）

`/dev loop` 逐条处理：认领 → TDD 实施 → report → 本单 Git 提交与待测试核验 → 取下一个 planned（已计划），直到没有已计划条目为止。
**失败处理**：认领冲突、开发错误等如实记录后跳过；提交/上报失败或归属不明改动遗留时停止取单，按收尾规则报告阻塞。
循环铁律不变：不置 accepted/planned/done，submitted 不入选；结束时输出总结（完成/跳过清单与剩余状态分布）。
完整细则见 skill「会话调度规则」。