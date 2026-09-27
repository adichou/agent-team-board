# BUG-20260927-001 项目根目录的README.md 等文档所引用的图片在文档审核通过后也需要一并提交

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-27T09:52:23.185Z

## 现象

插件根第一层的发布文档（README / CHANGELOG / FEATURES / AGENTS 及 `v.customDocs` 清单内自定义文档）正文可引用仓库内本地图片作为插图，但当前发布文档的提交放行口径与写入保护口径都没有为这些图片留出通道，导致文档审核通过、提交解锁后，图片无法随文档一并提交，仓库里已提交的文档出现悬空图片引用（渲染破图）。

具体口径与现状（均已在仓库核实）：

- 根 `README.md` 第 37 行「产品界面」一节引用本地图片 `![1790092127929](image/README/1790092127929.png)`；`README_en.md` 第 37 行引用同一图片。图片实际落点为插件根第一层 `image/README/` 目录（另有当前未被任何文档引用的 `image/README/1790092216439_en.png`，用途待确认）。
- 该 `image/` 目录整体未被 git 跟踪（`git ls-files image/` 无输出，`git status` 显示 `?? image/`），`.gitignore` 也未忽略它，即图片只存在于工作区。
- 提交侧：流程外 git commit 的发布文档通道（scripts/state-guard.mjs 通道②，REQ-20260918-002 / REQ-20260923-001）要求 pathspec **逐个**命中「插件根第一层豁免发布文档单文件」（`pathspecIsExemptRootDoc` → `isPluginRootExemptDoc`），即 README/CHANGELOG/FEATURES/AGENTS 与 `v.customDocs` 清单内的 `<KEY>.md`。`image/README/*.png` 不在豁免清单内——pathspec 混入图片则整条提交不放行，单独提交图片同样不放行。
- 写入侧：无认领锁时，插件根第一层非豁免落点的写入按源码保护拦截（`realpathAncestralHitsPluginRoot` 只豁免 `docs/`、`agent-team-board/` 与第一层豁免文档单文件名，`image/` 前缀不在其列），即替换/新增这些被引用的图片也走不了发布文档豁免口径。

## 复现步骤

1. 在插件根（本仓库根目录）确认现状：`image/README/1790092127929.png` 存在于工作区但未被 git 跟踪（`git ls-files image/` 输出为空）。
2. 按 AGENTS.md 的发布文档放行口径，尝试把根 README.md 与其引用的图片随一次文档提交入库：
   `git commit -m "docs: 更新产品界面插图 BUG-20260927-001" README.md image/README/1790092127929.png`
3. 观察 PreToolUse 钩子（hooks/hooks.json → scripts/state-guard.mjs）拦截：pathspec 含非豁免文档 `image/README/1790092127929.png`，通道②的 `pathspecIsExemptRootDoc` 判定不通过，整条提交被拒。
4. 退而只提交图片本身：`git commit -m "docs: 产品界面插图 BUG-20260927-001" image/README/1790092127929.png`，同样被拦（pathspec 不全为豁免发布文档）。
5. 结果：文档审核通过、提交解锁后，图片只能滞留工作区；若先行提交 README.md，仓库中该文档的图片链接悬空，检出后渲染破图。

## 期望行为

- 发布文档审核通过、提交解锁后，文档正文引用的**仓库内本地图片**能随文档一并进入提交（同一提交或配套的授权提交），保证 dev 分支上已提交的 README.md 等文档渲染不破图、无悬空引用。
- 引用外部 URL 的图片不涉及提交，行为不变。
- 放行仍保持可静态核验：显式 pathspec 逐个判定、提交主题符合「类型: 描述 单号」规范；无 pathspec 裸提交、范围含源码 / `agent-team-board/runtime/`、`--amend` 等不可核验形态依旧拦截，不因放行图片引入源码夹带通道。
- 图片豁免的具体口径（按既有引用路径静态解析放行、白名单目录、还是随 `v.customDocs` 一并登记图片清单；以及写入侧认领锁外的替换口径是否同步对齐）属方案取舍，待开发阶段在 design.md 定夺，本条目只约束上述行为目标。

## 界面展示

本 Bug 的核心是发布文档提交链路（提交放行口径与写入保护口径），不是产品看板界面本身的缺陷；登记关键词「产品界面」来自根 README 的章节名。其「界面」体现为两处可见结果：文档渲染视图中插图的破图/正常，以及提交通道的拦截/放行反馈。可交互演示见 [./ui-demo.html](./ui-demo.html)（单文件、内联 CSS/JS、无外网依赖、无构建步骤、浏览器直接打开），说明如下：

- 布局：顶部为「修复前（现状）/ 修复后（期望）」状态切换与深浅色切换；下方两个面板——「① 文档渲染视图」模拟根 README「产品界面」一节的插图区域，「② 提交通道视图」模拟带 pathspec 的发布文档提交与钩子反馈条。
- 交互：点击顶部开关在修复前/修复后之间切换（两个面板联动）；提交通道视图可选四种 pathspec 组合（文档+图片 / 仅图片 / 夹带源码 / 裸提交），点击「尝试提交」重放提交结果；深浅色按钮在跟随系统 / 浅色 / 深色间循环。
- 状态反馈：文档渲染视图——修复前显示悬空引用破图占位（失败态），修复后显示插图正常渲染（正常态）；提交通道视图——放行成功（正常态）、钩子拦截（失败态，附拦截原因）、校验中（加载态）、无 pathspec 时列表空态；「仅图片」在修复后标记为「口径待 design.md 定夺」，不预设结论。

## 验收说明

1. 在发布文档提交通道下，pathspec 同时包含发布文档与其引用的本地图片（如 `README.md` + `image/README/1790092127929.png`）、主题行合规时提交放行成功；提交后从版本库检出，README.md「产品界面」插图可正常渲染（图片文件在版本库中存在）。
2. 放行范围仍受静态核验约束（回归既有口径）：无 pathspec 裸提交、pathspec 含源码或 `agent-team-board/runtime/` 状态数据、`--amend` / `-F` 等不可核验形态依旧拦截；magic 前缀与 glob 通配 pathspec 保守拦截行为不变。
3. 图片随文档提交时主题仍须通过 `lib/commit-store.mjs` 的 `validateCommitSubject` 校验（「类型: 描述 单号」）。
4. 新增测试 `scripts/tests/bug-20260927-001.test.mjs`（先红后绿）覆盖上述放行与拦截用例；交付前 `npm test` 全量通过。
5. 写入侧行为与方案定稿一致（若方案要求同步调整 `image/` 前缀的写入豁免口径，以 design.md 为准）；引入来源归因补入 design.md（当前登记时暂空，尚未排查）。
