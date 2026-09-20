# 测试报告 — BUG-20260912-003 提交号显示优化

- 时间：2026-09-11T19:16:23.490Z
- 执行者：batch-20260912-041
- 测试框架：node assert (run-all.mjs)
- 覆盖率：100%

## 总结

引入来源BUG-20260910-014（经list核验）：徽标+折叠+全量hash+按钮复制四层冗余。改5位短号直显（title留完整值）、去已提交徽标与折叠、双击短号复制完整hash（stopPropagation不误开抽屉）、复制成功copied高亮+toast；i18n增2词条清3旧键。新增bug-commit-hash-display-20260912-003测试7例先红后绿，更新U6/U9与R10至新口径，全量206测试文件0失败。

## 明细

- 新测试：node scripts/tests/bug-commit-hash-display-20260912-003.test.mjs → 共 7 例，全部通过
  - T1 徽标移除：有记录无「已提交」/无折叠层，列表卡 inline 直显提交号列表；详情位 badge 返回空、
    由 commitStatusDetailHtml 渲染，两处口径一致不重复
  - T2 短号展示：code.commit-hash 文本为前 5 位；title 含完整 40 位 hash；无「复制」按钮
  - T3 双击复制：dblclick → copyHash 且 stopPropagation；单击不复制不冒泡；卡片 bindCommitWidgets
    先于 openDrawer 行点击绑定；drawer 同样绑定
  - T4 复制口径：clipboard.writeText(hash) 完整值；execCommand 降级保留；copied 高亮 + 成功 toast；
    失败「请手动框选完整提交号」保留
  - T5 回归：未提交/加载失败重试/非完成条目不渲染，均与原口径一致
  - T6 i18n：EN_DYNAMIC 增「完整提交号：◇（双击复制完整值）」「✓ 已复制完整提交号 ◇…」；
    清理「已提交」「◇ 个提交号」「复制提交号 ◇」不可达键
  - T7 样式：cm-committed/commit-hashes/commit-hash-row 死样式清理；cursor: copy + .copied 高亮
- TDD 轨迹：T1–T7 首跑 7 例全红（应存在 commitShortHash / 徽标样式应移除等）→ 实施 → 全绿；
  随后按新口径更新既有 U6/U9（commit-ui-20260910-014）与 R10（commit-rollback-20260911-010），
  U7/U8 与 dev-flow D12 未动仍绿
- 回归：全量 `node scripts/tests/run-all.mjs` 共 206 个测试文件，失败 0（基线 205 文件 0 失败）
- 改动：scripts/web/app.js（提交状态展示五处）、scripts/web/style.css、scripts/web/i18n.js、
  新增上述测试文件、更新两个既有测试文件
- 实施细节与风险边界见条目 design.md「实施记录」；用例清单见条目 test-cases.md
- 页面视觉与双击复制手感待人工在 Status Board 验收（测试为源码级静态/VM 断言）
