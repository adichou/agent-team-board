# 测试报告 — BUG-20260912-001 中英文国际化要求在批量开发提示词中添加要求，确保每次开发都要确保中英资源正确

- 时间：2026-09-11T18:52:20.269Z
- 执行者：zcode-batch-041-1
- 测试框架：node --test (run-all.mjs)
- 覆盖率：100%

## 总结

引入来源REQ-20260911-009（经list核验）：Git工作流状态行整句动态拼接成单文本节点，动态键捕获组原样回填致英文残留「已存在/未创建」，静态词条永不命中。修复：app.js状态行分支名与状态词各包span拆独立文本节点（仍零i18n引用），词典补「当前分支：」「· dev 分支：」两段词条并移除不可达旧动态键，translateTree补尾随空白往返重试。新增bug-git-status-i18n-20260912-001测试6例先红后绿，i18n五件套全绿，全量205测试文件0失败。

## 明细

- 新测试：node scripts/tests/bug-git-status-i18n-20260912-001.test.mjs → 共 6 例，全部通过
  - T1 英文态整行 `Current branch: main · dev branch: exists / not created`，无中文残留
  - T1b 分支名 `feature/x` 原样保留（用户数据不误翻）；缺省「未知」→ `Unknown`
  - T2 en→zh 往返还原 `当前分支：main · dev 分支：已存在`
  - T3 词典词条 + t() 契约；T4 app.js 结构契约（span 拆段）；T5 旧动态键移除
- TDD 轨迹：T1 首跑红（实际输出 `当前分支：main · dev 分支：exists`）→ 实施 → 全绿
- 回归：i18n-coverage / dict / lang / runtime / wiring 与 git-workflow-desc-20260912-001 全绿；
  全量 `node scripts/tests/run-all.mjs` 共 205 个测试文件，失败 0（基线 204 文件 0 失败）
- 改动：scripts/web/app.js（状态行 span 拆段）、scripts/web/i18n.js（+2 词条、-1 不可达动态键、
  translateTree 尾随空白往返重试）、新增上述测试文件
- 实施细节与风险边界见条目 design.md「实施记录」；用例清单见条目 test-cases.md
- 英文态真实页面视觉验收待人工（顶栏 EN 切换后查看设置 → Git 工作流）
