# 实施记录 — BUG-20260903-004

## 根因

REQ-20260903-001 取消对齐闸门、回退单阶段（accepted → in-progress，claim 即实施）时，
`core.claim` 的状态流转已同步更新，但两处用户可见文案没有跟着改：

1. `scripts/atb.mjs:147` claim 成功提示仍硬编码「状态待对齐——请出实现方案并等人工对齐确认」。
2. `scripts/server.mjs:313` 网页端对 accepted 条目流转的 403 提示仍引导「点对齐确认」，
   而该按钮已随对齐流程取消（`web/app.js` 已无对齐按钮，见 pending-alignment R5）。

另 `scripts/web/style.css:617` 残留「待对齐列」空注释（无任何规则），一并清除。

## 修复方案

1. **atb.mjs**：成功提示改为按 `core.claim` 返回的实际状态分支——
   - 主路径（accepted → in-progress）：`✓ 已认领 <ID>（owner: …，状态 in-progress，可直接实施）`；
   - 存量续认（pending-alignment / in-progress 同 owner 补锁）：如实提示当前状态，
     pending-alignment 附「需人工放行」指引，不谎报可直接实施。
2. **server.mjs**：403 提示改为「网页端不承担认领：accepted 条目请由 Agent 执行 atb claim <ID>（自动进入 in-progress）」，
   与现行流程一致（认领必须走 CLI 以原子锁记录 owner）。
3. **style.css**：删除空残留注释。

不改动状态机、钩子与前端结构（行为面仅文案与注释）。

## 引入来源

- REQ-20260903-001：取消对齐闸门回退单阶段时，CLI 成功提示与 server 403 文案未同步更新。

## 关联残留（本次不改，建议后续清理）

- `skills/agent-team-board/SKILL.md` L77/L81/L95 与 `commands/dev.md` 仍含「阶段一/待对齐/对齐确认」措辞，
  属同一回退遗漏的文档面，建议另行登记处理。
