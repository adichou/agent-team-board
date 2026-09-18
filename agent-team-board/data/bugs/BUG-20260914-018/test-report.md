# 测试报告 — BUG-20260914-018 分支浏览页面中的 main 分支通过发布流程推送的文字删掉

- 时间：2026-09-14T14:38:31.523Z
- 执行者：zcode-batch-048-BUG-20260914-018
- 测试框架：node:test(自研断言脚本)
- 覆盖率：11%

## 总结

按用户反馈删除分支浏览 main 行「通过发布流程推送」徽标：build.js 删 mainFlagHtml() 及当前/非当前两处拼接（不加替代，行点击与无推送入口语义不变）；style.css 删 .bld-main-flag；i18n 清理两条徽标词条防死词条；017 测试 U2/U2b 反向断言+W1 死词条断言+S1 无残留断言，先跑红（4 例）后跑绿（11/11），run-all 237 文件全过；引入来源归因 BUG-20260914-017（design.md）

## 明细

### TDD 红绿过程（scripts/tests/bug-sync-main-release-note-20260914-017.test.mjs）

1. 先反向调整断言（U2 / U2b 改「main 行无标识且无推送入口」、W1 徽标两条词条改死词条清理断言、
   S1 增 mainFlagHtml / .bld-main-flag 无残留断言），实现未动时跑红：
   `U2 ✗（main 行不得再显示「通过发布流程推送」标识）`、`U2b ✗（当前 main 行不得再显示标识）`、
   `W1 ✗（「通过发布流程推送」词条应随徽标删除清理）`、`S1 ✗（build.js 不得残留 mainFlagHtml）`
   ——11 用例，失败 4（其余 U1/U3–U6/W2 与本单无关，保持绿）。
2. 实施删除后同一命令跑绿：11 用例，失败 0。

### 全量回归（node scripts/tests/run-all.mjs）

- 共 237 个测试文件，失败 0。

### 静态残留核验

- `grep -rn "mainFlagHtml|bld-main-flag" scripts/web/` 无命中（build.js / style.css / i18n.js 均无残留）。
- i18n 词典无「通过发布流程推送」「main 由发布流程推送：…」死词条（W1 断言）。
- 范围边界守护：`build-git.mjs syncRemote()` 排除 main 逻辑未触碰（S1 断言）；
  工具栏常驻同步说明与「main 已跳过」toast 按 README 默认口径保留（U1 / U3–U6 断言不变且通过）。

### 引入来源归因

- BUG-20260914-017（经 `atb list` 核验存在，状态 done）；详见本目录 design.md「引入来源（源单）」。

