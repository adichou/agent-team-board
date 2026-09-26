# 设计 — BUG-20260926-003 发布隔离分析将标题引用单号误判为混合归属，祖先提交统称依赖导致一键纳入受阻

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260921-015（「一键加入所有依赖提交」的归因反查直接复用 REQ-20260911-010 的 `itemCommitStatusIndex` 按「主题含单号即关联」的宽口径，未区分标题引用与实际归属；两个单号均已核验存在于本看板）

## 根因分析

代码定位（修复阶段请以最新代码为准复核）：

1. `scripts/lib/git-flow.mjs` `itemCommitStatusIndex`（正向索引）：git 历史侧对每条提交主题做 `subject.match(/(?:REQ|BUG)-\d{8}-\d{3,}/g)`，主题中出现的**任何**单号都建立关联（注释明言「一个 commit 消息含多个单号时自然关联多条目」），与提交账本（`committedItemIndex` 经核验记录）同权合并——主题正文的引用单号与末尾归属单号不区分。
2. `scripts/server.mjs` `/api/build/version/add-dependencies`（一键加入端点）：把上述索引翻转为 commit → 条目集合做归因反查；`owners.size > 1` 即跳过「混合提交（关联 …），无法安全归因」，这正是 12 个标题引用型提交被误判的直接原因； owners 为空 / 条目不在看板 / 非 done 分别得到另外两类跳过原因。
3. 提交规范「类型: 描述 单号」的单号在主题末尾（`scripts/lib/commit-store.mjs` 校验），正文中出现的其他单号多为引用而非归属（实例：81bec844 只改 REQ-20260921-012 条目文档却引用 REQ-20260921-010；176c37c2 开头引用旧 Bug BUG-20260920-006、末尾归属 BUG-20260921-003）。
4. 分析与展示层（`scripts/lib/build-git.mjs` `analyzePublishIsolation` + `scripts/web/build.js` `renderMergePane`）把全部「目标分支可达之外、又不属于所选集合」的祖先统称「未选祖先（依赖）提交」，未区分真实内容依赖与纯讨论 / 删除文档（如 15b06de7 仅新增 submitted 条目 REQ-20260921-009 的讨论文档），措辞暗示一切祖先都是必须纳入的功能依赖。

## 方案

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界

## 实现方案（实施阶段补充，BUG-20260926-003）

未引入开源库（纯 Node 标准库逻辑调整，无合适现成库；见 AGENTS.md 开源选型口径）。

1. **归因证据链**（`scripts/server.mjs` add-dependencies + `scripts/lib/git-flow.mjs` 两个新助手）：
   - （a）提交账本优先：`committedItemIndex`（report 收口 / 自动提交经核验归属）命中即定归属（账本多单号 → 真实混合）；git-flow 复导出该索引，服务端分层口径不变（REQ-20260911-010）。
   - （b）主题归属单号：`subjectAttributionItemId(subject)` 取「括号外最后一个单号」——覆盖规范主题（末尾单号），兼容标题自带括号引用的收口提交；正文 / 括号内引用不算归属。
   - （c）变更路径兜底：`commitPathItemOwners(root, hash)` 用 `git diff-tree --name-only` 统计变更命中的条目目录（`<板根>/data/requirements|bugs/<单号>/`，兼容旧布局前缀）；仅触及单一条目目录且账本 / 主题均缺时兜底归属。
   - **混合判定收窄**：仅「账本多单号」或「变更同时触及多个条目目录」判混合（`混合提交（…），无法安全归因`）；标题正文引用单号不再误判。旧宽口径 `itemCommitStatusIndex`（主题含单号即关联）保留给「已提交」徽标与候选发现，不再用于归因。
2. **展示措辞**（`scripts/web/build.js` + `scripts/web/i18n.js`）：合并页隔离分析不再把未选祖先统称「依赖」——汇总行「发现 N 个未选祖先提交 · 影响 M 个所选条目」、按钮「一键加入所有未选祖先提交」、明细「查看未选祖先明细 / 为 X 的未选祖先」、跳过清单「⚠ 以下 N 个未选祖先提交未能纳入：」、toast 全组同步；空态句「所选提交无未选祖先：变更可独立进入主分支。」原样保留。i18n EN / EN_DYNAMIC 词条同改（BUG-20260912-001 口径），旧「依赖」词条移除。
3. **不回退项**：done 纳入门禁、条目不在看板 / 尚未完成跳过原因如实保留；merging / 已正式发布 409 锁定、scopeStale 联动、按提交补入（appendItemCommits）与合并执行 / 包含性校验口径均未动。
