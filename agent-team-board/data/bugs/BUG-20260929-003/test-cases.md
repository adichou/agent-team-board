# 测试用例 — BUG-20260929-003 发布模块硬编码 main 分支：master 主干项目创建发布即报 git rev-parse 失败

> 测试文件：`scripts/tests/bug-20260929-003.test.mjs`（真实临时 Git 仓库夹具，无 mock；复用 `scripts/tests/lib/build-publish-fixture.mjs` 的 makeProject / makeVersion，master 主干形态用 `git branch -m main master` 就地改出；官网仓库夹具沿用 BUG-20260928-014 测试的最小站点）。

| 用例 | 场景 | 断言要点 |
| ---- | ---- | ---- |
| P1 | master 主干项目（本地无 main）全链路发布成功 | ① `create` 不再抛 `git rev-parse 失败：… refs/heads/main`；② 冻结 `mainSha` = master 头，冻结记录新增 `mainBranch='master'`；③ 预检通过（文档合并 / 条目包含性核验按 master）；④ 计划文案推送分支名为 master；⑤ 执行 succeeded：bare 远端 `refs/heads/master` = 冻结 mainSha、`refs/heads/dev` = 冻结 devSha，且远端**不出现** `refs/heads/main`（不额外创建 main）；⑥ 全程工作区仍在 dev、HEAD 未动 |
| P2 | 既有 main 项目行为不变 | `create` 冻结记录 `mainBranch='main'`、`mainSha` = `rev-parse refs/heads/main`（回归锚点，其余行为由既有测试覆盖） |
| N1 | master 项目冻结后 master 前进 → sync-source 拦截 | ① 预检仍通过（main/master 前进不阻塞预检的既有口径）；② 执行失败于 sync-source，错误信息为「master 与冻结源码不一致」（按解析分支名比对）；③ 未通过一致性校验不推送：远端无任何 ref |
| N2 | 本地既无 main 也无 master（仅 dev）→ 维持既有报错路径 | `create` 即抛 AtbError，信息含 `git rev-parse 失败`（resolveMainBranch 返回 null 回退 refs/heads/main，与修复前同报错路径） |

TDD 过程：先写用例对旧实现跑红（P1 在 `create` 处即抛 `git rev-parse 失败：fatal: ambiguous argument 'refs/heads/main'`，复现线上 BUG-20260929-003 现场），实现接入 resolveMainBranch() 后跑绿。

## 回归范围

- `scripts/tests/bug-20260928-014.test.mjs`：sync-source 只读比对 / 原子推送 / 远端回验（main 项目口径，错误文案「main 与冻结源码不一致」须不变）。
- `scripts/tests/build-publish-20260916-001.test.mjs`、`scripts/tests/build-publish-site-vite-20260916-004.test.mjs`、`scripts/tests/bug-20260928-011.test.mjs`：发布全链路与预检口径。
- 全量 `npm test`。

## 边界确认

- 冻结记录 `mainSha` 字段名沿用（语义为「主分支头」），新增 `mainBranch` 字段不破坏 run.json 兼容；UI「冻结 main」等展示标签不在本单范围（design.md 风险节）。
- store.steps 静态标签「源码 main/dev 原子推送」与 build-publish-store validateRepo（官网必须有 main）维持现状，不随本单放宽（design.md 明确排除）。
- 计划 steps 文案为后端动态串（不在 scripts/web/i18n.js 字典，见 BUG-20260928-014 边界确认），分支名动态化不涉及中英文同步改动。
