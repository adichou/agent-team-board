# BUG-20260901-002 测试用例

载体：`scripts/tests/code-guard.test.mjs`（子进程实测守卫，模式同 REQ-20260901-003 G 系列）。

| 编号 | 用例 | 输入要点 | 期望 |
| ---- | ---- | ---- | ---- |
| F1 | atb 合法子命令文本提及目录与状态文件名放行 | `atb new req --desc` 与 `atb report --summary` 文本含 `docs/agent-team-board` 与 `/status.json` 字样（原始误报形态） | exit 0 |
| F2 | 只读命令按路径形态提及 status.json 放行 | `cat …/status.json \| head`、`ls …/status.json`、`grep -c status.json …` | exit 0 |
| F3 | status.json 真实改写命令仍拦截（原攻击样例回归） | `echo > …/status.json`、`sed -i …/status.json`、`echo \| tee …/status.json`、`rm …/status.json` | exit 2 |
| G5（既有） | 只读不误报 | `cat …/status.json`、`ls/grep` 提及看板目录 | exit 0 |
| G4（既有） | status.json 用 Write/Edit 直写仍拦 | file 模式指向 status.json | exit 2 |

运行：`node scripts/tests/code-guard.test.mjs`。
