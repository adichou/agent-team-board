# BUG-20260928-014 发布执行不应切换工作区到 main 分支

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-28T14:47:46.163Z

## 现象

发布执行第一阶段 sync-source 执行 git checkout main（scripts/lib/build-publish.mjs），发布无论成败都会把用户工作区永久留在 main 分支（本次 v1.0.0 发布在 site-deploy 失败后工作区停在 main，后续开发提交因此落错分支）。期望：发布全程不切换工作区分支——sync-source 去掉 checkout main，本地校验改为 rev-parse refs/heads/main 比对冻结 SHA，按 SHA 原子推送 main/dev 与远端回验逻辑不变。

## 复现步骤

1.

## 期望行为
