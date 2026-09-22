# 测试报告 — BUG-20260922-001 文案“或在 ZCode 会话运行 /dev REQ-20260922-003 让 Agent 直接认领。”优化

- 时间：2026-09-22T04:25:26.215Z
- 执行者：dev-5
- 测试框架：node:test（静态契约）
- 覆盖率：未统计

## 总结

复工补落 hold 人工决策：q1「或直接打开 ZCode / ChatGPT 手动新建会话并粘贴提示词」三处（app.js/build.js 失败分支 + i18n 词典键与 EN 值）通用化为「您使用的 Agent 客户端 / your agent client」；q2 atb.mjs IAB 提示按答复保留现状；新增 B5/B6 先红后绿并同步既有 S7 断言；定向 7 套件与全量 326 文件仅 2 已知预存失败（与本单无关）

## 明细（第 2 轮 · dev-5 · run-20260922-348：复工补落 hold 人工决策）

人工决策（hold 第 1 轮，2026-09-22 04:15 board，留痕 runtime/holds/decisions/BUG-20260922-001.md）：
q1「或直接打开 ZCode / ChatGPT 手动新建会话并粘贴提示词」→ **通用化处理**；q2 atb.mjs IAB 提示 → **保留现状**。

### 本轮改动（仅 q1 范围，三处）

| 位置 | 修复前 | 修复后 |
| --- | --- | --- |
| `scripts/web/app.js` `newSessionLinksHtml()` 检测失败分支 | 或直接打开 ZCode / ChatGPT 手动新建会话并粘贴提示词 | 或直接打开您使用的 Agent 客户端手动新建会话并粘贴提示词 |
| `scripts/web/build.js` `answerSessionLinksHtml()` 检测失败分支 | 同上 | 同上 |
| `scripts/web/i18n.js` 词典 | 键=旧中文，EN "or open ZCode / ChatGPT directly, …" | 键随中文原文更新，EN "or open your agent client directly, start a session manually and paste the prompt" |

周边「客户端检测失败：无法确认本机 Zcode / Codex 是否可用」「未检测到 ZCode.app / ChatGPT.app」系列为事实性深链检测描述，不在 q1 范围，未改动；q2 的 atb.mjs IAB 提示按答复保留原文。

### TDD 先红（修复前）

```
$ node scripts/tests/bug-drawer-notice-generic-20260922-001.test.mjs
✓ B1–B4（第 1 轮用例保持绿）
AssertionError: app.js 手动打开指引不得再并列宿主名（B5）→ exit 1
```

### 修复后定向套件

```
$ node scripts/tests/bug-drawer-notice-generic-20260922-001.test.mjs
✓ B1–B4（第 1 轮回归不回归）
✓ B5 q1：app.js / build.js 手动打开指引通用化，不再并列宿主名
✓ B6 q1：词典新键存在、EN 值无宿主名、旧键移除
共 6 例，全部通过

$ node scripts/tests/bug-build-session-entry-20260913-005.test.mjs → 15 例全过（S7 断言已同步新文案）
$ node scripts/tests/i18n-dict.test.mjs        → EN 1279 条全过（值唯一性含新词条）
$ node scripts/tests/i18n-coverage.test.mjs    → C1/C1b/C2 全过（新中文原文已同步词典键）
$ node scripts/tests/i18n-runtime.test.mjs     → R1–R4b 全过（含中英往返还原）
$ node scripts/tests/i18n-wiring.test.mjs      → W1a–W2 全过
$ node scripts/tests/i18n-lang.test.mjs        → L1a–L3b 全过
$ node scripts/tests/workspace-entry-20260910-002.test.mjs → 全过
```

### 全量回归

```
$ npm test（node scripts/tests/run-all.mjs）
共 326 个测试文件，失败 2：req-20260918-002.test.mjs、req-doc-entry-20260916-003.test.mjs
```

两个失败与第 1 轮完全一致（req-20260918-002 D1 文档口径同步；req-doc-entry-20260916-003 A1–A3/B1a/B2a/B4），
源于用户未提交的 README.md 重写，与本单文案修改无关，本单不处理。

### 验收 grep 复核（README 验收说明 3 + q1 扩展）

```
$ grep -rn "ZCode 会话" scripts/（排除 tests/）→ 0 处命中
$ grep -rn "或直接打开 ZCode" scripts/（排除 tests/）→ 0 处命中
$ grep -rn "open ZCode / ChatGPT" scripts/web/ → 0 处命中
tests/ 内命中仅为本单测试文件对旧文案的注释/断言引用（移除断言所需，非面向用户文案）
```

## 附录：第 1 轮报告（dev-4 · run-20260922-347 · 2026-09-22T01:55，主修复）

### TDD 先红（修复前）

```
$ node scripts/tests/bug-drawer-notice-generic-20260922-001.test.mjs
AssertionError: accepted 分支应为通用宿主表述（B1，命中旧文案「或在 ZCode 会话运行」）→ exit 1
```

### 修复后定向套件

```
$ node scripts/tests/bug-drawer-notice-generic-20260922-001.test.mjs → B1–B4 全过
$ node scripts/tests/i18n-dict.test.mjs        → D1a–D1e 全过（EN 1279 条）
$ node scripts/tests/i18n-coverage.test.mjs    → C1/C1b/C2 全过
$ node scripts/tests/i18n-runtime.test.mjs     → R1–R4b 全过（含中英往返还原）
$ node scripts/tests/i18n-wiring.test.mjs      → W1a–W2 全过
$ node scripts/tests/i18n-lang.test.mjs        → L1a–L3b 全过
$ drawer-actions-row / drawer-nav / drawer-tabs-20260909-006 / drawer-height / drawer-undo /
  bug-drawer-picked-sync-20260915-011 / accepted-batch-entry → 全部通过
```

### 全量回归

共 326 个测试文件，失败 2（req-20260918-002、req-doc-entry-20260916-003，预存问题同上）。
