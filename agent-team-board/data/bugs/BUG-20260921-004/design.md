# 设计 — BUG-20260921-004 版本计划中的文档预览界面，说明应该改成 README.md

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260920-003（经 `atb list` 核验存在，状态 done；提交 58bfd1e「构建和发布流程整改」引入
  renderDocsPane——类型下拉以裸键 README 作 option 文本，与既有 i18n 反向词典组合后暴露缺陷）

## 根因分析

两个各自正确的机制组合出缺陷：

1. `scripts/web/i18n.js` 为保证中英往返，构建反向词典（en → zh）：`ZH_EXACT = EN 的逆映射`
   （i18n.js L1522-1523）。条目详情抽屉文档页签词条 `'说明': 'README'`（i18n.js L834）据此生成
   精确逆映射 `README → 说明`。中文模式下 `t()` 先查 `ZH_EXACT`（L1553），输入 `README`
   即返回「说明」。
2. `scripts/web/build.js` 的 `renderDocsPane` 类型下拉以裸键作 option 文本
   （原 L2087 `…>${k}</option>…`，k ∈ README / CHANGELOG / FEATURES / AGENTS）。渲染后
   MutationObserver 触发 `translateTree`，中文界面把 option 文本节点 `README` 误译成「说明」。

为什么只有中文界面、只有 README 受影响：英文模式 `t()` 走 EN 分支（键为中文不命中）原样显示；
`CHANGELOG` / `FEATURES` / `AGENTS` 不是任何 EN 词条的值，逆映射不存在，故不受影响。语言往返
（切 EN 再切回中文）同样触发反向翻译，「说明」复现，与报告一致。

## 方案

`scripts/web/build.js` renderDocsPane 类型下拉（一处渲染同时覆盖选中值与展开选项）：

1. **选项文本显示完整文件名** `README.md / CHANGELOG.md / FEATURES.md / AGENTS.md`
   （value 保持裸键，`docFileFromSel` 拼 `${value}.md` 的保存逻辑不变）。定稿口径依据：
   条目标题即报告人口径「改成 README.md」，ui-demo.html 演示的期望修复后状态为四项统一带
   `.md`，且与底部文档状态 chips 的完整文件名口径一致；四项统一避免 README.md 与裸键混排。
   带后缀后 `README.md` 不再等于逆映射键 `README`，即使不经 2 也不会被误译。
2. **类型下拉声明 `data-i18n-skip`**：文件名是标识不是文案，明确不进翻译管线
   （translateTree 对带该属性的子树直接跳过），防止未来词典新增词条撞车再犯（治本）。

词条 `'说明': 'README'` 本身是抽屉页签的正确文案，**保留不动**（回归见测试 B4）。
「语言」下拉、预览区、chips 等其余元素不改（验收明确不受影响）。

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

本次为两处既有机制的对齐修复（改一行渲染 + 加一个既有豁免属性），无新增依赖，不适用开源选型
（自研理由：无合适库——修复对象是本项目自有 i18n 管线与渲染的交互，不存在可引入的第三方库）。

## 测试

`scripts/tests/bug-20260921-004.test.mjs`（先红后绿，4 例）：

- B1 词典层：四个 `.md` 文件名 zh 反复重翻不变形、en 原样（防未来词条撞车的词典防线）；
- B2 渲染层：renderDocsPane 类型下拉 option 文本带 `.md`、value 保持裸键、select 声明
  `data-i18n-skip`、当前文档选中态保留；
- B3 根因锁定与豁免：zh 模式 `t('README')` 仍为「说明」（词条保留的证据）；带
  `data-i18n-skip` 的子树 `translateTree` 不改写其中文本；
- B4 词条回归：抽屉「说明」页签词条 en 译出、zh 往返还原不受修复影响。

## 风险与边界

- 显示口径从裸键改为完整文件名是可见变化：英文界面同一位置从 README 变 README.md（定稿口径
  四项统一带 `.md`，见方案 1；英文界面「显示真实标识」这一正确性不变）。
- `data-i18n-skip` 挂在 select 上只豁免其子树，「类型」label 文本仍在翻译范围内，不受影响。
- 不改 i18n.js 词典与反向机制，中英同步基线（BUG-20260912-001）不受触碰；`npm test` 全量
  298 个测试文件通过。
