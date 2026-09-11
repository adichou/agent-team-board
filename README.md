# Agent Team Board（智能体团队看板）

ZCode 插件：需求 / Bug 的文件化管理 + Agent TDD 开发流程 + 本地网页状态板。

## 三栏定位

| 栏 | 载体 | 本插件职责 |
| -- | ---- | ---------- |
| Project Board | ZCode 自带项目/会话列表 | 不改 UI，靠「文件为事实源」+ skill 调度规则 |
| Discussion Board | 聊天窗口 + 命令 | `/req` `/bug` `/dev` `/board` 四个命令 + skill 行为规范 |
| Status Board | 插件起的本地网页 | 零依赖 Node http 服务（端口 8888），内置浏览器面板打开 |

## 人机分工（核心机制）

状态机单向流转，**accepted / done 仅限人工**，由 PreToolUse 钩子确定性拦截 Agent 越权：

```
submitted ──人工接受──▶ accepted ──Agent claim──▶ in-progress ──人工确认──▶ done
                                                   ▲                          │
                                                   └──────── 人工驳回完成 ──────┘
```

| 操作 | Agent | 人工 |
| ---- | ----- | ---- |
| 创建需求 / Bug（submitted） | ✅ `/req` `/bug` | ✅ 看板表单 |
| 接受（→ accepted） | ⛔ 钩子拦截 | ✅ 看板 / 终端 |
| 认领（→ in-progress，原子锁） | ✅ `/dev`、`atb claim` | — |
| 上报测试报告（待测试） | ✅ `atb report` | 查看 |
| 确认完成（→ done） | ⛔ 钩子拦截 | ✅ 看板 / 终端 |
| 驳回完成（done → in-progress） | ⛔ | ✅ 看板 / 终端 |

人工入口只有两个：Status Board 按钮，或用户终端执行
`node <本插件>/scripts/atb.mjs status <ID> accepted|done`。
嫌长命令难敲可安装终端命令（一次即可，REQ-20260908-007）：
`node <本插件>/scripts/atb.mjs cli install` 之后终端直接敲 `atb status <ID> accepted|done`。

## 数据目录（事实源，随项目进 git）

```
docs/agent-team-board/
├── config.json                          # 按日重置的全局计数器
├── requirements/REQ-YYYYMMDD-NNN/       # README / design / test-cases / test-report / status.json
│   └── bugs/BUG-YYYYMMDD-NNN/           # 归属需求的 Bug
└── bugs/BUG-YYYYMMDD-NNN/               # 独立 Bug
```

机器读写 `status.json`（只能经 `atb` 工具），人读写 markdown。

## 目录结构

```
agent-team-board/
├── .zcode-plugin/plugin.json     # ZCode manifest（displayName：智能体团队看板）
├── .codex-plugin/plugin.json     # Codex 兼容 manifest（仅 skills；Codex 无命令/钩子）
├── skills/agent-team-board/SKILL.md
├── commands/{req,bug,dev,board}.md
├── hooks/hooks.json              # 两条 PreToolUse 状态守卫
├── bin/atb                       # 终端命令包装器（atb cli install 符号链接到 PATH）
└── scripts/
    ├── lib/core.mjs              # 数据层：状态机、编号、原子锁（CLI 与 server 共用）
    ├── atb.mjs                   # CLI
    ├── server.mjs                # Status Board 服务（端口 8888）
    ├── state-guard.mjs           # 钩子脚本
    └── web/                      # 单页看板 + vendored marked.min.js (MIT)
```

## 安装

把本目录复制或软链到 `~/plugins/agent-team-board`（或在 marketplace 中登记为本地插件），
重启会话后在 ZCode 中即可使用 `/req` `/bug` `/dev` `/board`。

## 快速上手

1. （可选，推荐）安装终端命令：`node ~/plugins/agent-team-board/scripts/atb.mjs cli install`，
   之后终端直接敲 `atb …`（下面步骤的 `node ~/plugins/agent-team-board/scripts/atb.mjs` 均可简写为 `atb`）。
2. 项目里任一会话执行 `node ~/plugins/agent-team-board/scripts/atb.mjs init`（或在看板网页上初始化）。
3. `/req 支持登录 Passkey` → 得到 `REQ-YYYYMMDD-001`（submitted）。
4. `/board` 打开 Status Board，点「接受」。
5. `/dev next` → Agent 认领、TDD 开发、`atb report` 上报覆盖率。
6. 看板上看到「待测试」标记 → 测试通过后点「确认完成」。

## 约束说明

- 内置浏览器面板仅接受 http/https，因此 Status Board 用本地 server 而非静态 HTML。
- 插件不渲染自定义 GUI，看板是标准网页。
- 并行防冲突：`atb claim` 用 `O_EXCL` 原子锁 + owner 会话号；锁 24 小时自动过期。
