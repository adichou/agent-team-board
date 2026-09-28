# BUG-20260928-014 发布执行不应切换工作区到 main 分支

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-28T14:47:46.163Z
- 引入来源：BUG-20260916-001（构建发布执行器：sync-source 阶段以 `git checkout main` 核对冻结源码并推送，从此发布必切走用户工作分支）

## 现象

发布执行第一阶段 `sync-source` 执行 `git checkout main`（`scripts/lib/build-publish.mjs`，dev 版 line 242）。发布执行无论成败都不切回，工作区被永久留在 main：

- 本次 v1.0.0 发布（BPUB-711ea71f）在 site-deploy 阶段失败后，工作区停在 main；
- 后续开发会话在不知情下继续工作，条目创建 / 文档提交落到 main（BUG-20260928-013 登记时即发生，已人工挪回 dev），与「开发提交进 dev」的仓库约定冲突。

## 复现步骤

1. 工作区位于 dev，对已合并且冻结的版本创建发布并确认执行。
2. sync-source 阶段完成（观察 `git branch --show-current` 已变为 main）。
3. 任一后续阶段失败（如 site-deploy）或全部成功。
4. 发布结束后工作区仍在 main，无任何恢复动作。

## 期望行为

- 发布全程不切换用户工作区分支：删除 `sync-source` 的 `git checkout main`。
- 本地一致性校验改为只读比对：`git rev-parse refs/heads/main` 等于冻结 `mainSha`（与原「切过去后 HEAD 比对」同语义，且不依赖当前分支）。
- 按 SHA 原子推送（`<mainSha>:refs/heads/main <devSha>:refs/heads/dev`）与远端 `ls-remote` 回验逻辑保持不变——推送显式 SHA 到远端 ref 本就不要求本地检出该分支。
- 发布前工作区清洁检查（`clean()`）保持不变。
- 发布结束后工作区分支与发布前完全一致（dev 上发布则仍在 dev）。

## 验收标准

1. 从 dev 工作区执行发布（成功或任一阶段失败），全程及结束后 `git branch --show-current` 不变。
2. sync-source 仍能拦截「本地 main 与冻结 SHA 不一致」的情形（用只读 ref 比对实现）。
3. 推送与远端回验行为与原先一致（原子推送两个分支 + ls-remote SHA 核对）。
4. 相关测试按新口径更新并通过；`npm test` 全量通过。
