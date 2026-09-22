# 测试报告 — BUG-20260922-001 文案“或在 ZCode 会话运行 /dev REQ-20260922-003 让 Agent 直接认领。”优化

- 时间：2026-09-22T01:55:04.620Z
- 执行者：dev-4
- 测试框架：node:test（静态契约）
- 覆盖率：未统计

## 总结

accepted 未入计划 notice 去宿主排他表述：app.js「或在 ZCode 会话运行」改「或在您使用的 Agent 会话运行」；i18n 键随原文更新、EN 值改 or run it in your agent session（旧键与 ZCode session 清零）；「让 Agent 直接认领。」词条核对保留；新增 bug-drawer-notice-generic-20260922-001.test.mjs B1-B4 先红后绿；全量 326 文件仅 2 个已知无关预存失败；两项待确认已 hold declare 待人工定夺

## 明细

### TDD 先红（修复前）

```
$ node scripts/tests/bug-drawer-notice-generic-20260922-001.test.mjs
AssertionError: accepted 分支应为通用宿主表述（B1，命中旧文案「或在 ZCode 会话运行」）→ exit 1
```

### 修复后定向套件

```
$ node scripts/tests/bug-drawer-notice-generic-20260922-001.test.mjs
✓ B1 app.js accepted notice：通用表述「在您使用的 Agent 会话运行 /dev」，不含「ZCode 会话」
✓ B2 i18n 词典：新键存在、英文值通用化（不含 ZCode session），旧键移除
✓ B3 「让 Agent 直接认领。」词条保留（无宿主名，本身通用）
✓ B4 全局防线：scripts/web 源码不再出现「ZCode 会话」排他文案
共 4 例，全部通过

$ node scripts/tests/i18n-dict.test.mjs        → D1a–D1e 全过（EN 1279 条，值唯一性含新词条）
$ node scripts/tests/i18n-coverage.test.mjs    → C1/C1b/C2 全过（新中文原文已同步词典键）
$ node scripts/tests/i18n-runtime.test.mjs     → R1–R4b 全过（含中英往返还原）
$ node scripts/tests/i18n-wiring.test.mjs      → W1a–W2 全过
$ node scripts/tests/i18n-lang.test.mjs        → L1a–L3b 全过
$ drawer-actions-row / drawer-nav / drawer-tabs-20260909-006 / drawer-height / drawer-undo /
  bug-drawer-picked-sync-20260915-011 / accepted-batch-entry → 全部通过
```

### 全量回归

```
$ npm test（node scripts/tests/run-all.mjs）
共 326 个测试文件，失败 2：req-20260918-002.test.mjs、req-doc-entry-20260916-003.test.mjs
```

两个失败为批次已知预先存在问题（req-20260918-002 D1 文档口径同步；req-doc-entry-20260916-003
A1–A3/B1a/B2a/B4），源于用户未提交的 README.md 重写，与本单文案修改无关，本单不处理。
本单新增 1 个测试文件（bug-drawer-notice-generic-20260922-001.test.mjs）已计入 326 文件总数。

### 验收 grep 复核（README 验收说明 3）

```
$ grep -rn "ZCode 会话" scripts/
→ scripts/web/（app.js / build.js / i18n.js）与 scripts/atb.mjs 等 0 处命中；
  剩余命中均为本单新增测试文件对旧文案的注释/断言引用（非面向用户文案）
$ grep -rn "Zcode 会话" scripts/
→ 仅「去新建 Zcode 会话」双宿主并列链接（README 排查结论保留项，维持原状）
$ grep -rn "ZCode session" scripts/web/
→ 0 处命中
```

