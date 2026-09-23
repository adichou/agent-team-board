# 设计 — BUG-20260923-004 AI  翻译的 README_en.md 中 AGENTS.md 的超链接文本不对

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-… / BUG-…（编号需经 `atb list` 核验真实存在）
- 引入来源：未定位（排查过程：…）
- （登记时暂空：尚未排查）

### 实施阶段归因（atb list 已核验）

- 引入来源：REQ-20260921-012（提交 0cab4e3 首次在 AI 翻译提示词写入「链接必须真实可达」约束，`git log -S` 追溯确认）。

## 根因分析

AI 翻译提示词（`buildDocTranslatePrompt`，scripts/lib/publish-flow.mjs）的翻译约束只有一句
「README 按语言链接同语言 CHANGELOG 与 FEATURES（…），链接必须真实可达」，未区分**链接目标**
与**可见链接文本**两个概念。基准 README.md 第 13 行为 `[AGENTS.md](./AGENTS.md)`，AI 为满足
「真实可达」把目标重定向到同语言变体 AGENTS_en.md 的同时，把带语言后缀的目标文件名一并写进了
可见文本，产出 `[AGENTS_en.md](./AGENTS_en.md)`（README_en.md 第 13 行；第 86 行同类链接
`[AGENTS.md](./AGENTS_en.md)` 形态正确，可见 defect 仅发生在文本被连帶改写处）。

## 方案

两层修复：

1. **产品层（防复发）**：翻译提示词「翻译约束」节补一条——文内链接指向同语言变体文件时
   （如 AGENTS.md → AGENTS_en.md）只改链接目标：可见链接文本保持基准原文
   （如 `[AGENTS.md](./AGENTS_en.md)`），不得把带语言后缀的文件名写进链接文本。
   示例语言取语言集首个剩余语言，动态生成；单语言集（无剩余语言）不输出该行。
   不新增依赖，无开源选型（未使用开源库，不创建 licenses.md）。
2. **文档层（修正存量）**：README_en.md 第 13 行链接文本 `AGENTS_en.md` → `AGENTS.md`
   （目标 ./AGENTS_en.md 已真实可达，不动）。属根第一层发布文档语言变体，按
   REQ-20260918-002 / REQ-20260923-002 口径无锁可改、不随收口提交，差异留工作区走发布文档流程。

## 风险与边界

- 只新增一条约束行，不改既有约束与基准 → 目标对应清单（bug-20260923-003 / req-20260921-012
  测试断言的提示词内容全部保留，不回归）；提示词经 atb.mjs（translate CLI）与 server.mjs
  （看板 AI 翻译页）两处调用点自动生效，无界面文案改动，不涉 i18n。
- AI 翻译为提示词驱动，约束为行为引导而非硬校验；存量其余 _en 文档核查无同类缺陷
  （AGENTS_en / CHANGELOG_en / FEATURES_en / DESIGN_en 的互链文本均为描述性文字）。

## 实施记录（2026-09-23）

- TDD：新增 scripts/tests/bug-20260923-004.test.mjs（4 用例，先红后绿）——L1-1 约束与
  `[AGENTS.md](./AGENTS_en.md)` 示例存在；L1-2 约束落在「翻译约束」节内；L1-3 既有约束与
  对应清单不回归；L1-4 多语言 / 自定义文档形态下约束仍输出、示例随首个剩余语言。
- 实现：publish-flow.mjs `buildDocTranslatePrompt` 翻译约束节新增链接目标 / 链接文本规则行。
- 文档：README_en.md 第 13 行链接文本改为 AGENTS.md。
