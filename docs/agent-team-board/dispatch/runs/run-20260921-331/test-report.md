# 测试报告 — BUG-20260921-014 去掉合并入 main 页签下面的发布范围区域（run-20260921-331）

- 日期：2026-09-21　执行：zcode-batch-060-5（批次 batch-20260921-060）
- 新增测试：`scripts/tests/bug-build-merge-scope-removal-20260921-014.test.mjs`（TDD 先红后绿，
  5 例 M1~M4 + S1；实现前 M1/M2/S1 跑红、M3/M4 为零回归守卫基线，实现后 5/5 跑绿；
  输出见同目录 test-output.log）
  - M1 有关联条目（可合并 + 有文档提交 hash）：合并页签首区块直接为「隔离分析」，
    顺序保持 隔离分析 → 分支提示 → 主按钮（+ 说明），无「发布范围」标题 / 空态提示 /
    「只随本版发布最新文档提交」行；
  - M2 无关联条目 / failed（部分合并重试）/ merged（已合并）三态均无该区块与残留；
    门禁禁用原因、失败原因 + 重试按钮、合并完成信息保留；
  - M3 加载中 / 读取失败态行为不变（错误条 + 重试入口保留，本就不渲染该区块）；
  - M4 信息不丢失：「关联条目与提交」页签仍展示条目 + commit + 失败徽标；「文档编写」
    页签门禁条仍显文档提交 hash；合并确认弹窗仍列完整 commit 清单（REQ-20260920-003 口径）；
  - S1 静态契约：renderMergePane 源码无发布范围区块 / 死变量 scopeRows / 残留文案；
    i18n 词典 EN / EN_DYNAMIC 均无「发布范围」死词条；其余 web 模块无该标题输出。
- 回归：`bug-build-merge-click-feedback-20260920-006.test.mjs`（现有引用 renderMergePane 的测试）
  保持通过；`npm test` 全量 312 个测试文件失败 0（一次并发偶发 bug-leak-residue-20260914-013
  单独复跑通过、再全量复跑通过，与本单改动无关——本单未触碰任何端口/进程基建）。
- 改动面：仅 `scripts/web/build.js`（renderMergePane 删区块与死变量）+ `scripts/web/i18n.js`
  （删死词条 '发布范围': 'Release scope'）+ 新增测试文件 + 条目 design.md 归因；不改后端 /
  发布流程语义。
