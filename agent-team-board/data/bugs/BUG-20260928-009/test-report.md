# 测试报告 — BUG-20260928-009 发布文档语言变体缺少中英文切换行，旧 README.en.md 残留未清理

- 时间：2026-09-28T08:33:56.602Z
- 执行者：BUG-20260928-009
- 测试框架：node:assert
- 覆盖率：14%

## 总结

提示词三处对齐恢复语言切换行：新增 docLangSwitchLine(key,langs)（语言集全互链，cn,en→[中文](./README.md) | [English](./README_en.md)）；总结提示词写作约束加切换行规则+运行参数区给具体行（保静态前缀/字节稳定），翻译提示词加镜像规则（固定结构不视为基准外新增），校对提示词加切换行核查项；git rm README.en.md（git ls-files 已不含；根第一层文档按 REQ-20260923-002 不随收口提交，删除差异留工作区由人工提交）；存量 _en 文档待下一轮发布流程自然带上；TDD 先红后绿，同步 6 个旧测试收窄口径，npm test 374 文件 0 败

## 明细

- 新增测试：scripts/tests/bug-20260928-009.test.mjs（14 用例；按 BUG-20260922-003 口径测流水线行为——提示词生成，不测文档内容本身；L2 测仓库状态契约：README.en.md 不再被 git 跟踪、根发布文档无悬空链接）
- 红阶段：11/14 败（docLangSwitchLine 未实现、三处提示词无切换行规则、README.en.md 仍被跟踪）；4 项回归 / 既有状态断言先绿
- 同步旧测试（收窄断言改为「默认语言文档清单 / 校对清单」区段，切换行示例合法含剩余语言变体；doc-entry 路径清单移除已删除的 README.en.md）：
  - scripts/tests/req-20260920-003.test.mjs（L1-4 清单区收窄）
  - scripts/tests/req-20260921-008.test.mjs（L1-6 清单区收窄）
  - scripts/tests/req-20260921-010.test.mjs（L1-5 清单区收窄 + 英文首语言 README_cn.md 断言拆分）
  - scripts/tests/req-20260921-012.test.mjs（清单区收窄 ×2，含 server 返回提示词）
  - scripts/tests/req-20260924-001.test.mjs（校对清单区收窄）
  - scripts/tests/req-doc-entry-20260916-003.test.mjs（A1/B3 移除 README.en.md）
  - req-20260921-006 / req-20260922-002 / req-20260922-003 经实现侧调整（静态前缀 / LICENSE 不进总结提示词 / 无自定义字节稳定）后原断言直接通过，未改测试
- 实现细节：总结提示词静态约束行不含语言集内容（REQ-20260921-006 静态前缀跨语言集逐字一致），具体切换行置于尾部运行参数区；无自定义时不出现「自定义」字样（REQ-20260922-003 字节稳定）；LICENSE 不进总结提示词（清单天然不含）
- npm test：共 374 个测试文件，失败 0
- 删除核验：`git ls-files | grep -i '^readme'` → README.md / README_en.md；全仓 README.en.md 引用仅剩历史条目文档（冻结历史）；README.en.md 删除差异（已出索引）按 REQ-20260923-002 留工作区，最终提交由人工完成
