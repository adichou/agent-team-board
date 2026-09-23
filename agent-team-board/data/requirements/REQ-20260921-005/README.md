# REQ-20260921-005 BLD-20260920-001 发布文档：中英文 README / CHANGELOG / FEATURES / AGENTS

- 状态：submitted（待人工接受）
- 创建：2026-09-21T00:34:18.689Z

## 背景

版本计划 BLD-20260920-001（版本号 20260920-001，名称「全功能基线版：需求看板 · AI 分析和开发 · 版本发布」）已关联 339 项条目（需求 164 / 缺陷 175，90 个提交），处于待合并状态。发布需要一套仓库内版本文档：中文 / 英文各四类（README、CHANGELOG、FEATURES、AGENTS）。

## 交付物

仓库根八个文档；受认领锁约束，先成稿于本条目 `release-docs/`（与仓库根目标文件名一一对应），落地时整组复制到仓库根：

| 文件 | 内容要点 |
| ---- | ---- |
| README.md / README.en.md | 在现有双语 README 基础上增量更新：新增「文档与版本」导航（链接同语言 CHANGELOG / FEATURES）、目录树与导航表补新文档 |
| CHANGELOG.md / CHANGELOG.en.md | 20260920-001 版本说明：按模块归纳 339 项范围的变化（新增 / 优化 / 修复 / 下线隐藏），综合归纳不逐条罗列单据原文 |
| FEATURES.md / FEATURES.en.md | 本版已交付的用户能力清单：能做什么、入口在哪 |
| AGENTS.md / AGENTS.en.md | 仓库协作规则：AGENTS.md 为现有规则增量更新（文档地图 / 质量基线补发布文档口径），AGENTS.en.md 为新增英文对照 |

## 写作约束（来自派发提示词）

1. 文字简练、通俗易懂：说明用户能做什么、使用方式与本次变化；不得编造已实现能力。
2. README 按语言链接同语言 CHANGELOG 与 FEATURES（README.md → CHANGELOG.md / FEATURES.md；README.en.md → CHANGELOG.en.md / FEATURES.en.md），链接真实可达。
3. AGENTS 只描述适用协作规则，不把营销说明写成执行规则。
4. 与版本范围一致：339 项范围内的能力才可写成已发布；范围外条目（2026-09-21 起登记的）与已隐藏 / 已回退能力（文件看板、营销、旧发布视图、CI 看板、批量 Commit 等）不得写成已发布能力。

## 实施方式（受认领锁约束的特殊性）

- 八个目标路径中仅根 README.md 无锁可写（REQ-20260918-002 例外）；其余 7 个（README.en.md、AGENTS.md、AGENTS.en.md、新建 CHANGELOG / FEATURES 四件）受源码守卫硬保护，无认领锁不可写。
- 因此成稿阶段全部落在条目目录 `release-docs/`（用户数据不受锁限制）；README.md 的改动也一并在稿中，避免其 CHANGELOG / FEATURES 链接早于目标文件落地而悬空。
- 落地步骤见 design.md：人工接受 → 移入计划 → claim → 八件整组复制到仓库根 → 链接核验 → report 收口（系统自动提交到 dev，不手工 commit）。

## 验收标准

- [ ] 八个文档成稿于本条目 `release-docs/`（中英各四，文件名与仓库根目标一一对应）。
- [ ] README（中英）按语言链接同语言 CHANGELOG 与 FEATURES，并保留既有中英互链；落地后链接真实可达。
- [ ] CHANGELOG 按模块归纳 339 项范围的主要变化；版本名称 / 编号 / 日期与 BLD-20260920-001 记录一致。
- [ ] FEATURES 只列本版已交付能力并给出使用入口；隐藏 / 回退能力明确标注，不写成可用。
- [ ] AGENTS（中英）只描述协作规则；现有 AGENTS.md 硬约束全部保留不丢失。
- [ ] 中英文档内容一一对应；未纳入本版的条目不写成已发布。
- [ ] 落地后核验：README → CHANGELOG / FEATURES、FEATURES ↔ CHANGELOG、README ↔ README.en 各组链接可达，无悬空链接。
