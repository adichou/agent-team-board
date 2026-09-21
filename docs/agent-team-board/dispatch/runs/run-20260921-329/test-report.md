# 测试报告 — BUG-20260921-013 文档编写界面的文件区域应该采用页签布局，每个语言是一个页签（run-20260921-329）

- 日期：2026-09-21　执行：zcode-batch-060-3（批次 batch-20260921-060）
- 引入来源：REQ-20260921-008（三段式布局引入平铺单列分组列表，经 REQ-20260921-010 /
  REQ-20260921-012 沿袭；编号经 `atb list` 核验存在）
- 新增测试：`scripts/tests/bug-20260921-013.test.mjs`（TDD 先红后绿，11 组；实现前 10/11
  跑红——B4-1 为既有能力回归断言（当前平铺实现也满足），其余页签相关断言全红；输出见
  同目录 test-output.log）
  - B1 渲染结构：语言页签行 `role="tablist"` + 每语言一个 `role="tab"`（`aria-selected`）；
    默认语言恒为第一页签并标「（默认）」+ 计数角标 x/4；每语言一个 `role="tabpanel"`
    （id / aria-labelledby 互链）仅含该语言四文件、非激活 `hidden`；表头全局汇总计数保留；
    `bld-doc-group` /「剩余语言（…）」平铺分组形态清零；
  - B2 激活语言记忆与回落：`pf.docLang` 记忆（en 激活、cn 面板 hidden）；记忆语言不在
    语言集（fr ∉ cn,en）回落默认语言；cn,en,fr → 3 页签按语言集次序、面板随语言集重建；
  - B3 AI 运行中角标：AI 翻译 / AI 总结当前文件在非激活语言 → 该页签 ◐ `st-run` 角标 +
    title 提示；不自动切换页签；当前文件在激活页签时不加角标、行内进度标注保留；
  - B4 保留能力回归：七态 chip 全语言在 DOM（含隐藏面板）；八文件行保留；阶段条 / 门禁条
    计数恒为语言集全局；当前文件行内 AI 进度标注保留；
  - B5 交互静态契约：bindView 绑定 `[data-doc-lang]` 点击 → `pf.docLang` 赋值 + 重渲染；
    renderDocsPane 读 `pf.docLang` 且 `langs.includes` 校验回落；
  - B6 i18n：新词条「（默认）」「文档语言页签」「AI 总结进行中：当前文件在该语言页签」
    「AI 翻译进行中：当前文件在该语言页签」双语；旧组头词条两条清理；en/zh 往返抽查；
  - B7 样式：`.bld-doc-lang-tabs` / `.bld-doc-tab-count` 存在；`.bld-doc-group` 清理。
- 既有测试随形态有意变更更新：`scripts/tests/req-20260921-012.test.mjs` L4-1 组头断言改为
  语言页签断言（语言分组信息由页签承载），L6-1 词典断言随组头词条清理迁移并补页签词条
  检查；其余 18 例零改动通过。
- 全量回归：`npm test` → **310 个测试文件，失败 0**（首次运行 bug-leak-residue-20260914-013
  偶发端口占用失败，单独复跑与全量复跑均通过，与本改动无关——本单不涉端口 / server 代码）。
- 覆盖框架：Node 内建 `node:assert/strict` + `vm` 沙箱装载真实 build.js 函数源码的自研
  runner（与仓库既有 L4 前端静态契约测试同构）。

## 实现摘要

纯前端展示层改版（无服务端改动）：

1. `scripts/web/build.js` `renderDocsPane`：删除 `groupHtml` 平铺分组构建，改为
   `langTabsHtml`（`<nav class="rel-tabs bld-doc-lang-tabs" role="tablist">`，每语言一个
   `rel-tab` button：`缩写 · 显示名`（data-i18n-skip）+ 默认语言「（默认）」+ 审核计数角标
   + 非激活页签 AI 运行 ◐ 角标）与 `langPanelsHtml`（每语言一个 `<ul role="tabpanel">`，
   非激活 `hidden`；全部渲染，七态 chip / 行内进度对所有语言保留在 DOM）；激活语言
   `pf.docLang` 记忆、`langs.includes` 校验回落默认语言；表头汇总 / 阶段条 / 门禁条不动。
   bindView 新增 `[data-doc-lang]` 点击绑定（写 `pf.docLang` + 重渲染；键盘可达沿用既有
   页签口径——原生 button）。
2. `scripts/web/style.css`：新增 `.bld-doc-lang-tabs` / `.bld-doc-tab-count`（复用 `.rel-tabs`
   `flex-wrap` 窄屏换行）；删除 `.bld-doc-group` 分组样式。
3. `scripts/web/i18n.js`：EN 静态区新增 4 词条（静态区保证 en→zh 往返）；EN_DYNAMIC 清理
   组头两条动态键。
4. `agent-team-board/data/bugs/BUG-20260921-013/design.md`：补根因 / 方案定稿（页签标签
   形态、运行角标口径、记忆策略、自研理由）/ 风险边界。

开源选型：自研（原生 tablist 标记 + 复用既有 `.rel-tabs` 样式，零新增依赖；理由见 design.md）。
