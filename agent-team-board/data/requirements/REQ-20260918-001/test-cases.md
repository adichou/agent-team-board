# 测试用例 — REQ-20260918-001 README.md 按最新代码功能优化并支持中英文切换（新增 README.en.md）

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 承载文件：scripts/tests/req-doc-entry-20260916-003.test.mjs（扩展 B 组，A 组既有用例保持）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1a | README.md 顶部含语言切换：出现指向 `./README.en.md` 的链接与「中文 | English」切换形态 | P0 | ✅ 2026-09-19 |
| B1b | README.en.md 存在，顶部含返回 `./README.md` 的链接 | P0 | ✅ 2026-09-19 |
| B2a | README.en.md 与 README.md 章节一一对应：预置的中英标题映射表全部命中 | P0 | ✅ 2026-09-19 |
| B2b | README.en.md 除语言切换行外不含 CJK 字符（完整翻译） | P0 | ✅ 2026-09-19 |
| B3 | A1 路径清单扩展（README.en.md、scripts/lib/migrate-layout.mjs、scripts/lib/plugin-pack.mjs）且逐一真实存在 | P0 | ✅ 2026-09-19 |
| B4 | README.md 登记新落地能力：根 index.html 落地页、migrate-layout.mjs、plugin-pack.mjs | P1 | ✅ 2026-09-19 |
| B5 | 既有 A1–A6 契约断言全部保持通过 | P0 | ✅ 2026-09-19 |

跑红预期：B1a/B1b/B2a/B2b/B3/B4 在实现前失败（README 无切换链接、README.en.md 不存在、清单未含新路径）。

执行记录（TDD）：

- 跑红（2026-09-19）：实现前 `node scripts/tests/req-doc-entry-20260916-003.test.mjs` 6 个用例未通过——A1（README.en.md 缺失）、B1a（无切换行）、B1b（README.en.md 不存在）、B2a（英文章节缺失）、B3（文件不存在）、B4（目录树未登记落地页）；B2b 因文件为空空洞通过、B5 通过。
- 跑绿（2026-09-19）：README.md 更新 + README.en.md 新建后，A1–A6 + B1a–B5 共 14 个用例全部通过；`npm test` 全量 278 个测试文件失败 0。
