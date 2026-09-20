# REQ-20260908-007 提供终端可直接运行的 shell 命令

- 状态：accepted（已人工接受，批次实施中）
- 创建：2026-09-08T01:54:25.631Z

## 描述

（本节由实施 Agent 按标题补全，批次接受时描述未填；接受即视为设计认可。）

目前终端操作看板必须敲完整长命令 `node <插件路径>/scripts/atb.mjs <子命令> …`：
路径长、随安装方式变化（本机软链、marketplace 缓存路径各不相同），README 的「人工入口」
（接受 / 确认完成 / 驳回）也因此难用。本需求提供**终端可直接运行的 `atb` shell 命令**：

1. **`bin/atb` POSIX shell 包装器**（随插件分发）：定位自身所属插件根目录（穿透符号链接），
   转交 `node <插件根>/scripts/atb.mjs "$@"` 执行——所有子命令、参数原样透传。
2. **`atb cli install [--to <目录>]`**：在目标目录创建指向 `bin/atb` 的符号链接，一次安装后
   终端直接敲 `atb list`、`atb status REQ-… done`。缺省目录自动选择：PATH 中可写的
   `/usr/local/bin` → `~/.local/bin` → `~/bin`；都不可用时创建 `~/.local/bin` 并提示加入 PATH。
   已安装则幂等返回；目标位置已有外来文件则拒绝覆盖并给出手动处理指引。
3. **`atb cli uninstall [--to <目录>]`**：仅删除指向本插件 `bin/atb` 的链接（外来文件拒绝删除，
   未安装幂等返回）。
4. **`atb cli status`**：展示包装器位置、各候选目录的安装状态与 PATH 提示。

`cli` 子命令不依赖项目看板数据目录（不需要先 `atb init`），可在任意目录执行。
同步更新 USAGE、SKILL.md CLI 速查与插件 README 的人工入口说明。

## 验收标准

- [ ] 仓库存在可执行 `bin/atb`（POSIX sh），直接运行与经符号链接运行均能转交 atb.mjs
      （`--help` 正常输出，数据子命令参数原样透传）。
- [ ] `atb cli install --to <目录>` 创建符号链接且幂等；已有外来文件时拒绝覆盖、原文件不动。
- [ ] `atb cli uninstall --to <目录>` 仅删除指向本插件的链接；外来文件拒绝删除；未安装幂等。
- [ ] `atb cli status` 正常输出安装状态；cli 子命令无需看板数据目录即可运行。
- [ ] USAGE / SKILL.md / 插件 README 同步出现 `atb cli install` 用法。
- [ ] `npm test` 全量通过（新增测试文件先跑红后跑绿）。
