# 设计 — REQ-20260908-007 提供终端可直接运行的 shell 命令

> 由批次实施 Agent 补充（batch-20260908-012 · run-20260908-066）。

## 背景

- 终端操作看板的唯一入口是 `node <插件>/scripts/atb.mjs …`：插件根路径随安装方式变化
  （本机 `~/.zcode/cli/plugins/cache/personal/agent-team-board/0.1.0` 是指向源码仓库的软链），
  长命令难记难敲；README「人工入口」（接受/确认完成/驳回）因此体验差。
- 插件是纯 Node 零依赖 CLI，天然适合加一层薄 shell 包装器 + 符号链接安装。

## 方案

### 1. `bin/atb` POSIX shell 包装器（新文件）

- `#!/bin/sh` 脚本，职责单一：解析自身真实路径（相对路径先转绝对，再逐层 `readlink`
  穿透符号链接，不依赖 GNU `readlink -f`，macOS BSD readlink 兼容）→ 上跳一层得插件根
  → `exec node "$root/scripts/atb.mjs" "$@"`。
- `$0` 经 PATH 查找调用时即为完整链接路径（kernel execve 语义），循环解析后天然支持
  `~/.local/bin/atb → <插件根>/bin/atb` 的安装形态。
- `node` 不在 PATH 时给出明确错误（含 nodejs.org 提示）退出码 1。
- 符号链接链中每层相对链接也正确拼接（`dirname $script` + 相对目标）。

### 2. `atb cli install|uninstall|status` 子命令（scripts/atb.mjs）

- 新增顶层 `cli` 子命令组，**不调用 `requireDataDir`**（与看板数据无关，任意目录可执行）。
- `install [--to]`：
  - 目标目录旗标用 `--to` 而非 `--dir`：`--dir` 是 atb.mjs 全局旗标（看板项目根选择器），
    在进入子命令分发前就已被剥离并改写 cwd，子命令内拿不到（实施中发现，见实施记录）。
  - 目录解析：显式 `--to` 优先；否则按候选序取第一个「存在 + 在 PATH + 可写」的目录
    （`/usr/local/bin` → `~/.local/bin` → `~/bin`）；再退第一个可写目录；最后创建
    `~/.local/bin` 并提示加入 PATH（给出 zsh/bash 的 export 示例）。
  - 安装动作：`fs.symlinkSync(binPath, link, 'file')`；若 `bin/atb` 无执行位则先 `chmod 755`。
  - 幂等：目标已是「指向本插件 `bin/atb`」的链接 → `= 已安装`，退出 0。
  - 安全：目标存在但非本插件链接（外来文件/指向他处）→ 报错拒绝覆盖，原文件不动，给出
    手动处理指引。
- `uninstall [--to]`：显式 `--to` 时严格校验「是指向本插件 bin/atb 的符号链接」才删除，
  否则拒绝；缺省扫描全部候选目录，只删匹配链接，外来文件跳过；未发现则 `= 未安装` 幂等返回。
- `status`：打印包装器路径与各候选目录状态（已安装 → / 未安装 / 外来文件）+ PATH 提示。
- 「同一路径」判断统一用 `fs.realpathSync` 双侧实化比较（安装侧可能是经插件缓存软链的路径）。
- `os.homedir()` 取家目录；PATH 成员判断用 `path.delimiter` 切分后 `path.resolve` 归一比较。

### 3. 文档同步

- `atb.mjs` 主 USAGE 增加 `cli` 三行用法。
- `skills/agent-team-board/SKILL.md` CLI 速查与「常见错误」人工指引补 `atb cli install`
  （Agent 提示用户安装后，人工状态变更可敲短命令）。
- 插件根 `README.md`：「人工入口」「快速上手」补 `atb cli install` 一步。

### 4. 不改动

- `core.mjs` / `batch.mjs` 等数据层；`server.mjs`；既有子命令行为；钩子。

## 风险与边界

- **POSIX 兼容**：不使用 `readlink -f`（BSD/GNU 差异），只用 `readlink <path>` 单层读取 +
  自行循环；`dirname`/`pwd -P` 均为 POSIX。极端场景（`sh atb` 以文件名直接跑解释器导致 `$0`
  无路径分量）不属安装形态，脚本会因找不到文件由 node 报错，可接受。
- **Windows**：`bin/atb` 为 POSIX 脚本，Windows 原生 cmd/PowerShell 不适用——本插件运行环境为
  macOS/Linux 终端（ZCode 宿主），超范围，README 不承诺。
- **`/usr/local/bin` 可写但属系统目录**：候选序仅在「在 PATH 且可写」时才选它；不可写自动落到
  `~/.local/bin` 并给 PATH 提示，不要求 sudo。
- **外来文件保护**：install/uninstall 对非本插件链接一律拒绝触碰，防误删用户同名命令。
- **幂等性**：install/uninstall/status 均可重复执行，退出码语义稳定（成功/幂等 0，冲突非 0）。

## 实施记录

- TDD：新增 `scripts/tests/cli-shell.test.mjs`（T1–T12），先跑红（10 红；T7/T9 因 `cli` 未知命令
  天然非 0 暂过）再实现跑绿（12/12 绿）。
- 新增 `bin/atb`（POSIX sh，755）：`$0` 转绝对 → 循环 `readlink` 穿透符号链接 →
  `cd .. && pwd -P` 取插件根 → `exec node "$root/scripts/atb.mjs" "$@"`；node 缺失时明确报错。
- `scripts/atb.mjs`：新增 `cli` 子命令组（install/uninstall/status，置于 `serve` 之后分发），
  不调用 `requireDataDir`；新增 `import os`；主 USAGE 补三行用法。
  - 关键修正：目标目录旗标最初用 `--dir`，实施中发现它是 atb.mjs **全局**旗标（项目根选择器，
    入口处剥离并改写 cwd），子命令内永远拿不到且语义被劫持（`cli install --dir X` 实际把 X 当
    项目根、安装落到自动候选目录）——改为 `--to` 并在 CLI_USAGE 注明两者语义差异。
  - 「指向本插件」判断：`fs.realpathSync` 双侧实化比较；install/uninstall 对外来文件一律拒绝；
    幂等路径退出 0（`= 已安装` / `= 未安装`）。
- `skills/agent-team-board/SKILL.md`：CLI 速查补 `$ATB cli install|uninstall|status` 两行；
  「常见错误」表补「终端嫌 node 全路径太长 → cli install」一行。
- 插件根 `README.md`：「人工入口」补 cli install 短命令；「目录结构」补 `bin/atb`；
  「快速上手」插入可选第 1 步（安装终端命令），后续步骤编号顺延。
- 回归：`npm test`（run-all.mjs）80 个测试文件失败 0（含新增 cli-shell.test.mjs）。
- 调试副作用清理：手工调试时曾按自动候选目录把链接装入 `/usr/local/bin`，已用
  `cli uninstall` 移除，用户机器保持未安装原状（是否安装由用户自行决定）。
