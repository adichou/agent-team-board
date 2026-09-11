# 测试用例 — REQ-20260910-030 在发布模块中支持将 electron app 构建成 mac app 和 Windows app

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/release-electron.test.mjs`（store / 流水线 / 前端契约，`npm test` 自动聚合）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| E1 | 类型与配置校验：electron 可执行且五阶段；platforms 空或含非法值阻塞；version 非法格式阻塞；outDir 绝对路径 / 含 `..` 阻塞；web/storage 仍不可执行 | P0 | 通过 |
| E2 | 预检只读：干净 Electron 工程预检通过回 draft，且全程零 npm / electron-builder 调用；脏工作区阻塞并引导回提交功能 | P0 | 通过 |
| E3 | 非 Electron 工程预检阻塞：缺 electron-builder 依赖、缺构建配置（无 build 字段与配置文件）、main 入口缺失分别给指引；不触发依赖安装与构建 | P0 | 通过 |
| E4 | node / npm 不可用 → 预检明确阻塞 | P0 | 通过 |
| E5 | 全流程成功：隔离 worktree 安装依赖（有 lock 用 npm ci）→ 逐平台构建 → 产物核验记录 路径 / 大小 / SHA-256 / 源提交 OID / electron 与 electron-builder 版本 / signed:false；日志脱敏落盘；worktree 清理；标成功 | P0 | 通过 |
| E6 | 平台多选逐平台成败：mac 成功 win 失败 → 整体 failed、build 阶段失败并摘录报错原文，mac 平台结果保留（不以部分产物冒充全部成功）；预检只勾 mac 时只构建 mac | P0 | 通过 |
| E7 | 失败重试只重跑未完成阶段：build 失败重试后 deps-install 不重装（npm 安装命令仅一次） | P0 | 通过 |
| E8 | 取消后续阶段：已完成阶段与证据保留，pending 置 canceled | P1 | 通过 |
| E9 | 同目标互斥：electron 活动运行占互斥（409 口径），git / apple 目标不受影响；非活动状态不占 | P0 | 通过 |
| E10 | 服务重启：running 的 electron 运行标记 interrupted（可重试），已完成阶段不动 | P1 | 通过 |
| E11 | 源提交变化使计划失效：build 阶段复核 HEAD ≠ 冻结 OID → plan-stale 阻塞 | P1 | 通过 |
| E12 | 产物核验失败明确：构建声称成功但产物缺失 → verify 阶段 artifact-missing 失败 | P0 | 通过 |
| U1 | 前端类型表：TARGETS 含桌面应用（Electron）；新建面板选 electron 渲染平台多选 / 架构 / 版本 / 输出目录字段；web/storage 仍置灰「首期未开放」 | P0 | 通过 |
| U2 | 前端计划确认：electron 预检通过后启动需经计划弹层（平台 / 版本 / 输出目录 / 未签名提示），确认前不调 start | P0 | 通过 |
| U3 | 前端产物页签：electron 运行逐产物展示文件名 / 平台架构 / 大小 / SHA-256 截断 / 源提交 / 工具版本 / 未签名标注 | P0 | 通过 |
| S1 | 静态契约：package.json 含 electron-builder `build` 配置（appId / mac dmg / win nsis / asarUnpack scripts）；style.css 有 `.chip.electron` 配色；ui-demo.html 离线（无外部资源）且覆盖 平台多选 / 预检 / 计划确认 / 阶段推进 / 失败重试 / 取消 / 互斥 / 空 / 加载 / 失败态 / 未签名 | P0 | 通过 |
