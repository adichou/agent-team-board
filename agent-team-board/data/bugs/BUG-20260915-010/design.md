# 设计 — BUG-20260915-010 需求或 bug 详情中的说明文档的讨论按钮生成的提示词最后没有换行

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源（按链路归因，编号均经 `atb list` 核验存在、状态 done）：
  - `scripts/lib/req-disc-store.mjs` 的 `buildStartPrompt` / `buildFinishPrompt`：**REQ-20260909-003**（落地「文档讨论」区块与启动/收尾提示词，两函数自引入起即以 `].join('\n')` 返回、末尾无换行）。
  - `scripts/lib/oncall-store.mjs` 的 `buildStartPrompt` / `buildFinishPrompt`：**REQ-20260909-004**（开放式讨论模块重构，`discussion-store.test.mjs` S1~S8 即覆盖两提示词，同口径 `join('\n')`）。
  - `scripts/lib/oncall-store.mjs` 的 `buildContinuePrompt` / `buildOrganizePrompt`：**REQ-20260910-018**（跨会话续聊新增继续 / 整理结论提示词，沿用同一组装口径）。
- 右键「💬 讨论」链路（`buildDocRef`）的同类缺陷由 BUG-20260914-019 已修复，非本单引入来源；本单承接其在 design.md「范围边界（待确认）」中声明的 req-disc / oncall 遗留缺口。

## 根因分析

六个提示词组装函数（req-disc 两函数 + oncall 四函数）均以 `].join('\n')` 返回——join 只在行间插入分隔符，最后一行之后即字符串结尾，末尾无换行。提示词的标准用法是「复制 → 粘贴到 Agent 会话输入框 → 紧接着输入自己的问题」：粘贴后光标停在末行行尾（req-disc 末行「…半成品不会被读取。」/「…不要改变需求状态。」；oncall 对应各自末行），用户直接键入的问题与末行连排同一行，无明确换行分隔。前端「复制内容」按钮（`scripts/web/req-disc.js` 约 293 行 `copyPlain(ta.value)`；`scripts/web/oncall.js` 约 517 / 527 行复制 `continuePrompt` 与启动 / 整理提示词）与自动复制失败时的手工复制（textarea 只读全选）承载的都是服务端同一组装结果——一处根因，六处链路全部无末尾换行。

## 方案

六个函数返回值改为 `].join('\n') + '\n'`：末尾恰追加一个换行符，其余内容一字不变。用户粘贴后光标已在新行，直接输入的问题与提示词有明确换行分隔；前端 textarea / `copyPlain` 主路径与手工复制回退消费同一文本，自动带上末尾换行，前端零改动。

范围说明（README「待确认」项的处置）：README 期望行为点名 req-disc 两函数与 oncall「同名两函数」（start/finish，建议一并修复）；oncall 的继续（`buildContinuePrompt`）/ 整理结论（`buildOrganizePrompt`）提示词同为「讨论」入口复制到 Agent 会话的提示词（oncall.js 复制入口与 `discussionFull` 均直接暴露），按「**所有**『讨论』入口生成并复制到剪贴板的提示词末尾恰追加一个换行」的期望与「以免恢复入口后再次登记同类 Bug」的追认口径一并纳入，同口径同一行改动，人工验收时可复核。

测试（TDD）：`scripts/tests/req-disc-store.test.mjs` 追加 D2b、`scripts/tests/discussion-prompt-commit-20260914-003.test.mjs` 追加 P8——断言各提示词 `endsWith('\n')` 且不以 `'\n\n'` 结尾、开头不加换行、末行内容保持不变；先跑红（现状无末尾换行）再实现跑绿。既有断言均为 `includes` / `match` 口径，不受末尾换行影响；全量 `node scripts/tests/run-all.mjs` 回归通过（247 个测试文件，含右键链路 T7 / T9 零回归）。

**开源选型（REQ-20260909-015）**：未引入开源库——改动为六处单行字符串拼接（各追加一个 `'\n'`），无成熟库适用场景，自研成本低于任何引入成本；不创建 licenses.md。

## 风险与边界

- 只追加**一个**换行：不以 `'\n\n'` 结尾（避免粘贴后空行）、不在开头 / 中间加空行；提示词其余内容一字不变（测试断言末行内容不变）。
- 前端零改动、交互零回退：复制按钮 / `copyPlain` 双回退 / textarea 手工全选复制 / toast 文案 / 讨论状态机与轮询行为均不动，仅文本末尾多一个换行。
- 右键「💬 讨论」链路（BUG-20260914-019 修复口径）不回退：T7 / T9 继续通过。
- 纯服务端提示词文本改动：无 API 变化、无状态机 / 样式变化；多出的末尾换行对 Agent 输入框 / 文本编辑器为常规段落分隔，无已知副作用。
