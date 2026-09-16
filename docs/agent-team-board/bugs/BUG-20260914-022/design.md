# 修复设计与实施记录

## 引入来源（源单）

- REQ-20260914-001（已用 atb show 核验）：legacyConfirmViews 以路径当前是否脏判断旧运行，忽略补交后的新一轮修改。原实现提交 e3ed1c5。

## 实现

新增 scripts/lib/legacy-recovery.mjs，按运行在 confirms/recoveries/<RUN-ID>.json 保存独立处理记录，不改原 auto-commit.json。记录绑定 itemId、runId、原账本 SHA-256、处理类型 committed/withdrawn、审阅者/时间，以及全部 pendingManual 和 heldGroups.test/biz 的路径、证明 commit、blob 与内容审阅说明。

读取恢复列表时验证记录与原运行/账本一致、全部遗留路径覆盖、证明提交在当前 HEAD 历史且不早于原运行提交、路径 blob 与证明一致。补交类型还要求证明提交实际变更该路径。证据不存在仍沿用现有未提交路径恢复；证据失效或损坏保守呈现待核验，即使当前路径干净也不视为已处理。只有同一 runId 的既有确认记录可取代该历史运行，避免同条目新运行继承旧处理结果。

Git 可验证身份与路径覆盖，无法自动证明业务语义；登记者必须核对实际遗留内容及完整测试。不能仅凭单号命中或文件曾提交登记。withdrawn 允许证明撤销后已有基线或删除（blob=null），但必须逐路径说明撤销依据。

## 登记入口

`node scripts/atb.mjs confirm record-recovery <RUN-ID> --evidence <JSON文件> --dir <项目目录>`

这是已完成审阅的历史修复登记，不执行补交、不恢复队列、不验收条目。仅在用户授权历史账本处理后使用；原始证据须保存以便审计。输入包括 type、reviewedBy、note、ledgerDigest（审阅时原账本 SHA-256），paths 数组每项包含 path、完整 commit、blob 或 null、note。运行 ID/条目/原始账本绑定由登记函数核验生成，写入采用临时文件和原子重命名。列表读取不写处理记录。

输入 evidence 的 ledgerDigest 如提供则必须匹配，防止迁移文件重放时绑定已变化的账本。项目内 migration-evidence/*.json 保留本次输入，执行账本仍在 confirms/recoveries（按项目既有规则不进 Git）。

## 现场迁移

11 份证据见 migration-evidence：10 条 committed、BUG-20260914-010 为 withdrawn。每条覆盖 pendingManual 与全部暂扣测试/业务路径，共 52 条路径证明。对照 commit-recovery-20260914.md 和实际 Git 差异；少数复用测试选其真实修改的前置补交 commit，不强行写成本单 commit。010 依 BUG-014 的明确撤销说明、回退测试与 fe567b1 快照，原测试删除使用 null blob。

相关功能与撤销回归均通过；迁移后 legacyConfirmViews 返回 0 条。原始自动提交账本与 BUG-020 活动确认逐字节/对象比对保持不变。

## 授权与边界

用户明确授权本单开发；claim 仍被 BUG-020 项目挂起阻止，沿用本单例外开发授权，通过 atb status in-progress/report 收尾。不解除 BUG-020、不代用户验收、不提交其他任务源码。此修复不处理截断 Git 错误。

## 开源选型

使用现有 Node fs/crypto/child_process 和 Git，不引入运行时依赖；这是少量项目特定账本验证，额外库的引入与维护成本更高。
