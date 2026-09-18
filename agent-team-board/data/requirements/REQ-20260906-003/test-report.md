# 独立验收测试报告 — REQ-20260906-003

**结论：不通过，暂不满足验收条件。** 既有专项测试 61/61 通过，但本次复测确认 7 个缺陷。专项全绿不能替代需求验收。

## 执行环境与证据

- 日期：2026-09-06，执行者：codex-acceptance-audit。
- 项目：`/Users/adichou/Documents/src/agent-team-board`；Node v17.8.0；真实 CLI 为 codex-cli 0.153.4。
- 本目录不是 Git 仓库，版本以[环境与源码摘要](../../test-runs/20260906-002-003/environment.json)中的 SHA-256 为准。
- 测试范围：既有自动化、独立边界探针、真实 CLI 启动/参数验证、浏览器桌面和 360px 布局。
- 产品源码未修改；故障注入只操作系统临时目录中的夹具。真实项目未开启自动派发，未接受或确认任何业务条目。
- 未采集语句/分支覆盖率，不将用例通过率或原实施报告的 75%/72% 当作本次代码覆盖率。

## 全量回归

执行 `node scripts/tests/run-all.mjs`：33 个文件，32 个通过，1 个失败；退出码 1。

唯一红灯为 `detail-close-btn.test.mjs` T2。该断言对整个 app.js 禁止 `justify-content:space-between`，实际命中第 938 行的**批量抽屉**布局，不是其目标条目详情头部。它属于测试范围过宽导致的失败；不能据此认定条目关闭按钮失效，也不能将全量回归写为通过。默认端口测试因 8888 已被现有服务占用，跳过 V6 集成段及 V7 的“不再占 8888”断言，详见日志。

- [完整回归输出](../../test-runs/20260906-002-003/regression.log)
- [逐套件计数](../../test-runs/20260906-002-003/regression-summary.json)
- [补充探针脚本](../../test-runs/20260906-002-003/adversarial.mjs)、[机器结果](../../test-runs/20260906-002-003/adversarial-results.json)、[原始输出](../../test-runs/20260906-002-003/adversarial.log)

补充探针复跑：`node docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs`。共 8 个断言均失败，退出码 1；这是产品未满足验收预期的复现结果，不是探针已通过。

## 本需求专项结果

既有 `dispatch-store / codex-adapter / execution-verifier / scheduler / dispatch-api / codex-ui` 用例共 61 个，全部通过。

## 已复现缺陷

| 编号 | 优先级 | 现象与影响 | 预期 |
| --- | --- | --- | --- |
| [BUG-20260906-004](bugs/BUG-20260906-004/README.md)（C-A1） | P1 | 当前 run 有明确 runId，但新 report 未传 --run，lastReport.runId=null，verifyCompletion 仍返回 reported=true。 | 自动运行的报告必须关联本次 runId；旧调用兼容不能充当本次自动执行的完成证据。 |
| [BUG-20260906-005](bugs/BUG-20260906-005/README.md)（C-A2） | P2 | 已有 accepted 候选但依赖未满足，调度器 waiting.kind=empty，界面显示队列已空而没有依赖原因。 | 显示依赖阻塞及需完成的前置条目，和空队列明确区分。 |
| [BUG-20260906-006](bugs/BUG-20260906-006/README.md)（C-A3） | P1 | 假 CLI 正常结束但未认领未上报，每次按默认最多追加 2 轮后 blocked；条目仍 accepted，又被新建 run 处理。450ms 观察窗口内已出现多份同条目运行记录。 | 有限续跑耗尽后阻塞该条目或暂停执行器，人工重试前不得自动创建新的尝试。 |
| [BUG-20260906-007](bugs/BUG-20260906-007/README.md)（C-A4） | P1 | 网络失败进入退避后调用 stopCurrent 返回 ok；退避结束时进程启动次数仍从 1 增为 2，cancelRequested=true 与 phase=running 同时存在。 | 停止请求撤销待执行重试，并在确认停止后结束运行，不复活旧执行。 |
| [BUG-20260906-008](bugs/BUG-20260906-008/README.md)（C-A5） | P1 | 有两个可恢复 interrupted 记录时，选择较早记录恢复，实际恢复较新的另一项。前端发送空请求体，服务和 scheduler 均不接收选中的 runId。 | 恢复必须绑定用户当前查看的 runId、itemId 和原 threadId，并核对 owner 和执行状态。 |
| [BUG-20260906-009](bugs/BUG-20260906-009/README.md)（C-P1） | P1 | 本机 codex-cli 0.153.4 执行适配器构造的 exec resume <ID> --json -C <project> -，立即退出 2，报 unexpected argument '-C' found，尚未进入会话或模型调用。PATH CLI 和自动探测到的 ChatGPT 内置 CLI 均复现。 | 按 exec 与 exec resume 各自支持的参数构造命令，真实同项恢复能够进入指定会话。 |
| [BUG-20260906-010](bugs/BUG-20260906-010/README.md)（C-P2） | P1 | 当前项目无 Git 仓库，预检 allOk=true 且宣称参数已核验；实际 exec 退出 1，提示 Not inside a trusted directory and --skip-git-repo-check was not specified；恢复参数也未实际核验。 | 静态预检区分版本存在、参数兼容、项目运行约束和权限适配，失败条件下阻止开启并展示真实原因。 |

## 真实 CLI 与预检

使用生产 `startCodexExec` 适配器，分别验证 PATH CLI 和自动探测的 `/Applications/ChatGPT.app/Contents/Resources/codex`（均为 0.153.4）。

- 新执行：当前非 Git 项目退出 1，`Not inside a trusted directory and --skip-git-repo-check was not specified.`
- 恢复：传入测试占位会话 ID，参数解析阶段立即退出 2，`unexpected argument '-C' found`。尚未查找该 ID，更没有调用模型，因此此结果证明参数不兼容，不代表真实会话恢复通过。
- 同时调用实际看板 `/api/dispatch/preflight`：返回 `allOk=true`，仍显示“已按本机 CLI 帮助核验（codex-cli 0.153.1 实测）”；浏览器显示相同绿灯。预检结论与真实启动结果矛盾。
- [生产 CLI 与预检原始证据](../../test-runs/20260906-002-003/real-cli-production-probes.json)、[PATH CLI 隔离探针](../../test-runs/20260906-002-003/real-cli-probes.json)。

## UI 实测

Codex 页可打开，默认关闭，配置默认 60 分钟/2 次重试/重启续跑关闭；检查环境按钮返回结果。360×800 下抽屉宽 360px、无抽屉横向溢出，配置和静态检查按钮可见。见[360px 截图](../../test-runs/20260906-002-003/codex-360.png)。没有开启真实自动派发或执行取消/恢复按钮；对应故障由独立假 CLI 探针验证。

## 未验证与验收限制

- C22/C23：真实连续三项执行、独立会话、取消后无延迟写入及恢复同项均未完成；当前真实启动和恢复先被上述本地检查阻断，不能声称支持无人值守。
- 本次探针在 CLI 参数/项目检查阶段退出，没有获得真实 threadId，也未验证模型可达性、登录或额度。
- 崩溃的所有窗口、共享 daemon/逃逸工具、磁盘写失败、Electron 真机窗口全生命周期仍无本次完整故障矩阵证据；既有假进程/服务测试不能覆盖全部这些条件。
- C08/C09/C10/C14 及恢复相关原“通过”结论受反例推翻；修复后须验证有限重试跨 run 的边界、停止取消退避任务、精确恢复和严格 runId 核验。
- 业务状态保持原状，本报告不代表人工验收完成。


原实施报告仅作历史保留：[原报告](../../test-runs/20260906-002-003/prior-REQ-20260906-003-test-report.md)。本次结论以本文及复测证据为准。
