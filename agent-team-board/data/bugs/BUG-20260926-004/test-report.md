# 测试报告 — BUG-20260926-004 发布范围变化（scopeStale）后逐文件通过审核永不生效，审查与提交门禁互相死锁

- 时间：2026-09-26T10:04:53.847Z
- 执行者：zcode-batch-074-1
- 测试框架：node:assert/strict + node:vm
- 覆盖率：10%

## 总结

修复 scopeStale 死锁（方案 1）：求值侧 approved 去 !scopeStale 改为 hash 一致 + 审核时点晚于 scopeChangedAt 时点校验（存量以 committedAt 兜底、缺失安全侧），scopeStale 后逐文件审核可恢复；markDocsScopeStale 落盘 scopeChangedAt、提交重置；提交端点 noop 恢复路径重固化文档记录清除 scopeStale、拦截文案如实附范围变化上下文；审查对话框加失效横幅、toast 计数随求值一致；i18n 中英同步；merge 门禁与既有口径不回退。新增 bug-20260926-004.test.mjs 15 例先红后绿，npm test 358 文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
