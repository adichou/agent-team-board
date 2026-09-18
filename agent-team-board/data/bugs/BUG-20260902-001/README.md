# BUG-20260902-001 Codex 命令迁移缺失：dev.md 正文超 token 估算上限，source-command-dev 不生成

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-02T10:50:47.613Z

## 现象

现象：Codex 0.3.10 缓存里 migrated-command-skills 只有 board/bug/req 三个，source-command-dev 缺失；remove+add 重装无效。

根因（隔离 CODEX_HOME 沙箱二分实验，2026-09-02）：Codex 安装器对含 $ARGUMENTS 的命令跳过迁移（已知）；此外对正文 token 估算超限（约 1K token 量级）的命令同样跳过——中文字符每字符≈1 token，dev.md 正文（约 4.3KB、含循环模式细则）估算超限；等字节数 ASCII 正文不超限可迁移，逐段/减半均可迁移，仅完整正文失败。今晨 0.3.1 时代 dev.md 较短可迁移，今日 loop 模式改版加长后越限（引入来源待修复阶段核验）。

修复方案（沙箱已验证可行，实施细节待对齐后执行）：压缩 commands/dev.md「循环模式」节为一段总述+指向 SKILL.md「会话调度规则」（细则已在该节），正文控制在 ~3.4KB 内；沙箱迁移验证通过后 bump 版本并 Codex remove+add 重装。

细化（阶段一补充）：
- dev.md 循环模式节压缩后仍保留契约关键词（/dev loop、循环模式、直到没有 accepted、失败跳过、批量对齐、结束总结），满足 loop-mode.test.mjs 对 dev.md 的断言下限；细则句（两阶段兼容表述、条目状态保持等）由 SKILL.md 承载，loop-mode 断言相应加 SKILL.md 兜底分支，避免措辞误报。
- 压缩后统计 dev.md 字节数（目标 <3.5KB）写入 test-report；新增静态断言（loop-mode 或 skill-desc 内）：dev.md ≤3600 字节，防再次超限回归。
- 引入来源在修复阶段核验写入（候选：BUG-20260901-001 恢复条款与 REQ-20260831-001 重写共同加长正文；按实际 diff 界定）。

验收标准：
1. 沙箱与真实重装后 migrated-command-skills 含全部 4 个 source-command-*；
2. dev.md 迁移产物与源文件正文一致（Command Template 逐字对应）；
3. ZCode 端 /dev 行为不变：loop 细则（认领冲突跳过、批量对齐须明确同意、结束总结）仍完整可达（SKILL.md 会话调度规则保留）；
4. 版本 bump，Codex 端重装生效。

## 复现步骤

1.

## 期望行为

## 根因分析与修复（2026-09-02 阶段二）

【引入来源：REQ-20260831-001 与 BUG-20260901-001（两者先后加长 commands/dev.md：前者引入两阶段流程重写全文，
后者恢复失败跳过条款再增篇幅；叠加后正文 4511 字节越 Codex 迁移 token 上限；两个来源 ID 均已核验存在）】

修复：dev.md 全文压缩精炼（4511→3156 字节，低于 3600 上限；骨架保留全部流程要点与契约关键词，
细则明确指向 SKILL.md「会话调度规则」）；loop-mode.test.mjs #2/#3 断言加 SKILL 兜底分支 + 新增 dev.md
≤3600 字节硬上限断言防回归。loop-mode 7/7 绿。

## 关联

- 引入来源：REQ-20260831-001（两阶段重写显著加长 dev.md 正文）、BUG-20260901-001（恢复失败跳过条款再加长）
- 相关：REQ-20260902-001（SKILL 触发描述收窄，同属 token 成本治理）
