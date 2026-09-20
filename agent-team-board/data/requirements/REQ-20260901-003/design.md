# 设计 — REQ-20260901-003 钩子硬约束插件代码改动：必须先登记并认领条目

> 由 Agent 在 /dev 阶段一补充，人可随时批注。**状态：待对齐（方案初稿，未经人工确认不得实施）。**
> README 已给出方案 A/B/C 轮廓与开放设计点，本文按方案 A 展开为可实施方案。

## 背景

Agent 曾在口头同意后直接改插件源码（已回退），纯文档规范无强制力。现有守卫（state-guard.mjs）只保护看板
status.json 与人工状态命令，不覆盖插件源码本身。目标：把「改插件代码必须先在看板登记并认领」升级为
PreToolUse 确定性约束——与状态守卫同级的防护姿态（常规路径确定性拦截，蓄意绕过属违规）。

## 方案（初稿，待对齐；采纳 README 方案 A）

### 1. 守卫范围（守卫如何定位"插件源码根"）

- 钩子脚本自身位于 `<插件根>/scripts/`，以 `import.meta.url` 向上两级解析**真实路径**
  （`fs.realpathSync`，兼容 `~/plugins/agent-team-board` 软链 → 源码仓库，以及 ZCode 缓存副本两种安装形态）。
- 受保护路径 = 插件根下：`scripts/`、`commands/`、`skills/`、`hooks/`、`.zcode-plugin/`、`.codex-plugin/`、
  `assets/`（若存在）及根级文件（README.md、.gitignore 等）。
- **豁免**：`docs/` 整个看板数据目录（markdown 直改是既有能力；status.json 已由 state-guard 保护，互不重复）。

### 2. 放行条件（认领锁即工作许可）

- 检查 `<项目看板>/.locks/` 下是否存在**未过期认领锁**（claim 经 O_EXCL 创建，含 owner/时间戳，24h 过期接管，
  人工驳回即删——复用现有机制，零新增状态）。
- 看板目录解析：与 core.dataDirFrom 相同的向上探测（cwd 向上找 `docs/agent-team-board`）；项目无看板 = 无锁 =
  一律拦截（改插件源码前必须先 init + 登记 + 接受 + claim）。
- 锁属主不校验（开放点 3 的简化取舍，见下）：任一有效锁存在即放行整个插件源码区。
  理由：并行会话各自持锁的场景下，文件级归属校验成本高、误拦率高；当前单人使用风险可控。

### 3. 拦截行为与提示

- **Write/Edit 挂点**（matcher `Edit|Write`）：`tool_input.file_path` 解析为真实路径后落入保护路径且无有效锁 →
  exit 2，提示：「插件源码受看板流程保护：请先 /req 或 /bug 登记 → 人工接受 → /dev 认领（claim 产生认领锁）
  后再改代码。当前项目看板无有效认领锁。」
- **Bash 挂点**（matcher `Bash`，并入 state-guard 或新脚本均可——**建议并入 state-guard.mjs 新增 code 模式**，
  减少钩子注册条数）：切段检测后，任一段落命中"改写类动词 + 插件源码路径特征"（`sed|tee|cp|mv|rm|>|>>` 与
  `scripts/|commands/|skills/|hooks/` 或插件根路径同时出现）且无有效锁 → exit 2 同上提示。
  只读命令（cat/ls/grep/node 运行测试）不拦——**同时顺带修复 BUG-20260901-002 的误报问题**（state-guard
  bash 模式当前把「命令文本同时提及看板目录与 status.json 字样」的只读命令也拦了，本需求重构切段判定时一并
  改为「改写意图 + 目标特征」双条件）。

### 4. 钩子注册（hooks/hooks.json）

```
PreToolUse:
  Edit|Write → state-guard.mjs file   （现有，内部扩展：status.json 规则 + 源码保护规则）
  Bash       → state-guard.mjs bash   （现有，内部扩展：人工状态 + 源码改写 + 误报修复）
```
不新增挂点与脚本文件，全部在 state-guard.mjs 内扩展（file 模式加路径判定、bash 模式加切段判定）。

### 5. 测试策略

新增 `scripts/tests/code-guard.test.mjs`（子进程实测钩子，模式同 state-guard 现有测法）：
- G1 无锁：Write/Edit 指向插件源码 → exit 2；提示含流程指引
- G2 无锁：Bash `sed -i … scripts/web/app.js` / `echo > commands/dev.md` → exit 2
- G3 有效锁存在（临时项目造锁）：同类命令 → exit 0 放行
- G4 豁免：看板 markdown 直改（Write 指向 docs/…/README.md）→ 0；status.json 直写仍 2（原规则）
- G5 只读不误报：`cat docs/…/status.json`、`node scripts/tests/layout.test.mjs` → 0（覆盖 BUG-002 修复）
- G6 看板不存在（无 init 项目）：改插件源码 → 2
- 回归：八套既有测试全绿（state-guard 行为变化需同步其断言）

## 影响面

`scripts/state-guard.mjs`（主要扩展）、`hooks/hooks.json`（不变，模式内扩展）、新增 code-guard.test.mjs；
SKILL.md 铁律区补一条「插件源码改动必须有有效认领锁」。不改 core/server/前端。

## 风险与边界

- 蓄意绕过（base64、间接变量拼路径）理论上可行——与现有守卫同级防护姿态，绕过即违规（README 已认可）。
- 锁属主不校验（开放点 3 简化）：任一有效锁放行全区。若你要求"锁与条目影响面文件级匹配"（开放点 2）或
  "绑定会话身份"，实现复杂度显著上升，建议二期。
- 过渡期：当前已存在 12 条 in-progress 条目的锁仍有效（>24h 会被过期接管——按现有 CLAIM_LOCK_STALE_MS），
  实施后若锁恰好全部过期，改码需重新 claim，属预期行为。

## 待对齐确认点

1. 放行粒度：任一有效认领锁放行全区（本方案）？还是要求锁属主/条目与改动文件匹配（更强，复杂）？
2. report 之后锁是否保留（现状：保留至人工驳回/过期——即待确认期间可继续修码，保持现状？）。
3. BUG-20260901-002（守卫误报）在本需求内一并修复（方案 3 已含）还是单独走它的流程？
