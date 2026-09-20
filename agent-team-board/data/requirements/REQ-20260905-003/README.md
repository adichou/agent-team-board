# REQ-20260905-003 Status Board 默认端口改为 8888

- 状态：in-progress（已认领 zcode-port-8888，待人工确认完成）
- 创建：2026-09-05T08:12:46.705Z

## 描述

动机：用户希望用好记的 8888 替代 7736。范围：
1) scripts/server.mjs 默认端口 7736→8888，文件头注释与 EADDRINUSE 提示文案同步（示例端口改用动态 PORT 表达），保留 ATB_PORT 环境变量覆盖能力不变。
2) 同步所有默认端口引用点：electron/main.mjs、electron/service.mjs（REQ-20260905-001 产物，需与该需求协调）、scripts/state-guard.mjs、scripts/atb.mjs、commands/board.md、skills/agent-team-board/SKILL.md、README.md、.zcode-plugin/plugin.json、.codex-plugin/plugin.json；相关测试（serve/multi-project/traceability/dispatch-launch 等）断言同步更新。
3) 兼容性：本地工具无迁移义务，正在运行的旧实例重启后即用新端口；前端全为相对路径不受影响。
验收：不设 ATB_PORT 启动时 /api/health 返回 port=8888；ATB_PORT=7737 仍可覆盖；启动横幅、错误提示与全部文档无 7736 残留（看板历史记录除外）；npm test 全绿。

## 验收标准

- [x] 不设 ATB_PORT 启动时 `/api/health` 返回 `port=8888`（集成用例实际验证）
- [x] `ATB_PORT=7737` 仍可覆盖（集成用例实际验证）
- [x] 启动横幅、错误提示与全部文档无 7736 残留（看板历史记录除外；有意保留：state-guard 旧端口兼容启发式、测试断言文案）
- [x] npm test 全绿（新增 test 入口，18 个测试文件 0 失败）
