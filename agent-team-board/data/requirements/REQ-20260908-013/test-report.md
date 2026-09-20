# 测试报告 — REQ-20260908-013 讨论单的问题正文改为可选，如果用户没有填则复制标题作为正文。

- 时间：2026-09-08T13:42:37.056Z
- 执行者：zcode-batch-018-1
- 测试框架：node:test 风格自研断言（assert/strict + vm 沙箱）
- 覆盖率：100%

## 总结

讨论单创建正文可空：store 层 createTicket 空白 question 回退已 trim 标题（唯一落点）；前端 submitNew 删拦截、标签/placeholder 注明可留空＝以标题作为正文；CLI atb oncall new 去 die 并同步两处用法文案。test-cases 13/13 用例全过，run-all 90 文件 0 失败；标题必填/追问必填口径不变

## 明细

TDD：先补用例跑红（store S6/S6c、CLI C3、serve H4、UI U1/U2 均红，回归用例基线绿）→ 实现 → 跑绿。

| 用例 | 文件 | 结果 |
| ---- | ---- | ---- |
| S1/S2（可空回退）S3/S4/S7（回归口径） | scripts/tests/oncall-store.test.mjs（S6/S6b） | ✓ |
| S5（留空+附件）S6（派单提示词） | scripts/tests/oncall-store.test.mjs（S6c） | ✓ |
| H1（HTTP 只传 title） | scripts/tests/oncall-serve.test.mjs（H4） | ✓ |
| C1（CLI 无 --question） | scripts/tests/oncall-cli.test.mjs（C3） | ✓ |
| U1（静态契约）U2（沙箱留空提交）U3（回归） | scripts/tests/oncall-question-optional.test.mjs | ✓ |

关键输出（2026-09-08）：

```text
node scripts/tests/oncall-store.test.mjs             → 实现前 S6/S6c 红 → 全部通过（S1~S6c，9 用例）
node scripts/tests/oncall-question-optional.test.mjs → 实现前 U1/U2 红 → 全部通过（U1~U3，3 用例）
node scripts/tests/oncall-cli.test.mjs               → 实现前 C3 红 → 全部通过（C1~C3）
node scripts/tests/oncall-serve.test.mjs             → 实现前 H4 红 → 全部通过（H1~H4）
node scripts/tests/run-all.mjs                       → 共 90 个测试文件，失败 0
```

实现落点：
- scripts/lib/oncall-store.mjs `createTicket()`：空白 question 回退已 trim 的标题（唯一回退落点，askTicket 不动）；
- scripts/web/app.js：`submitNew()` 删 `type === 'ask' && !desc` 拦截；`syncNewFormFields()` 标签「问题正文（Markdown，可留空＝以标题作为正文）」、placeholder 注明留空后果（design 候选文案）；
- scripts/atb.mjs：`oncall new` 去「问题正文不能为空」die；顶层用法与 ONCALL_USAGE 两处同步「正文可留空＝以标题作为正文」。

design〔待确认〕按默认执行：文案用候选、CLI 同步放开、标题 Markdown 不转义、toast 不加额外提示。
