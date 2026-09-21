# 设计 — REQ-20260920-004 提供命令模块，提供 atb 所有命令的界面按钮下发

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板（scripts/server.mjs + scripts/web/）此前没有任何通用命令入口：各界面操作分别走专用端点
（/api/init、/api/batch/*、/api/git/* 等），`migrate`、`rebuild`、`pack`、`prune-locks`、
`commit which` 等命令只能去终端执行。本单在看板新增「命令」模块，把 `atb` CLI 的命令面以按钮
形式分组呈现并经服务端白名单下发同一 CLI 入口。

## 方案

### 1. 命令注册表 scripts/lib/cli-registry.mjs（唯一事实源，测试校验同步）

命令清单采用**集中注册表**而非 help 文本解析：`CLI_GROUPS` 按分组声明每条命令
`{ name, desc, args[], options, danger, disabled, long, needsBoard, serve }`（说明取自 CLI help
语义；命令名/参数保持 CLI 原文不翻译）。选择注册表而非解析 `atb help` 输出的理由：help 文本
面向人读（折行、含说明散文），解析脆弱；注册表是结构化数据，服务端白名单校验与前端表单渲染
可直接消费，同步性由测试兜底（见测试 C1：注册表命令与 atb.mjs 实际命令面双向比对）。

- 恒定排除 Oncall 咨询（oncall）、讨论（disc）、增长（growth）三组：`EXCLUDED_PREFIXES`
  显式声明 + 测试断言这三组前缀在注册表产物中恒不出现。
- 「发布文档 AI 总结」组（`summary start|file|done|fail|show`，REQ-20260921-008 新增）纳入注册表：
  README「已核实的现状与范围」清单成文早于该命令组上线，而验收标准要求「覆盖 `atb help` 全部分组、
  无遗漏、分组结构与 help 一致」——以验收标准为准（该组不在排除三组内），且符合本模块「为后续新增
  通用 CLI 命令提供统一入口」的定位。同步性由测试 C1a 双向比对兜底（再新增命令组时测试变红提示补录）。
- 分组名沿用 REQ-20260913-005 文案口径：batch 组显示「AI 开发」、refine 组显示「AI 分析」
  （用户可见文案不回流旧词「批量开发 / 批量完善」）。
- 高危清单（二次确认）：`delete` / `status` / `batch delete` / `refine abort` / `migrate` /
  `rebuild` / `prune-locks` / `pack`（README 验收下限全集）；`serve` 仅影响告知不列入。
- 禁用清单（界面不提供执行、指引终端）：`cli install` / `cli uninstall` / `cli status`。
- `needsBoard`：CLI 内部 requireDataDir 的命令（条目 / 批量 / 回执 / 决策 / 确认 / 完善 / 查询
  组），前端对未初始化项目渲染初始化引导；`init` / `migrate` / `pack` / `serve` / `cli` 不依赖。
- 校验入口 `validateRunRequest({ command, args })`：命令名必须精确命中注册表（白名单，
  未注册一律拒绝）；`args` 必须是字符串数组；args 内出现 `--dir` 拒绝（项目根由服务端强制
  注入，防篡改下发目标）；disabled 命令拒绝执行（白名单内也不可下发）。

### 2. 服务端（scripts/server.mjs 新增 3 个端点）

- `GET /api/cli/commands`（不绑定项目）：返回 `{ groups }` 注册表序列化（分组 + 命令 + 参数
  元数据），前端清单唯一来源，杜绝前端手抄清单漂移。
- `POST /api/cli/run?project=<项目根>`：白名单校验（cli-registry.validateRunRequest）→
  同一项目同一时间仅一个命令在途（per-root 内存互斥，在途再下发 409）→ 异步
  `spawn(process.execPath, [ATB_CLI_ABS, ...命令token, ...args, '--dir', root], { cwd: root })`
  ——**参数逐个数组传递、不经 shell 字符串拼接**，本模块不构成任意命令执行通道 → 立即返回
  `{ runId }`（长耗时命令不阻塞看板轮询）。stdout / stderr 各上限 512 KiB（超限截断并标记）。
- `GET /api/cli/run-status?project=`：返回该项目在途 / 最近一次执行的完整结果
  （running、exitCode、signal、stdout、stderr、durationMs、truncated）。执行记录仅存内存
  （会话内口径，README「待确认」留存范围裁定前不落盘）；服务重启丢失时前端把在途判为
  「结果未知」失败态，不悬挂「执行中」。`serve` 触发服务自动重启导致响应丢失 / 断连为预期，
  前端按「服务重启中，稍后自动恢复」呈现并经既有轮询自动恢复。

状态铁律不变：本端点是人工入口，执行 `status <ID> accepted|done`、`hold answer/resume` 等
人工专属命令等同人工在终端执行；Agent 侧 PreToolUse 状态守卫与认领锁不因本模块放宽。

### 3. 前端 scripts/web/commands.js（挂 window.ATBCommands，对齐 build.js 模块模式）

- 顶栏「命令」页签插在「任务」与「设置」之间（index.html .module-nav）；
  `#commandsView` 容器动态渲染于 commands.js；app.js 最小接线（VIEWS + setView 联动 +
  MODULE_SUB + 全局搜索框隐藏 + `/` 快捷键聚焦模块内搜索框）。
- 布局参考需求模块纵向档位形态：左缘竖排页签（writing-mode: vertical-rl）分「最近执行」（前
  且默认）与「全部命令」；「全部命令」内为搜索框（`/` 聚焦）+ 按 CLI 分组平铺的命令按钮
  （命令名保留英文原文，高危带「需确认」文字标识、serve 带「影响提示」、禁用带「终端执行」）。
- 右侧详情：用途说明（取自注册表 desc）→ 参数表单（位置参数逐项 + 附加参数输入，必填缺失
  就近提示并禁用执行）→ 等宽命令预览（随参数实时更新，含 `--dir` 项目根）→ serve 影响告知 /
  cli 终端指引（无执行入口）→ 执行按钮 → 输出区（stdout / stderr 分区、退出码、耗时、复制）。
- 执行流：高危先弹确认框（完整命令 + 影响说明，取消回表单且参数保留）→ POST /api/cli/run →
  轮询 run-status（1s）→ 完成回显；失败可就地重试（同命令同参数，表单不丢）。
- 右侧下方执行历史：会话内最近 20 次（超 20 自动淘汰最旧、无清空入口、点击回看该次输出）。
- 「最近执行」页签：按命令去重保留最近 10 条，仅成功执行（退出码 0）计入，点击在右侧回填
  该次参数可快速再执行；任何入口执行成功后即时刷新。
- 未初始化项目：needsBoard 命令给初始化引导（回到需求模块初始化卡），不静默报晦涩错误。

### 4. i18n（BUG-20260912-001 口径）

命令名与参数保持 CLI 原文；分组名、命令说明、参数标签、按钮与状态反馈全部中文原文入
scripts/web/i18n.js（静态 EN / 动态 EN_DYNAMIC 插值），动态渲染由既有 MutationObserver 翻译层
接住。测试 C4 扫描 commands.js 源码片段与注册表数据（分组名 / desc / 参数标签）全覆盖。

## 开源选型（REQ-20260909-015）

未引入开源库。理由（无合适库的原因）：本单是「结构化白名单 + spawn 数组传参 + 原生 DOM 渲染」，
核心约束恰是**不引入** shell 解析 / 命令构造类库（参数不经拼接、白名单自持）；列表 / 表单 /
弹窗的既有模块（build.js 等）均为原生 DOM 自研，引入前端命令行组件库反而带来样式与 i18n 接缝。
不创建 licenses.md。

## 风险与边界

- **任意命令执行面收敛**：白名单 = 注册表精确匹配；数组传参不经 shell；`--dir` 由服务端注入
  且用户参数携带 `--dir` 即拒绝；disabled 命令（cli 组）白名单内也拒发。
- **并发**：per-root 单在途互斥（409），不新增跨项目限制；不阻塞看板既有 2s 轮询。
- **执行中断**：子进程被杀以 signal / spawn error 落失败态；服务自身重启丢内存记录时前端
  判「结果未知」，均不悬挂「执行中」。
- **serve 自重启**：响应丢失 / 断连按预期态呈现（提示 + 轮询自动恢复），不算执行失败。
- 既有专用界面零改动；同一命令经本模块与终端执行走同一 CLI 入口，结果一致。
