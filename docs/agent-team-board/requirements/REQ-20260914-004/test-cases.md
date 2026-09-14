# 测试用例 — REQ-20260914-004 优化需求说明、设计文档中右键讨论菜单生成的提示词

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | buildDocRef 有选中：首行「【文档讨论引用】」+「单号 / 文档名 第 x–y 行」+「文档：路径」+「原文：\n所选文字」全保留 | P0 | 通过 |
| T2 | buildDocRef 追加「讨论要求」：空行分隔 +「【讨论要求】请在本轮及后续讨论中遵守：」标题 | P0 | 通过 |
| T3 | 讨论要求完整覆盖三条 commit 指令：①同轮同步 git commit 不留未提交改动 ②commit message 含条目单号（动态 id）/本轮用户问题摘要/本轮回答（改动）摘要 ③回显本轮 commit log 与 commit 号（短哈希即可） | P0 | 通过 |
| T4 | 无选中：仍无「原文」节，但同样携带完整「讨论要求」；单行范围仍为「第 x 行」 | P0 | 通过 |
| T5 | 整体为单次复制纯文本：无 Markdown 渲染符号（** ` # 等）混入；条目单号动态取当前条目 id | P1 | 通过 |
| T6 | 三份文档页签与 Bug 抽屉同口径：buildDocRef 为唯一组装点、onDocCtxMenu 仍单点调用（不按文档名分支） | P1 | 通过 |
| T7 | 零回归：toast 摘要 / copyPlain 双回退 / uiCopyBox 手动复制弹窗承载完整新文本的链路改动为零（静态契约沿用既有测试） | P1 | 通过 |
| T8 | 纯前端：buildDocRef 无 api()/fetch() 后端调用、不写文件；既有 doc-ctx 两份测试全绿 | P1 | 通过 |

自动化：`node scripts/tests/doc-ctx-discuss-req-20260914-004.test.mjs`（T1–T8 全覆盖）；
回归：`node scripts/tests/doc-ctx-discuss-20260909-014.test.mjs`、
`node scripts/tests/doc-ctx-discuss-bug-20260913-003.test.mjs`（buildDocRef 新格式兼容断言）。
菜单浮层 / 深浅色 / Electron 壳内目检见条目 ui-demo 口径，不在自动化范围。
