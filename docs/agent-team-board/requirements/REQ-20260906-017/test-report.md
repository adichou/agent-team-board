# 测试报告 — REQ-20260906-017 支持对需求或 bug 单批量接受

- 时间：2026-09-06T08:23:16.006Z
- 执行者：codex-batch-accept
- 测试框架：node:assert + node:vm / V8 源码范围覆盖
- 覆盖率：99.76%

## 总结

已实现需求和 Bug 卡片单条接受、待接受列全选/多选与批量接受、进度和逐项失败反馈、防重复提交及项目切换隔离。TDD 红阶段 10 组失败，最终新增行为测试 11 组全通过。新增三个接受函数 V8 源码范围覆盖率 99.76%，不是全库行覆盖率。完整回归 34 个文件中 33 通过，唯一存量失败为 BUG-20260906-011。浏览器已核对控件显示；点击自动化未获授权，窄屏/主题及真实操作待人工验收。会话改名因宿主应用禁止自动化访问未完成。详见设计、测试用例及 evidence。

## 明细

| 检查 | 结果 | 证据 |
| ---- | ---- | ---- |
| TDD 红阶段 | 10 组全部失败，确认缺失能力 | [red.log](evidence/red.log) |
| TDD 绿阶段 | 最终 11 组全部通过 | [green.log](evidence/green.log) |
| npm test | 34 个文件，33 通过、1 个存量失败 | [full-test.log](evidence/full-test.log) |
| node --check scripts/web/app.js | 通过 | 本次执行退出码 0 |
| V8 覆盖 | 新增三个函数及内部回调覆盖 2883 / 2890 UTF-16 单元，99.76% | [coverage-summary.json](evidence/coverage-summary.json) |
| 真实浏览器 | 操作栏及需求/Bug 卡片接受入口已显示；未完成点击实测 | 后续 Chrome 操作未获授权 |

完整回归的唯一失败是 detail-close-btn.test.mjs / T2：对整个 app.js 禁止 justify-content:space-between，误匹配批量实施抽屉头部。已有独立登记 [BUG-20260906-011](../../bugs/BUG-20260906-011/README.md)，本条目未修改该抽屉布局或其测试。

Node v17.8.0 下集成测试需要沙箱外监听本机临时端口，取得授权后执行上述完整回归。当前目录没有 .git，因此没有生成提交或 Git diff。

## 人工确认

请按 [test-cases.md](test-cases.md) 的人工验收步骤检查实际接受、取消、窄屏、主题与键盘操作，再在本条目点「确认完成」。本次仅 report，状态保持 in-progress，认领锁已按流程释放，未由 Agent 置 accepted 或 done。
