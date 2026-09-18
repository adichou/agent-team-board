# 测试报告 — BUG-20260913-003 bug 单的文档也要支持讨论菜单，参考需求的文档

- 时间：2026-09-13T12:09:36.679Z
- 执行者：zcode-batch-20260913-045-1
- 测试框架：node:assert/strict + vm 静态契约 + run-all
- 覆盖率：100%

## 总结

Bug 单详情抽屉文档页签同口径启用右键「讨论」菜单（复用 REQ-20260909-014 链路）：onDocCtxMenu 类型门槛改 requirement|bug 白名单；docRefPath 增 parent 参按 resolveItemDir 口径拼装真实磁盘路径（独立 bugs/<编号>/、归属 requirements/<REQ>/bugs/<编号>/）。新增测试 7 例并更新既有 T5 断言，npm test 213 文件全过。引入来源 REQ-20260909-014（经 atb list 核验）

## 明细

```
$ node scripts/tests/doc-ctx-discuss-bug-20260913-003.test.mjs（新增）
✓ T1 docRefPath：需求单回归口径不变（<项目根>/docs/agent-team-board/requirements/<单号>/<文档名>）
✓ T1 docRefPath：独立 Bug（parent 为空）→ docs/agent-team-board/bugs/<编号>/<文档名>
✓ T1 docRefPath：归属需求的 Bug（parent=REQ 编号）→ requirements/<REQ>/bugs/<编号>/<文档名>
✓ T1 docRefPath：无项目根时返回相对路径（口径同既有实现）
✓ T2 onDocCtxMenu：类型门槛为 requirement|bug 白名单（放行 Bug 单，其余类型仍排除）
✓ T2 onDocCtxMenu：docRefPath 调用传入归属 parent（独立 / 归属 Bug 路径区分）
✓ T2 onDocCtxMenu：其余边界零回归——#docView 内 / 链接图片放行 / 非就绪态不弹 / preventDefault 在校验后

共 7 例，全部通过

$ node scripts/tests/doc-ctx-discuss-20260909-014.test.mjs（既有 T1–T10，仅 T5 断言随口径更新）
全部通过（17 例）

$ npm test
共 213 个测试文件，失败 0
```

修复前红样：新测试 6 例失败（docRefPath 对 BUG 编号返回 requirements/… 错误路径、onDocCtxMenu
残留旧类型门槛）、既有 T5 1 例失败（旧口径断言）。

改动：
- `scripts/web/app.js`：`docRefPath` 支持类型/归属三分支；`onDocCtxMenu` 白名单放开 Bug 单并传 parent；
  全局绑定注释同步（REQ-20260909-014 / BUG-20260913-003）。
- `scripts/tests/doc-ctx-discuss-bug-20260913-003.test.mjs`：新增 7 例。
- `scripts/tests/doc-ctx-discuss-20260909-014.test.mjs`：T5 类型门槛断言更新为新口径（其余不动）。
- `docs/agent-team-board/bugs/BUG-20260913-003/design.md`：补引入来源 / 根因 / 方案 / 风险边界。

人工浏览器目检项（菜单定位 / 深浅色 / 窄屏、独立与归属 Bug 真实路径剪贴板核对、链接图片放行）
见条目 README「验收说明」，演示页 `ui-demo.html` 可直接打开对照。

