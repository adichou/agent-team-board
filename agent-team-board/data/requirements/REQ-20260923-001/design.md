# 设计：REQ-20260923-001 发布文档豁免扩展（像 README.md 一样豁免）

> 本文件为实施设计；原目录内曾误留另一单（DESIGN.md 发布管理 / 质量管理章节）的设计稿，
> 该内容已在根 DESIGN.md 落地，与本单无关，实施时覆写为本设计。

## 改动范围

仅改守卫拦截口径，不改文档编写页界面：

1. `scripts/state-guard.mjs` —— file / bash 两模式的「插件源码保护」豁免口径与提交通道 ② 口径。
2. `scripts/tests/req-20260923-001.test.mjs` —— 新增测试（TDD 先红后绿）。
3. `scripts/tests/req-20260918-002.test.mjs` / `scripts/tests/code-guard.test.mjs` —— 基线随动
   （AGENTS.md 从拦截面移出、伪插件固件补 publish-flow.mjs 依赖副本）。
4. `AGENTS.md` —— 协作文档豁免口径说明同步。

## 豁免清单事实源

- **四类标准发布文档**：复用 `scripts/lib/publish-flow.mjs` `PUBLISH_DOC_KEYS`
  （README / CHANGELOG / FEATURES / AGENTS → 各 `<KEY>.md`），单一事实源、不复制常量。
- **自定义文档**：以版本记录 `v.customDocs` 为事实源，读取
  `<插件根>/agent-team-board/runtime/builds/versions/<BLD-*>/version.json`
  （发布文档位于板根上一级 = 插件根第一层，守卫按目标落点取值、与 hook.cwd 无关；
  归一复用 `customDocsOf`：大写 / 去重 / 过滤非法与保留名）。
  目录不存在（缓存安装形态）→ 仅标准四类，容错不抛错。

## 「待确认」四项的落定口径（按 README「落定前不弱化既有拦截」保守执行，待人工复核）

1. **语言变体不豁免**：`<KEY>_<lang>.md`（README_en.md / MIGRATION_en.md）与点号命名
   （README.en.md）维持拦截。豁免集合只含默认语言 `<KEY>.md` 单文件。
2. **LICENSE.md 不豁免**：单文件类，保留名不可能进 `customDocs`；`DESIGN.md` 不在
   `PUBLISH_DOC_KEYS` 内、本身不豁免，仅当被加入某版本记录 `customDocs`（本仓库当前
   BLD-20260923-001 已加入）时随清单豁免——与规则 4「清单为事实源」一致。
3. **多版本取并集**：守卫做静态判定、无「当前活跃版本」可用，豁免 = 全部版本记录
   `customDocs` 并集；任一版本记录列出即可编辑，移出全部清单后恢复拦截。
   （比「仅活跃版本」口径宽的部分已在此列明，供人工落定复核。）
4. **提交主题沿用现行口径**：复用 `lib/commit-store.mjs` `validateCommitSubject`
   （「类型: 描述 单号」，单号取主题行首个条目编号），与 README 通道完全同口径。

## 判定实现要点

- `realpathAncestralHitsPluginRoot`：目标存在时以相对插件根首段比对豁免清单
  （精确到第一层单文件，大小写敏感——与既有 README 口径一致）；目标不存在（新建文件）
  时祖先回溯后剩余段恰一段且在清单内才豁免（比旧 README 判定更严：目录形态 `README.md/x`
  不再顺带豁免，符合规则 5「精确到单文件」）。`docs/`、`agent-team-board/` 整目录豁免不变。
- `isPluginRootReadme` 泛化为 `isPluginRootExemptDoc`（提交通道 pathspec 判定同源），
  通道 ② 更名 `docCommitOk`：pathspec 全为豁免文档 + 主题行合规；混入源码 / runtime 数据、
  无 pathspec、`--amend`、glob / magic 前缀等不可静态核验形态仍拦。
- 豁免清单按守卫进程内缓存（每次工具调用一个进程，无跨调用失效问题；
  `v.customDocs` 增删后下一次工具调用即生效——联动无需主动失效）。

## 不回归面

- README.md 既有豁免（REQ-20260918-002）与条目目录文档讨论轮通道（REQ-20260917-002）不变。
- 源码认领锁保护、runtime/status 直写拦截、人工状态命令 / 接口拦截不变。
- 有锁路径行为不变（豁免只放开「无锁放行」方向，不引入新拒绝路径）。
