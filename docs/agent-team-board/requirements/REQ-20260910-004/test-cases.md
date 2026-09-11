# 测试用例 — REQ-20260910-004 StatusBoard 命令优先以提示词中提及的项目来打开看板，若提示词中没有项目再根据左侧项目栏的项目来打开卡板

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | board.md `argument-hint` 接受可选项目参数，全文不再出现「无需参数」 | 高 | 通过 |
| B2 | board.md 写明两级解析优先级：提示词提及的项目优先 > 左侧项目栏当前会话所属项目兜底 | 高 | 通过 |
| B3 | 绝对路径规则：含 `~` 展开、目录存在即用、沿用 `?project=` 服务端校验与首访登记 | 高 | 通过 |
| B4 | 项目名规则：与 `/api/health` 返回的 `projects`（注册表）路径末段匹配、忽略大小写、唯一命中才用 | 高 | 通过 |
| B5 | 解析失败（路径不存在 / 无命中 / 同名歧义 / 提及多个项目）：不打开猜测项目，向用户列出已知项目（含完整路径）请确认 | 高 | 通过 |
| B6 | 提示词未提及项目时与现状一致：git root / 含 `docs/agent-team-board/` 的目录 / cwd 兜底 | 高 | 通过 |
| B7 | 既有步骤不回归：探测 `/api/health`、后台拉起（/tmp/agent-team-board.log）、`?project=<encodeURIComponent(...)>` 打开、告知人工操作且不替用户执行 accepted/done | 高 | 通过 |
| B8 | SKILL.md Status Board 节同步两级优先级与解析规则（仍含 8888 与 `?project=`） | 高 | 通过 |
| B9 | 目标项目未 `atb init`：打开不报错，展示既有空态与「初始化」引导 | 中 | 通过 |
| B10 | 多项目无回归：`?project=` 校验 / 注册表登记 / `defaultProject` / 页面启动定位顺序由既有测试集守护（multi-project / default-port / traceability） | 中 | 通过 |

实现方式：B1–B9 为新增静态契约测试 `scripts/tests/board-project-hint-20260910-004.test.mjs`（对 `commands/board.md` 与 `skills/agent-team-board/SKILL.md` 做正则断言）；B10 跑既有测试集验证。
