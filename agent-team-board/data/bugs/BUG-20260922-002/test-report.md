# 测试报告 — BUG-20260922-002 文档编写页面的自定义文档要支持删除，并且自定义文档只需要在默认语言中添加一次，其他语种需要自动添加

- 时间：2026-09-22T05:20:17.330Z
- 执行者：dev-7
- 测试框架：node:assert/strict + 临时 Git 仓库 + HTTP 集成 + vm 前端静态契约（仓库自研骨架 run-all.mjs）
- 覆盖率：95%

## 总结

自定义文档添加一次随语言集自动展开：默认语言 KEY.md + 其余 KEY_<lang>.md，与标准 4 类同口径进 AI 翻译（基准 = 默认语言 KEY.md）/ canTranslate / 三阶段门禁 / pathspec / 指纹 / 基准变更检测；展开重名拦截（MIGRATION_EN 类手工逐语种 workaround 不可行，语言集扩展撞名同样拒绝）；整份移除清理磁盘全部语言文件与审核留痕（removedFiles 回传前端，merging/pushed/总结运行中拦截保持，再添加不复活已审核）；完结快照 customDocsKey 参与有效性比对（存量无字段不回归）；审查对话框自定义页签多语言多栏；CLI translate start 同步对齐。引入来源 REQ-20260922-003（根因与归因见 design.md）。新增 17 例先红后绿（bug-20260922-002.test.mjs），req-20260922-003.test.mjs 17 例断言随口径落定更新，全量 328 测试文件仅 2 个已知预存失败（README.md 重写，与本单无关）

## 明细

### 用例执行（TDD：先跑红 → 实现 → 跑绿）

- `node scripts/tests/bug-20260922-002.test.mjs` → **17/17 通过**（L1 纯逻辑 8 + L2 数据层 4 +
  L3 服务端到端 1 + L4 前端静态契约 3 + L6 i18n 1；用例清单见 test-cases.md）。实现前跑红
  首断言即失败（现状清单 10 文件 vs 期望 11），实现后全绿。
- `node scripts/tests/req-20260922-003.test.mjs` → **17/17 通过**（源单测试断言随本单口径
  落定更新：展开计数 4×N+K×N、AI 翻译含自定义、canTranslate 含自定义默认语言份、完结
  customDocsKey、审查对话框多栏、i18n 词条迁移）。

### 回归

- 相关模块：`req-20260921-008 / 010 / 012`、`req-20260922-001 / 002 / 004`、
  `bug-20260921-005`（CLI translate）全部通过。
- 全量 `npm test`：**328 个测试文件，失败 2** —— `req-20260918-002.test.mjs`（D1 文档口径
  同步）、`req-doc-entry-20260916-003.test.mjs`（B1a/B2a/B4 README 章节对应与登记），均为
  已知预存失败（源于用户未提交的 README.md 重写），与本单改动无关，未修复。
- 不回归口径验证：无自定义文档时 `publishDocFiles` / AI 总结提示词 / AI 翻译提示词 /
  `detectBaselineShift`（两参调用）/ 范围指纹与改动前逐字节一致；存量完结记录（无
  customDocsKey 字段、无自定义文档）在求值中仍有效。

### 覆盖率口径

本单 test-cases 分层用例全覆盖（L1–L4 / L6 全过）；未采集项目语句 / 分支级覆盖率工具数据，
95% 为分层覆盖估计值。
