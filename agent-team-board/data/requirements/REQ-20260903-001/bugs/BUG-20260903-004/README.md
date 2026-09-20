# BUG-20260903-004 atb claim 成功提示文案残留「待对齐」措辞，误导已取消的对齐闸门流程

- 状态：in-progress（已上报，待人工确认完成）
- 归属需求：REQ-20260903-001
- 创建：2026-09-03T04:12:25.441Z

## 现象

accepted 条目 claim 成功后控制台输出「✓ 已认领 …（owner: …，状态待对齐——请出实现方案并等人工对齐确认）」，而实际状态已是 in-progress（REQ-20260903-001 已取消对齐闸门，accepted → in-progress 直达）。位置：scripts/atb.mjs 约 147 行的成功提示。影响：误导 Agent 等待不存在的人工对齐确认，拖慢 /dev 流程。

同类残留（同一根因，一并修复）：

- `scripts/server.mjs:313`：网页端对 accepted 条目流转的 403 错误提示仍写「…再在本页点『对齐确认』」，而该按钮已随对齐流程取消（前端已无对齐按钮），用户照提示找不到可点的按钮。
- `scripts/web/style.css:617`：「待对齐列」空残留注释（无任何样式规则）。

## 复现步骤

1. 在看板人工接受一个条目（accepted）；
2. 终端执行 `node <插件根>/scripts/atb.mjs claim <ID> --by <会话名>`；
3. 观察成功提示：「状态待对齐——请出实现方案并等人工对齐确认」，与 `atb show <ID>` 显示的实际状态 in-progress 矛盾；
4. （网页端）对 accepted 卡片尝试流转到 in-progress：403 提示引导点已不存在的「对齐确认」按钮。

## 根因分析

REQ-20260903-001 取消对齐闸门、回退单阶段（claim 即实施）时，`lib/core.mjs` 的状态机与前端已同步更新，但两处用户可见文案漏改：CLI 成功提示硬编码旧措辞；server 403 分支的 accepted 提示仍描述已取消的对齐流程。

## 期望行为（验收标准）

- [x] claim 成功提示与实际流转一致：主路径输出「状态 in-progress，可直接实施」，不再出现「待对齐／对齐确认」字样
- [x] 存量 pending-alignment 条目续认时提示如实反映当前状态（不谎报「可直接实施」）
- [x] 网页端 accepted 流转 403 提示引导走 `atb claim <ID>`，不再提「对齐确认」
- [x] 新增 `scripts/tests/claim-msg.test.mjs`（C1–C3）先红后绿；既有 15 套测试回归（唯一失败 default-port.test.mjs 为在途 REQ-20260903-003 的前置红，与本次无关）

## 关联（引入来源）

- 引入来源：REQ-20260903-001（取消对齐闸门回退单阶段时，CLI claim 成功提示与 server 403 文案未同步更新）
