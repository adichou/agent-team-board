# 测试用例 — REQ-20260910-005 支持项目管理

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

自动化：`node scripts/tests/project-manage-20260910-005.test.mjs`（P1–P14，真实起 server +
临时注册表 + 临时项目目录，方法沿用 multi-project.test.mjs）。P15 为浏览器实测项。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| P1 | preview：存在目录返回 realpath/name/wouldWrite/initialized；相对路径、不存在目录 400 | 高 | pass |
| P2 | preview：子目录（数据目录在上级或 git 根）解析出的 dataDir/wouldWrite 与直接路径一致明示 | 高 | pass |
| P3 | init（body.path）：未初始化目录创建数据 + 登记注册表 + 返回 root/projects；`?project=` 旧签名兼容 | 高 | pass |
| P4 | init 重复执行 400（已有数据不覆盖），报错含已存在的 dataDir | 高 | pass |
| P5 | register + requireInitialized：未初始化目录 400 提示改用初始化；已初始化目录成功 | 高 | pass |
| P6 | register 同一真实路径（含符号链接形态）不产生重复项，返回解析后 root | 高 | pass |
| P7 | remove：已注册项目移出列表、注册表文件同步；项目目录与 docs/agent-team-board 数据保留 | 高 | pass |
| P8 | remove 未注册路径 400；相对路径 400 | 高 | pass |
| P9 | 移出后 health.projects 不再包含；移出当前默认项目后 defaultProject 指向剩余首项 | 高 | pass |
| P10 | 移出后轮询 `?project=<已移出>` 仍 200 可读数据，但不会隐式重新登记（health 不重现） | 高 | pass |
| P11 | 重新导入（register）已移出项目：回到列表、数据与条目状态不变、`removed` 标记清除 | 高 | pass |
| P12 | 移出最后一个项目（含启动目录）：defaultProject=null；/api/board 无参返回 noProject 载荷；其余数据接口 400 引导 | 高 | pass |
| P13 | 静态契约：index.html 含「管理项目」按钮/弹窗骨架；app.js 含移出确认文案、空/相对路径提交前拦截、busy 禁用、无项目空态清理 | 高 | pass |
| P14 | 回归：multi-project.test.mjs（M1–M8）与 run-all 全量通过 | 高 | pass |
| P15 | 浏览器实测：面板四态切换、初始化两步确认、移出当前项目自动切换/末项空态（人工） | 中 | pending |
