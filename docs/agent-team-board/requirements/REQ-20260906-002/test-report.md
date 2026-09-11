# 独立验收测试报告 — REQ-20260906-002

**结论：不通过，暂不满足验收条件。** 既有专项测试 40/40 通过，但本次复测确认 3 个缺陷。专项全绿不能替代需求验收。

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

既有 `batch-core / batch-cli / batch-serve / batch-ui` 用例共 40 个，全部通过。

## 已复现缺陷

| 编号 | 优先级 | 现象与影响 | 预期 |
| --- | --- | --- | --- |
| [BUG-20260906-001](bugs/BUG-20260906-001/README.md)（Z-A1） | P1 | 只有受阻候选时，next 返回 stop=blocked 并把批次置为 finished；随后 check 仍返回 nextAction=continue、blocked=0、remaining=1。 | 全受阻时主调度收到 stop 和准确阻塞计数，不再派发空 worker。 |
| [BUG-20260906-002](bugs/BUG-20260906-002/README.md)（Z-A2） | P1 | 先由 manual-worker claim A，再创建批次并由 batch-worker next/claim B，两个条目同时 in-progress 且 owner 不同。 | 手工、Zcode、Codex 任一入口先占用项目后，其余实施入口都被阻塞。 |
| [BUG-20260906-003](bugs/BUG-20260906-003/README.md)（Z-A3） | P1 | failed 回执带 safeToContinue=false 后，批次显示 needs_attention，但 impl.lock 已删除，手工还能 claim 另一条目。 | 无法确认工作区可继续时暂停项目，并让其他入口遵守该暂停。 |

## UI 实测

- 1360×900：抽屉宽 720px，左边界 640px，满足宽度上限。
- 360×800：抽屉宽 360px、左边界 0、scrollWidth=clientWidth=360，入口、关闭按钮及表单均可见；两种模式能切换，关闭正常。
- [桌面截图](../../test-runs/20260906-002-003/zcode-desktop.png)、[360px 截图](../../test-runs/20260906-002-003/zcode-360.png)。
- 本次没有在真实项目创建批次或修改依赖；复制失败恢复、实际依赖编辑交互只重跑现有静态/接口测试，不能记为本次完整浏览器操作通过。

## 未验证与验收限制

- Z17：没有完整日志回传基线的独立对比实验。现有 10 项假 worker 用例验证了逐项回执及 check 各不超过 2KiB，不能换算成真实 token 节省率。
- Z18/Z19：没有执行真实 Zcode 主调度及三个原生子 Agent，也没有验证父历史/工具注入边界。本次未建立真实 Zcode 运行证据。
- Z04、Z12/Z13、Z02/Z15 等相关原“通过”结论受到本次反例推翻；修复后需重新验证阻塞停止、所有入口双向互斥和失败恢复。
- 业务状态保持原状，本报告不代表人工验收完成。


原实施报告仅作历史保留：[原报告](../../test-runs/20260906-002-003/prior-REQ-20260906-002-test-report.md)。本次结论以本文及复测证据为准。
