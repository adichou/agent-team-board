# 设计 — REQ-20260905-003 Status Board 默认端口改为 8888

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

默认端口 7736 不好记，用户希望换成好记的 8888。改动面是「默认值」而非监听逻辑：`ATB_PORT` 环境变量与 `--port` 参数的覆盖链路保持不变。

## 方案

**改动点（默认端口 7736 → 8888）：**

| 文件 | 改动 |
| ---- | ---- |
| `scripts/server.mjs` | `ATB_PORT \|\| 8888`；头注释同步；EADDRINUSE 换端口示例改为动态 `ATB_PORT=${PORT + 1}`（原硬编码 7737） |
| `scripts/atb.mjs` | `serve` 子命令缺省端口 8888 |
| `electron/main.mjs`、`electron/service.mjs` | 桌面壳缺省端口 8888（REQ-20260905-001 产物，本条目一并同步） |
| `scripts/state-guard.mjs` | 人工 API 拦截启发式端口正则 `7736` → `(7736\|8888)`：识别新端口，**保留 7736** 以兼容仍在运行的旧实例 |
| 文档/清单 | README.md、commands/board.md、skills/agent-team-board/SKILL.md（4 处，含简介行）、两个 plugin.json 全部换 8888 |
| 测试同步 | traceability.test.mjs 的 board.md 断言、dispatch-launch.test.mjs 注释 |

**新增：**

- `scripts/tests/default-port.test.mjs`：8 用例（静态契约 5 + 集成 2 + npm test 入口 1）。
- `scripts/tests/run-all.mjs` + package.json `test` script：验收要求「npm test 全绿」，原仓库无 test 入口，补一个顺序执行全部 `*.test.mjs` 的聚合脚本（任一失败非零退出）。

## 风险与边界

- **兼容性**：无迁移义务。旧实例（7736）重启后即用 8888；正在运行的旧实例不受影响，前端全相对路径。
- **8888 被占**：属普通 EADDRINUSE，提示文案给出 `ATB_PORT=${PORT + 1}` 示例；集成用例遇 8888 被占会跳过并说明（不误报失败）。
- **残留策略**：`\b7736\b` 全仓清零，除两处有意保留——state-guard 的旧端口兼容启发式、default-port 测试自身的断言文案。看板历史记录（status.json）不在清理范围。
- **安装缓存**：`~/.zcode/cli/plugins/cache/...` 下的已安装副本由插件系统管理，不在本仓库改动范围，重装/刷新插件后生效。
- **协调**：electron/ 两文件属 REQ-20260905-001（进行中），本次仅改缺省端口数值一行，不碰其结构；如该会话并行改动，合并时以「默认 8888」为准。
