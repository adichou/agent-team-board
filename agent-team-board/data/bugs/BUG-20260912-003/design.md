# 设计 — BUG-20260912-003 提交号显示优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260910-014（经 `atb list` 核验真实存在；该单「批量 Commit 功能需要有 UI」
  引入了已完成条目提交状态徽标 + 「N 个提交号」折叠 + 完整 hash + 独立复制按钮的展示形态，
  本单是其展示格式的后续调整）。展示口径扩展到待测试条目来自 REQ-20260911-009（亦经核验），
  本单不改变该扩展口径，仅改展示格式与复制交互。

## 根因分析

BUG-20260910-014 的展示设计为「徽标 + 折叠 + 全量 hash + 按钮复制」四层信息：

1. `commitBadgeHtml` 有成功提交记录时先渲染 `cm-committed`「已提交」徽标，提交号再藏进
   `<details class="commit-hashes">`（summary「N 个提交号」）——徽标与折叠双层信息冗余。
2. `commitHashListHtml` 每行 `<code class="commit-hash">` 直出完整 40 位 hash，占位过长。
3. 复制入口是行尾独立「复制」按钮（`data-copy-hash` 的 click → `copyHash`），提交号文本本身
   未绑复制事件，双击无反应。

## 方案

**开源选型（REQ-20260909-015）**：本单为纯前端展示裁剪（截短显示 + 双击复制 + 删徽标），
复用既有 `copyHash`（clipboard → execCommand 降级）与 `/api/commit/item-status` 数据源，
无新增依赖——无合适库的原因：功能为既有自研 UI 的小步调整，引入第三方库成本远高于改动量。

- `commitShortHash(h)`：`String(h).slice(0, 5)`，展示口径固定前 5 位（用户明确要求 5 位，
  非 git 默认 7 位）；完整 hash 只保留在 `title`（悬停「完整提交号：◇（双击复制完整值）」）
  与 `data-copy-hash`（复制口径）中。
- `commitHashListHtml`：每行改为 `<code class="commit-hash" title="完整提交号：…（双击复制完整值）"
  data-copy-hash="完整hash">前5位</code>`，去掉 `.commit-hash-row` 包裹与独立「复制」按钮。
- `commitBadgeHtml(it, { inline })`：去掉「已提交」徽标与折叠层——`inline: true`（列表卡片）
  有记录时直显 `commitHashListHtml`；非 inline（详情位）返回空串，仍由 `commitStatusDetailHtml`
  渲染同一列表，两处口径一致且不重复。「未提交」「提交状态加载失败（含重试）」两态原样保留。
- `bindCommitWidgets`：`[data-copy-hash]` 改绑 `dblclick` → `copyHash`（单击仅 `stopPropagation`
  不复制、不冒泡开详情抽屉；`dblclick` 也 `stopPropagation`）；删除 `.commit-hashes` 折叠拦截。
- `copyHash`：复制内容仍为完整 40 位 hash；成功反馈由「改写按钮文本」改为短号 `.copied` 高亮
  + toast（`✓ 已复制完整提交号 ◇…`），失败仍 toast「复制失败，请手动框选完整提交号」。
- i18n：新增 EN_DYNAMIC 两键（title 提示、成功 toast，◇ ↔ $1）；清理随 UI 消失的不可达键
  「已提交」「◇ 个提交号」「复制提交号 ◇」（i18n-coverage 扫描器跳过注释，已核验无其他引用）。
- CSS：删 `.cm-committed`、`.commit-hashes`（含 summary）、`.commit-hash-row` 死样式；
  `.commit-hash-list` 改横向 inline-flex wrap（多提交号并列），`.commit-hash` 加 `cursor: copy`，
  新增 `.commit-hash.copied` 成功高亮。

## 风险与边界

- 纯前端展示裁剪：不改 `/api/commit/item-status` 数据、不改提交账本、不影响自动提交与回执核验；
  刷新 / 列表详情切换 / 项目切换逻辑不动（数据仍按条目 id 索引，不串项目）。
- 双击复制依赖 dblclick，无键盘等价入口（旧「复制」按钮被移除）；复制失败仍可手动框选短号后
  从 title 获取完整值——若需键盘可达可后续补 `role/tabindex`，本单从简。
- 展示 5 位极短 hash 存在理论歧义（用户明确要求 5 位）；复制到剪贴板的始终是完整 40 位值，
  git 操作不受影响。
- `expandable` 选项更名为 `inline`（语义从「可折叠」变为「原位直显」），仅列表卡片一个调用点。

## 实施记录（TDD）

1. 基线：`node scripts/tests/run-all.mjs` 205 个测试文件 0 失败（全绿）。
2. 新增 `scripts/tests/bug-commit-hash-display-20260912-003.test.mjs`（T1–T7：徽标移除与详情
   不重复、短号展示、双击复制不冒泡、复制口径与反馈、未受影响状态回归、i18n 同步、样式），
   首跑 7 例全红。
3. 实施 `scripts/web/app.js`（commitShortHash / commitHashListHtml / commitBadgeHtml /
   bindCommitWidgets / copyHash 及列表卡调用点注释）、`scripts/web/style.css`、
   `scripts/web/i18n.js`，新测试转绿。
4. 按新口径更新两个既有测试（老断言编码了旧行为）：
   - `commit-ui-20260910-014.test.mjs` U6/U9（徽标断言 → 短号直显断言；U7/U8 未动仍绿）；
   - `commit-rollback-20260911-010.test.mjs` R10（回退保留契约改守新形态：去 cm-committed、
     去「个提交号」，保留换源四态函数与 data-copy-hash 复制入口）。
   `dev-flow-20260911-009` D12 未改动仍绿。
5. 全量回归：206 个测试文件 0 失败（含 i18n-coverage/dict/runtime/wiring/lang 五件套）。
