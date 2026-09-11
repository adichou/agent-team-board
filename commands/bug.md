---
description: 报告并登记一个新 Bug（BUG）
argument-hint: <Bug 描述>
skills: agent-team-board
---

按 `agent-team-board` skill 的数据规范登记 Bug，Bug 描述取自用户本条输入
（`/bug` 后的参数；未给出则先向用户询问，不要自行编造）：

步骤：

1. 项目尚未初始化时先执行 `node <插件根>/scripts/atb.mjs init`。
2. 提炼一句标题；现象、复现步骤、期望行为放 `--desc`。
3. 执行 `node <插件根>/scripts/atb.mjs new bug "<标题>" --desc "<描述>"`（Bug 一律独立创建，不再支持 `--req` 归属需求）。
4. 回报新编号（形如 BUG-YYYYMMDD-NNN，独立 Bug），提醒用户到 Status Board 确认接受。不要替用户接受。

> 引入来源**不在登记阶段填写**——登记时缺陷通常尚未定位。创建时生成的 design.md 已带「引入来源（源单）」节，
> 可暂空或写「未定位（排查过程：…）」。归因在修复阶段（`/dev`）完成：在 Bug README 开头头部元信息区补写
> `- 引入来源：REQ-… / BUG-… / 未定位（排查过程：…）` 行（「创建」行之前、第一屏即见），详述写入 design.md
> 「引入来源（源单）」节，并遵守 ID 核验与「未定位须附排查过程」规则（见 /dev 流程与 skill 数据规范）。
