# 测试用例 — REQ-20260908-007 提供终端可直接运行的 shell 命令

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/cli-shell.test.mjs`

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | `bin/atb` 存在、带 shebang、有执行位 | 高 | ✅ |
| T2 | 直接运行 `bin/atb --help`：退出 0，输出 atb 主用法（包装器能定位插件根并转交 node） | 高 | ✅ |
| T3 | 经符号链接运行（临时目录 `ln -s <插件根>/bin/atb tmp/atb` 后执行）：退出 0、输出用法——模拟安装到 PATH 的形态 | 高 | ✅ |
| T4 | 链接形态下参数透传：`tmp/atb new req 标题` 在临时项目中真实创建条目（数据命令可用） | 高 | ✅ |
| T5 | `cli install --to <临时目录>`：退出 0、创建符号链接、realpath 指向本插件 `bin/atb`；链接形态调用 `atb list` 可用 | 高 | ✅ |
| T6 | install 幂等：重复 install 同目录退出 0、输出 `= 已安装` 样式、链接不变 | 中 | ✅ |
| T7 | install 拒绝覆盖外来文件：目标位置预置普通文件 / 指向他处的链接 → 非 0 退出、原文件不动 | 高 | ✅ |
| T8 | `cli uninstall --to <临时目录>`：删除已装链接；再次 uninstall 幂等（退出 0、`= 未安装` 样式） | 中 | ✅ |
| T9 | uninstall 拒绝删外来文件：目标为普通文件 → 非 0 退出、文件保留 | 高 | ✅ |
| T10 | `cli status`：退出 0，输出包装器路径与候选目录状态行（无需看板数据目录，在未 init 的临时目录可运行） | 中 | ✅ |
| T11 | 主 USAGE / SKILL.md 出现 `atb cli install` 用法（帮助文档同步） | 中 | ✅ |
| T12 | `cli` 子命令不需要看板数据目录：在未 init 的临时目录执行 install/status 不因缺数据目录报错 | 中 | ✅ |
