# 设计 — REQ-20260902-003 提供启动服务的命令行脚本，启动后自动在右侧浏览器面板打开当前项目的链接

> 由 Agent 在 /dev 阶段一补充，人可随时批注。**状态：待对齐（方案初稿，未经人工确认不得实施）。**
> README 描述为空，本方案按标题语义起草，开放点见文末。

## 背景

现在启动看板要么让 Agent 跑 `/board`（会话内），要么手敲 `node …/server.mjs` 再手动开浏览器。缺一个独立于会话的一键启动脚本：起服务 + 自动打开当前项目的看板链接。

## 方案（初稿，待对齐）

新增 `scripts/serve.sh`（可执行，零依赖 bash）+ `atb serve` 子命令二选一——**推荐 atb 子命令**（跨平台、复用 core 解析，无 shell 兼容问题）：

```
atb serve [--port 7736] [--open]
```

行为：
1. 先探活 `http://127.0.0.1:<port>/api/health`——已运行则不重复起（复用现有实例）；
2. 未运行：以**脱离会话的后台方式**启动 `server.mjs`（POSIX setsid/nohup 落地日志到 `/tmp/agent-team-board.log`；Windows 降级 `start /b`，非目标平台仅提示）；
3. 等健康检查通过（≤5s）；
4. `--open` 时打开看板：macOS `open <url>`，Linux `xdg-open`；URL 带 `?project=<cwd 解析的项目根>`。
5. 输出：服务地址、数据目录、PID、日志路径。

**「右侧浏览器面板」的边界**（重要）：ZCode 的内置浏览器面板（IAB）只能由**会话内的 Agent**（browser-use）打开，纯命令行脚本无法触达——脚本 `--open` 打开的是**系统默认浏览器**。要在右侧面板看，仍需在 ZCode 会话里说一声或用 `/board`（会话场景 Agent 已能自动开面板）。本需求交付的是「无会话时的一键启动+系统浏览器打开」；若你期望脚本也能唤起 ZCode 面板，唯一可行路径是 ZCode 提供 URL scheme（当前未证实存在，见开放点 1）。

## 影响面

`scripts/atb.mjs`（新增 serve 子命令，~60 行）；`scripts/lib/core.mjs` 不动（探活用 node:http 内联）；README/SKILL 速查补一行；新增测试（serve 契约：--help、探活复用逻辑——真实起停服务的集成测试标 P1，避免端口冲突脆弱性）。

## 风险与边界

- 后台进程生命周期：setsid 脱离后由用户手动停（`atb serve --stop` 提供，或 kill PID）；重启机器需重跑。
- 端口占用：沿用 server 现有 EADDRINUSE 提示。
- Windows：bash/setsid 不可用，仅打印手动启动指引（非目标平台）。

## 待对齐确认点

1. 「右侧面板」边界接受吗？（脚本=系统浏览器；会话内右侧面板仍走 /board）
2. 形态选 `atb serve` 子命令（推荐）还是独立 `serve.sh`？
3. 需要 `--stop` 停止子命令吗？
