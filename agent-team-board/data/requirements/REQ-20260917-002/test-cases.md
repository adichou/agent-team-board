# 测试用例 — REQ-20260917-002 调整 state-guard 拦截口径，放行文档讨论轮对看板条目文档的 git 提交

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

测试文件：`scripts/tests/state-guard-20260917-002.test.mjs`（守卫子进程实测）+
`scripts/tests/dev-flow-20260911-009.test.mjs` D10（按新口径改造，保持通过）。

## 放行口径（P 系列：仅含条目目录用户数据 + 主题带单号 → exit 0）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| P1 | 带显式 pathspec 提交条目 markdown（`git commit -m "doc: … REQ-x" <条目README>`）放行 | P0 | ✅ |
| P2 | 目录整体作 pathspec（`…/data/requirements/<ID>`）放行 | P0 | ✅ |
| P3 | 嵌套归属 bug 路径（`data/requirements/<REQ>/bugs/<BUG>/README.md` 与 `data/bugs/<BUG>/`）放行 | P0 | ✅ |
| P4 | 多 pathspec 全部在条目目录内（README + attachments/）放行 | P1 | ✅ |
| P5 | `--` 分隔后的 pathspec 放行 | P1 | ✅ |
| P6 | `git -C <dir> commit … <dir 内条目路径>`：pathspec 按 -C 目录为基准解析后放行 | P1 | ✅ |
| P7 | 相对 hook.cwd 的相对路径与绝对路径 pathspec 均放行；`ui-demo.html`、`attachments/` 在范围内 | P1 | ✅ |
| P8 | 多段 `-m` 拼接后含单号放行；`--message=<msg>` 等价形态放行 | P1 | ✅ |
| P9 | 环境变量赋值前缀（`LC_ALL=C git commit …`）识别为命令位，满足细则则放行 | P2 | ✅ |

## 保护不回退（B 系列：exit 2）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | 裸提交（无 pathspec，主题含单号也不放）拦 | P0 | ✅ |
| B2 | `git commit -a`（暂存区整体形态）拦 | P0 | ✅ |
| B3 | pathspec 含源码路径（scripts/ 下文件，混合条目路径也拦）拦 | P0 | ✅ |
| B4 | pathspec 含 `runtime/status/<ID>.json` 拦 | P0 | ✅ |
| B5 | pathspec 含应用数据路径（`runtime/config.json`、`runtime/commits/…` 账本）拦 | P0 | ✅ |
| B6 | pathspec 越出条目目录（`data/requirements` 整体、`agent-team-board/data` 板级共享路径、`..` 逃逸）拦 | P0 | ✅ |
| B7 | 主题不含条目编号（REQ-/BUG-）拦 | P0 | ✅ |
| B8 | `--amend` / `--only` / `--include` / `--patch` / `--fixup=` 非授权形态拦（待确认项定案：默认按非授权形态拦） | P1 | ✅ |
| B9 | 消息来源不可静态解析（`-F <file>`、`-t`、`-C <commit>` 复用消息、无 -m）拦 | P1 | ✅ |
| B10 | pathspec 含通配符 / magic 前缀（`*`、`:!`、`^` 排除形态）拦（定案：glob 不展开，保守拦） | P1 | ✅ |
| B11 | `--git-dir` / `--work-tree` / `GIT_DIR=` 等改变仓库落点的形态拦 | P2 | ✅ |
| B12 | `;` / `&&` 拼接的无 pathspec 真实提交分段后仍拦（分段既有能力保持） | P0 | ✅ |
| B13 | `bash -c 'git commit -m x'`、`eval "git commit …"` 再解释执行形态拦 | P1 | ✅ |
| B14 | `xargs git commit`、`find … -exec git commit \;` 间接执行形态拦 | P1 | ✅ |
| B15 | `echo 'git commit -m x' | bash`：stdin shell 消费与含提交序列段关联后拦 | P2 | ✅ |

## 文本误拦消除（N 系列：非提交命令 → exit 0）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| N1 | `node atb.mjs new req --desc "…流程外 git commit 已拦截…"`（本单登记实例）放行 | P0 | ✅ |
| N2 | `grep "git commit" README.md` / `echo "git commit -m x"` 参数文本引用放行 | P0 | ✅ |
| N3 | 无看板上下文项目内 `git commit` 放行（管辖判定不变，维持现状） | P0 | ✅ |
| N4 | `git add -A && git status --short` 放行（非 commit 子命令维持现状） | P0 | ✅ |
| N5 | `git log` / `git diff` 等非 commit 子命令放行 | P1 | ✅ |

## 场景与回归

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| E1 | 讨论轮端到端：submitted 条目编辑 markdown 后以带 pathspec + 主题含单号提交，守卫放行且真实 git commit 成功落库 | P0 | ✅ |
| D10 | REQ-20260911-009 既有 D10 用例改造后保持通过（无 pathspec 一律拦、CMT 残留不豁免、无看板放行、git add 放行） | P0 | ✅ |
