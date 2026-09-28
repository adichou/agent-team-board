# 测试用例 — BUG-20260928-014 发布执行不应切换工作区到 main 分支

> 测试文件：`scripts/tests/bug-20260928-014.test.mjs`（真实临时 Git 仓库夹具，无 mock；复用 `scripts/tests/lib/build-publish-fixture.mjs` 的 makeProject / makeVersion 与最小官网仓库夹具）。

| 用例 | 场景 | 断言要点 |
| ---- | ---- | ---- |
| P1 | 从 dev 工作区全链路发布成功 | ① 最终 status=succeeded（webapp / site 两目标 done）；② 计划文案不再宣称「切换源码」，改为「不切换工作区分支 + 原子推送」；③ 发布结束后 `git branch --show-current` 仍为 dev、`rev-parse HEAD` 等于 dev 头（全程 HEAD 未动）；④ bare 远端 main / dev SHA 均等于冻结值（推送与 ls-remote 回验口径不变） |
| N1 | 冻结后本地 main 前进 → sync-source 拦截 | ① 预检仍通过（BUG-20260928-011 口径：main 前进不阻塞预检）；② 执行失败于 sync-source 阶段，错误信息仍为「main 与冻结源码不一致」（只读 `rev-parse refs/heads/main` 比对）；③ 拦截时工作区仍在 dev、HEAD 未动；④ 未通过校验不推送（远端无任何 ref） |
| N2 | site-deploy 中途失败（复现 BPUB-711ea71f 现场） | ① 失败于 site-deploy 阶段（apps.js 未注册产品）；② 失败后工作区仍在 dev；③ 失败前 sync-source 已完成推送：远端 main / dev SHA 等于冻结值（证明推送不依赖本地检出 main） |

TDD 过程：先写用例对旧实现跑红（P1 在「计划文案不含切换源码」断言处失败，且旧行为会把工作区留在 main），实现后跑绿。

## 回归范围

- `scripts/tests/build-publish-20260916-001.test.mjs`：全链路执行 / 计划确认 / 防重复 / 全局配置失效。
- `scripts/tests/build-publish-site-vite-20260916-004.test.mjs`：官网目标全链路（P1–N1、D1–V2）。
- `scripts/tests/bug-20260928-011.test.mjs`：预检口径（12 用例）。
- 全量 `npm test`。

## 边界确认

- 计划 steps 文案（含动态 SHA）本就不在 i18n 字典（scripts/web/i18n.js 无对应词条，UI 不再渲染 run plan steps），文案调整不涉及中英文同步改动。
- webapp-build 用 detach worktree、两个 verify 用本机 HTTP 服务，均不依赖当前分支（design.md 技术依据）。
