# 设计 — BUG-20260928-014 发布执行不应切换工作区到 main 分支

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260916-001（构建发布执行器：sync-source 阶段以 `git checkout main` + `rev-parse HEAD` 比对冻结源码并原子推送——切分支仅为本地 HEAD 校验服务，属实现选择而非必要条件）

## 根因分析

`scripts/lib/build-publish.mjs` `execute()` 第一阶段 `sync-source`（dev 版 line 241-249）：

```js
await clean(root);await git(root,'checkout','main');
if(await git(root,'rev-parse','HEAD')!==run.frozen.mainSha)throw Error('main 与冻结源码不一致');
await git(root,'push','--atomic',…);
```

切到 main 只是为了「HEAD == 冻结 mainSha」这一个校验；推送用的是显式 SHA 的 refspec（`<sha>:refs/heads/main`），本就不要求本地检出该分支；远端回验用 `ls-remote` 也不依赖本地分支。而失败 / 成功收尾均无恢复动作，`finally` 只释放进程内锁——于是发布必把工作区留在 main，污染后续开发分支状态（BUG-20260928-013 登记时条目提交落错分支即其实害）。

## 方案

`sync-source` 去掉 `git checkout main`，其余动作语义不变：

1. 保留 `clean(root)` 工作区清洁检查。
2. 本地校验改只读 ref 比对：`git rev-parse refs/heads/main` !== 冻结 `mainSha` 时报原错误「main 与冻结源码不一致」（比原先更强：直接断言本地 main ref 本身，而非检出后的 HEAD）。
3. 原子推送与 `ls-remote` 远端 SHA 回验原样保留。

技术依据：`git push <remote> <sha>:refs/heads/<branch>` 推送本地任意 commit 到远端 ref，不要求该分支被检出；执行器其余阶段（webapp-build 用 detach worktree、两个 verify 用本机 HTTP 服务）均不依赖当前分支。

测试：`scripts/tests/` 中 build-publish 相关用例改为断言「执行全程未调用 checkout main / 工作区分支不变」+「本地 main 与冻结不一致仍拦截」+「推送 refspec 与远端回验不变」（TDD：先改用例跑红，再实现跑绿）。

**开源选型（REQ-20260909-015）**：既有自研执行器的最小修正，仅调整 git 子命令序列，不引入新依赖，不适用开源选型。

## 风险与边界

- 行为差异：原先 checkout 会因本地分支与冻结不一致直接暴露 HEAD 差异；改后同样拦截（rev-parse 比对），错误信息不变。
- 若本地不存在 `refs/heads/main`（裸异常路径），`rev-parse` 失败按 AtbError 包装报出，与原 checkout 失败路径同为发布失败，语义一致。
- 存量已失败的发布 run（如 BPUB-711ea71f）重试时 sync-source 已是 done 会被跳过，不受本改动影响；新 run 全程不再切分支。
- 不改变推送内容与远端回验口径；不处理「发布后自动切回」这类补偿逻辑（不再需要）。
