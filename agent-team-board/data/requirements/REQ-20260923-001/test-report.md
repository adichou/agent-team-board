# 测试报告 — REQ-20260923-001 发布看板中的文档编写页面，新增加的文档也要像README.md 一样豁免，允许 Agent 和人自由修改。

- 时间：2026-09-23T05:06:38.711Z
- 执行者：zcode-batch-065-1（run-20260923-356）
- 测试框架：node 子进程实测（scripts/tests/req-20260923-001.test.mjs，12 用例 + 基线随动两套件 + npm test 337 文件 0 失败）
- 覆盖率：12 用例（R1–R4 / X1–X3 / C1–C3 / L1 / E1）

## 总结

守卫豁免扩展到插件根第一层全部发布文档：四类标准文档（README/CHANGELOG/FEATURES/AGENTS）+ v.customDocs 清单内自定义文档（多版本并集），file/Bash 改写与 pathspec 提交（主题「类型: 描述 单号」）三通道同口径放行；语言变体/LICENSE 维持拦截（待确认项保守），AGENTS.md 口径同步，基线测试随动修订

## 明细

### 结果总览

| 套件 | 结果 |
| ---- | ---- |
| scripts/tests/req-20260923-001.test.mjs（本单新增，12 用例） | 全部通过（先红：R1/R2/R3/C1/E1 五例在实现前按旧口径失败；实现后全绿） |
| scripts/tests/req-20260918-002.test.mjs（基线随动修订） | 全部通过 |
| scripts/tests/code-guard.test.mjs（固件依赖随动） | 全部通过 |
| `npm test` 全量（run-all.mjs，337 个测试文件） | 失败 0 |

### 改动清单

- `scripts/state-guard.mjs`：新增豁免清单（PUBLISH_DOC_KEYS 四类 + `<插件根>/agent-team-board/
  runtime/builds/versions/*/version.json` 的 v.customDocs 并集，进程内缓存）；
  `realpathAncestralHitsPluginRoot` / `isPluginRootExemptDoc`（原 isPluginRootReadme 泛化）/
  `pathspecIsExemptRootDoc` / 提交通道 ②（docCommitOk）改用清单判定；头部注释与
  COMMIT_SCOPE_HINT 提示文案同步。
- `scripts/tests/req-20260923-001.test.mjs`：新增（R1–R4 / X1–X3 / C1–C3 / L1 / E1）。
- `scripts/tests/req-20260918-002.test.mjs`：X1 拦截面移出 AGENTS.md（改入恒不豁免的
  LICENSE.md）、C2 混合 pathspec 样本 AGENTS.md → LICENSE.md、伪插件固件补
  publish-flow.mjs 依赖副本。
- `scripts/tests/code-guard.test.mjs`：伪插件固件补 publish-flow.mjs 依赖副本。
- `AGENTS.md`：「例外：根 README.md」扩展为「插件根第一层发布文档」口径；速查表
  「无认领锁改源码被拦」「Bash 里 git commit 被拦」两行补发布文档豁免 / 提交放行口径。

### 「待确认」四项落定口径（保守执行，待人工复核）

1. 语言变体（`<KEY>_<lang>.md`、点号命名 README.en.md）：**不豁免**（维持拦截）。
2. LICENSE.md：**不豁免**（保留名不可能进 customDocs）；DESIGN.md 仅当在某版本记录
   `v.customDocs` 清单内时随清单豁免（本仓库当前 BLD-20260923-001 已加入 DESIGN，故实际豁免）。
3. 多版本清单取值：**全部版本记录 customDocs 并集**——守卫静态判定无「当前活跃版本」
   可用；比「仅活跃版本」宽（旧版本记录仍列出的文档保持豁免），此差异已列明供人工落定，
   落定前如需收紧只需改 `exemptRootDocNames()` 取值口径。
4. 提交主题：沿用「类型: 描述 单号」（validateCommitSubject），与 README 通道同口径。

### 行为对照（验收参考）

- 改动前：无锁编辑根 CHANGELOG.md / FEATURES.md / AGENTS.md / 清单内自定义文档被拦
  （「插件源码受保护」）；仅含这些文档的 git commit 被拦（「流程外 git commit 已拦截」）。
- 改动后：同操作放行（file / apply_patch / sed / tee / 重定向 / pathspec 提交全通道）；
  pathspec 混入源码或 runtime 数据、无 pathspec 裸提交、主题不合规、`--amend` 等仍拦
  （E1 端到端核验 pathspec 提交不夹带 staged 源码）。

### 备注

- 条目目录内原 design.md 为另一单（DESIGN.md 章节）误留稿（内容已在根 DESIGN.md 落地），
  实施时覆写为本单设计（口径落定记录见 design.md）。
- 本单不改文档编写页界面，无 i18n 文案改动（守卫 stderr 提示非界面文案）。
- 根 CHANGELOG.md / DESIGN.md / FEATURES.md / README.md 存在认领前已有的未提交改动
  （用户发布文档编辑），本单未触碰；收口快照归因不含这些文件。
