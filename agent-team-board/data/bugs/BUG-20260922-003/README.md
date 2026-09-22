# BUG-20260922-003 发布文档阶段重写根 README/AGENTS 后 req-20260918-002 与 req-doc-entry-20260916-003 测试断言过期，阻塞收口确认

- 状态：以看板实时记录为准
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260916-003（README/AGENTS 入口文档契约测试）＋ REQ-20260918-001（B 组中英双语结构断言）＋ REQ-20260918-002（D1 文档口径同步断言）
- 创建：2026-09-22T10:24:45.696Z

## 现象

现象：npm test 全量 330 文件中 2 个失败——scripts/tests/req-20260918-002.test.mjs（D1 断言根 README.md 写明『根 README.md 认领锁例外』）与 scripts/tests/req-doc-entry-20260916-003.test.mjs（B1a/B2a/B4 断言 README 顶部语言切换行『中文 | English』、『三栏协作体系』章节、仓库根 index.html 落地页目录树等旧结构）。

根因：BLD-20260921-001 发布文档编写阶段（AI 总结轮 sum-20260921-235534 / sum-20260922-145226）已将根 README.md 重写为产品发布说明、AGENTS.md 重写为发布版协作规则（均为工作区未提交状态，待文档三阶段审核解锁提交），两测试仍按旧 README 契约断言，属断言过期而非功能缺陷。

影响：任何条目的收口提交确认（任务页『待人工确认』→ 确认并继续）都会触发 npm test 复验并以这 2 个失败被拒（当前已阻塞 REQ-20260921-007 的收口确认闭环）；文档阶段最终提交前也须先解决。

处理决策（人工，2026-09-22）：**测试用例不需要对文档进行测试**——移除两测试中对 README.md / README.en.md / AGENTS.md 等文档内容的校验，不按新文档结构更新断言。范围：

- `scripts/tests/req-20260918-002.test.mjs`：删除 D1（文档口径同步：AGENTS/README/state-guard 顶部注释）用例；该文件其余 R/X/C/L/E 用例测 state-guard 行为，全部保留。
- `scripts/tests/req-doc-entry-20260916-003.test.mjs`：删除所有读取文档内容断言的用例（A1 章节结构 / A2 命令记录 / A3 官网节 / A4 AGENTS 内容 / A5 双入口边界 / A6 私有信息 / B1a B1b 语言切换行 / B2a B2b 中英章节映射 / B4 落地页登记 / B5 防误删）；仅保留不读文档内容的仓库结构存在性检查（A1 声明路径逐一真实存在、B3 扩展路径存在）。
- 修复须走看板登记→接受→计划→认领流程；`npm test` 全量通过后 REQ-20260921-007 的收口确认（npm test 复验）不再被文档草稿阻塞。

## 复现步骤

1. `npm test`（330 个测试文件）：`req-20260918-002.test.mjs` D1 失败（README.md 草稿已删「根 README.md 例外」表述）、`req-doc-entry-20260916-003.test.mjs` 6 用例失败（草稿已删语言切换行 / 三栏协作体系章节 / 命令记录 / 官网节 / index.html 目录树登记）。
2. Status Board 任务页「待人工确认」对 REQ-20260921-007「确认并继续」→ 核验阶段 `npm test` 退出码 1 → 确认被拒。

## 期望行为

- 测试套件不再校验 README / AGENTS 等文档内容；发布文档编写阶段在工作区重写根 README.md / AGENTS.md 期间 `npm test` 不因此失败。
- `npm test` 全量通过；条目收口提交确认（npm test 复验）不再被文档草稿阻塞。
