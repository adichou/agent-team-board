# 设计 — REQ-20260921-005 BLD-20260920-001 发布文档：中英文 README / CHANGELOG / FEATURES / AGENTS

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

版本计划 BLD-20260920-001（版本号 20260920-001，名称「全功能基线版：需求看板 · AI 分析和开发 · 版本发布」）需要一套仓库内发布文档（中英各四：README / CHANGELOG / FEATURES / AGENTS）。八个目标路径中仅根 README.md 无锁可写（REQ-20260918-002 例外），其余受源码守卫硬保护（插件缓存 0.1.0 为指向本仓库的软链，state-guard 的 PLUGIN_ROOT 即本仓库；docs/ 与 agent-team-board/ 豁免，根下其他文件无认领锁不可写）。

## 方案

### 成稿阶段（无需认领锁）

全部产出落在条目目录 `release-docs/`（看板用户数据不受源码守卫限制），文件名与仓库根目标一一对应：

```
release-docs/
├── README.md          # 现行根 README 的增量更新稿（新增「文档与版本」节 + 目录树/导航表补条目）
├── README.en.md       # 同上英文镜像
├── CHANGELOG.md       # 20260920-001 版本说明（中文）
├── CHANGELOG.en.md    # 英文对照
├── FEATURES.md        # 本版能力清单（中文）
├── FEATURES.en.md     # 英文对照
├── AGENTS.md          # 现行根 AGENTS.md 增量更新稿（文档地图/质量基线补发布文档口径）
└── AGENTS.en.md       # 新增英文对照
```

内容事实源：BLD-20260920-001 版本记录（runtime/builds/versions/BLD-20260920-001/version.json：名称 / 描述 / 339 项）、派发提示词的关联条目清单（164 REQ + 175 BUG = 339 项、90 个提交）、现行根 README.md / README.en.md / AGENTS.md、仓库规则。

**开源选型（REQ-20260909-015）**：纯文档写作，无新开源库引入，不创建 licenses.md。

### 落地阶段（需认领锁）

1. 人工接受本条目 → 移入计划。
2. `node scripts/atb.mjs claim REQ-20260921-005`（产生认领锁；复制动作必须在 claim 之后，保证收口提交归因到本单——预留时已脏文件不入单的教训见 BUG-20260913-006）。
3. 把 `release-docs/` 八件整组复制到仓库根（覆盖 README.md / README.en.md / AGENTS.md，新建其余五件）；八件必须整组同落，保证链接同刻可达。
4. 链接核验（落地形态）：README.md → CHANGELOG.md / FEATURES.md；README.en.md → CHANGELOG.en.md / FEATURES.en.md；CHANGELOG ↔ FEATURES 互链；README ↔ README.en 互链；AGENTS 引用的文件存在。
5. `node scripts/atb.mjs report REQ-20260921-005 --summary "…"` 收口：系统自动把本单改动提交到 dev（不手工 git commit、不 push、不置 done）。

## 风险与边界

- **版本范围一致性**：文档只写 BLD-20260920-001 关联的 339 项（截至 BUG-20260920-003 / 2026-09-20）之内已交付的能力；其后登记的条目（REQ-20260921-001 起）不写入。已隐藏 / 回退能力（文件看板、营销模块、旧发布视图、CI 看板、批量 Commit）在 CHANGELOG「下线 / 隐藏」与 FEATURES「当前隐藏的能力」中明确标注，不作为已发布能力宣传。
- **AGENTS.md 不重写**：现行根 AGENTS.md 是有效的协作硬约束，仅增量补发布文档口径，全部既有规则保留，防止规则丢失。
- **版本名称规范化**：记录中「AI 分析和开发· 版本发布」的间隔符统一为「AI 分析和开发 · 版本发布」，文字不变。
- **纯文档变更**：不触碰 scripts/web/i18n.js 与任何源码，无界面文案改动，不需新增 `*.test.mjs`（无代码行为变化；验收以链接核验与内容审阅为主）。

## 实施记录

- 2026-09-21：登记本条目；核实守卫口径与 BLD-20260920-001 版本记录；统计范围（164 REQ / 175 BUG / 339 项 / 90 提交）；八个文档成稿于 `release-docs/`，待人工接受后按落地阶段推进。
- 2026-09-21 核验：①八文件全部 markdown 链接经脚本核验可达（目标存在于 release-docs/ 或仓库根，0 断链）；②必需互链齐备（README→同语言 CHANGELOG/FEATURES、CHANGELOG↔FEATURES、中英互链、AGENTS 中英互链）；③staged README.md / AGENTS.md 与仓库现行文件 diff 仅含预期增量（文档与版本节、目录树、官网节一句、导航表一行 / AGENTS 互链、质量基线一条、文档地图三条），无规则丢失；④全文无 2026-09-21 起的越界单号引用。
