# 设计 — REQ-20260910-004 StatusBoard 命令优先以提示词中提及的项目来打开看板，若提示词中没有项目再根据左侧项目栏的项目来打开卡板

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`/board` 命令（`commands/board.md`）与 skill 的 Status Board 流程（`skills/agent-team-board/SKILL.md`）
此前固定打开当前会话项目：探测服务 → 后台拉起 → 打开 `?project=<会话项目根>`，命令文档写明
「无需参数」。Status Board 已是单服务多项目（`?project=` 决定数据源、注册表 + 项目切换器兜底），
但用户在提示词中点名其他项目时命令不解析，只能到顶栏手动切换。

## 方案

**纯提示词文档改动（自研，无新增依赖）**：目标项目解析逻辑由执行 `/board` 的 Agent 按文档执行，
不改 server / 前端 / CLI 代码。改动两个文件：

1. `commands/board.md`：
   - frontmatter `argument-hint: [项目名或项目路径]（可选，不填打开当前会话项目）`，删除「无需参数」；
   - 正文写明两级优先级：① 提示词（命令参数或用户消息）提及的项目优先（即使会话位于另一项目）；
     ② 未提及时按左侧项目栏当前会话所属项目兜底（现状不变：git root / 含 `docs/agent-team-board/`
     的目录 / cwd 兜底）；
   - 解析规则（置于打开流程之前，流程扩为 5 步，新增第 3 步「解析目标项目」）：
     - **绝对路径**（含 `~` 展开）：目录存在即用，沿用服务端 `?project=` 既有校验与首访自动登记
       （server.mjs `resolveProject` → `registerProject`，行为零改动）；
     - **项目名**：与 `/api/health` 响应的 `projects`（注册表 `~/.agent-team-board/projects.json`）
       各路径**末段**（basename）做**忽略大小写**匹配，**唯一命中**才用；不支持中间路径片段；
     - **解析失败**（路径不存在 / 无命中 / 多个同名项目 / 同时提及多个项目）：不打开猜测项目，
       会话内说明原因并列出已知项目（含完整路径）请用户澄清后再继续；
     - 探测服务（第 1 步）顺带留存 `projects` 与 `defaultProject` 供解析；
     - 目标项目未 `atb init` 时打开不报错（既有空态 + 「初始化」按钮）。
2. `skills/agent-team-board/SKILL.md` Status Board 节同步：开头补「目标项目两级优先级」说明，
   流程 4 步扩为 5 步（新增第 3 步解析），措辞与 board.md 一致但保持精简。

**README「待确认」项决策（design 落定）**：

| 待确认项 | 决策 |
| -------- | ---- |
| 提示词提及多个项目 | 列出候选请用户澄清确认，不取第一个 |
| 是否新增 `atb projects` CLI | 不新增：沿用 `/api/health` 一次拿全 `projects` + `defaultProject`（探测服务本就是流程第一步，注册表即已知项目事实源，避免为文档型需求扩代码面） |
| 项目名匹配口径 | 仅路径末段（basename）全等、忽略大小写（贴近 macOS 文件系统默认行为；匹配对象是注册表内字符串，打开的是注册表原路径，大小写敏感文件系统上亦无错开风险）；不支持中间路径片段 |
| 「左侧项目栏」等价口径 | 维持 README 口径：Agent 侧等价实现 = 当前会话项目根探测（git root / 含 `docs/agent-team-board/` 的目录，兜底 cwd），即现状行为，本条目按此实施 |

**开源选型（REQ-20260909-015）**：自研（无合适库）——改动对象是 Agent 提示词文档（Markdown），
不涉及运行时代码逻辑，无可复用的开源库；未引入任何依赖，不创建 licenses.md。

**影响面**：仅 `commands/board.md` 与 `skills/agent-team-board/SKILL.md` 两个文档；server / 前端 /
CLI / hooks 零改动，`?project=` 校验、注册表登记、`defaultProject`、页面启动定位顺序
（URL 深链 > 上次选择 > 默认项目）均保持既有行为。

## 实施记录

- TDD：先补 test-cases.md（B1–B10）→ 新增 `scripts/tests/board-project-hint-20260910-004.test.mjs`
  静态契约测试跑红（B1–B5/B8/B9 红）→ 改两份文档跑绿（B1–B9 全过）。
- 回归：涉及 board.md / SKILL.md 的既有测试（traceability R6、default-port V4、multi-project M8 等
  12 个）全过；全量 `npm test` 132 个测试文件失败 0。

## 风险与边界

- 注册表只含访问过的项目：用户提到的项目名未注册时不猜测，引导澄清或提供绝对路径——属预期交互，
  与验收标准一致。
- 忽略大小写匹配 basename 不改变打开路径（取注册表原路径），无大小写敏感文件系统错开风险。
- 文档型需求，解析行为由 Agent 执行提示词承载：静态契约测试守护措辞要点，防规则漂移回潮。
