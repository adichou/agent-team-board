# BUG-20260928-009 发布文档语言变体缺少中英文切换行，旧 README.en.md 残留未清理

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260921-012（发布文档两阶段流水线上线，AI 总结重写根文档时未保留 REQ-20260918-001 手工加入的中英文切换行；旧点号命名 README.en.md 同轮失去全部引用成为孤儿文件）
- 创建：2026-09-28T07:53:14.483Z

## 现象

1. **中英文切换行丢失**：根目录发布文档（README / CHANGELOG / FEATURES / AGENTS / DESIGN 的默认语言版与 `_en` 变体）全部没有跨语言切换链接。git 考古：`2ddcb27`（REQ-20260918-001）曾给 README.md 第 1 行加入 `中文 | [English](./README.en.md)` 切换行；`f1d15c7`（docs: 发布文档 BLD-20260923-001，2026-09-26）经发布文档流水线整体重写根文档后切换行消失（`git log --oneline -S'./README.en.md' -- README.md` 仅命中 `2ddcb27`（加入）与 `f1d15c7`（移除）两笔）；此后 BLD-20260927-001 轮（`7a71eab` 及 2026-09-28 AI 翻译轮）延续同样形态。当前 cn 基准文档无任何指向 `_en` 变体的链接，`_en` 变体也无指回 cn 文档的链接，语言间浏览只能靠看板「文档编写」页按语言分列。
2. **旧 README.en.md 残留**：点号命名 `README.en.md`（`2ddcb27` 引入）仍被 git 跟踪、仍在磁盘，但自 `f1d15c7` 起根发布文档均不再引用它（全仓检索仅其自身与历史条目文档的叙述性提及），内容停留在 REQ-20260918-001 时点，与现行 README.md / README_en.md 均不同步，属孤儿文件，易误导读者与后续 AI 总结 / 翻译轮。

## 复现步骤

1. `git show 2ddcb27:README.md | head -1` → 第 1 行为 `中文 | [English](./README.en.md)`（切换行曾在）。
2. `git show f1d15c7:README.md | head -1` → 第 1 行已是纯标题 `# Agent Team Board（智能体团队看板）`（切换行已失）。
3. 当前工作区：`grep -n '_en\.md' README.md CHANGELOG.md FEATURES.md AGENTS.md DESIGN.md` 无结果（cn 基准不链接 `_en` 变体）；`grep -nE '\]\((\./)?(README|CHANGELOG|FEATURES|AGENTS|DESIGN)\.md\)' *_en.md` 无结果（`_en` 变体不指回 cn 文档）。
4. `git ls-files | grep -i '^readme'` → README.en.md、README.md、README_en.md 三者并存；`grep -l 'README\.en' README.md CHANGELOG.md FEATURES.md AGENTS.md DESIGN.md README_en.md` 无命中（根发布文档无引用）。

## 期望行为

1. **恢复语言切换行（流水线能力）**：发布文档两阶段流程的产物在语言集内互链——默认语言文档与各语言变体文档顶部（或实施方案定稿的位置）带语言切换行，链接目标真实可达（如 cn `README.md` ↔ `README_en.md` 互指；具体样式以 design.md 定稿为准）。切换行须跨轮稳定：AI 总结（默认语言）与 AI 翻译（其余语言）提示词都生成 / 保留该行，AI 校对不将其判为基准外内容。
2. **删除旧 README.en.md（明确要求）**：点号命名孤儿文件 `README.en.md` 从仓库删除（`git rm`，随本单收口提交），删除后全仓无悬空引用。

## 验收标准

1. 一轮完整发布文档流程（AI 总结 + AI 翻译 + 校对）产出的全部语言文档均含语言切换行，且切换行链接目标真实可达。
2. `scripts/lib/publish-flow.mjs` 的总结 / 翻译 / 校对提示词含语言切换行规则，提示词生成有测试覆盖（按 BUG-20260922-003 口径，不测文档内容本身，测流水线行为）。
3. 旧 `README.en.md` 已从仓库删除（`git ls-files` 不再含它），全仓检索无指向它的悬空链接（历史条目文档中的叙述性提及除外）。
4. `npm test` 全量通过。
