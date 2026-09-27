# 设计 — REQ-20260927-001 只需需求或 bug 创建时同步提交到 git。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

创建通道（终端 `atb new`、网页端 `POST /api/new`、值班批量登记 `oncall.createItems`、
营销「创建开发需求」`marketing.linkActivityReq`）最终都走 `core.createItem` 落盘，
落盘后不做任何 git 提交——新条目目录以未跟踪状态留在工作区，Agent 按仓库规则不手工
commit，登记的条目可能长期无版本记录。删除环节已有「删除即留痕」同步提交
（REQ-20260923-004 `gitFlow.commitItemDeletion`），创建环节是留痕空档。

## 方案

### 1. 收口内核：git-flow.mjs 新增 `commitItemCreation`

镜像 `commitItemDeletion`（REQ-20260923-004）的形态与容错口径：

- 签名 `commitItemCreation({ projectRoot, itemId, itemDir })`，返回
  `{ status: 'committed'|'skipped'|'failed', commit, shortHash, reason }`，**永不抛错**。
- 提交内核复用 `commitPaths`（路径分块 `git add -A --` + `git commit --only`）：
  提交内容**仅限条目目录自身**（README / design / test-cases / attachments/），
  绝不卷入工作区其他脏改动；只 commit、不 push、不切分支。
- 提交主题 `doc: 创建条目 <ID>`（`commitSubjectOf('doc', '创建条目', itemId)`）——
  **不含标题**，与删除留痕「删除待接受条目」取舍一致：描述恒 ≤120 字、必过
  `validateCommitSubject`，且 subject 形态确定、可被 rebuild 精确识别（见 §3）。
- skipped 场景：非 git 仓库；条目目录不在当前 git 仓库内；条目目录已不存在
  （创建失败回滚残留防御，`existsSync` 前置检查）；条目目录无 git 差异
  （如 data/ 被 .gitignore 忽略）——不产生空提交。
- failed 场景：提交失败（index.lock 等）不阻断创建、不回滚条目目录，reason 携带
  人工补提交指引（消息含单号，对齐删除留痕）；永不静默吞错。

### 2. 通道接线（在 createItem 调用链统一实现，行为一致）

与删除留痕同构：内核收敛在 git-flow，四个创建通道在 `createItem` **成功返回后**调用
（失败 / accept 回滚抛错时不会走到提交调用，天然不产生残留创建提交）：

| 通道 | 接线点 | 回显 |
| ---- | ------ | ---- |
| 终端 `atb new` | `atb.mjs` new 分支，createItem 成功后 | `↳ 已同步提交 <hash7>：主题`（对齐 atb delete 格式）；failed/skipped 分别 `⚠`/`↳` reason；`--json` 增 `gitCommit` 字段 |
| 网页端 `POST /api/new` | `server.mjs`，201 响应体增 `gitCommit` 字段（committed 带 shortHash+subject，否则带 reason），与 `DELETE /api/item/:id` 同构 |
| 批量登记 `oncall.createItems` | 每条在 `patchCreatedItemDocs` + sourceDiscussion 写入**之后**提交（保证来源行等内容一并入库）；逐条结果对象增 `gitCommit` |
| 营销创建 `marketing.linkActivityReq` | createItem 成功后提交；返回值增 `gitCommit` |

不修改 web 前端（app.js）：验收口径为「命令 / 接口回显」，UI 文案不动则 i18n 无涉。

### 3. rebuild 判定冲突消解（README 待确认项收敛）

- **rebuild 误判 done**：创建提交 subject 含单号，会让「仅创建过」的条目被 rebuild 误判
  done。消解方案取「rebuild 排除创建/删除类 doc 留痕提交」：git-flow 导出
  `isItemTraceCommitSubject(subject)`（精确匹配 `doc: 创建条目 <ID>` /
  `doc: 删除待接受条目 <ID>`），`rebuild.mjs` 的依据提交与 done 判定改为
  「历史中存在**非留痕**提交含该单号」（basis 扫描新→旧首个命中；note 如实注明
  「仅有创建/删除留痕提交」）。开发收口提交、正文含单号提交等其他形态判定不变
  （兼容 REQ-20260918-003 既有用例：主题含单号、正文含单号均仍判 done）。
- **commits 账本**：创建提交**不写** commits 账本（`committedItemIndex`），与删除留痕
  同口径——账本语义是「开发到待测试自动提交 / 人工批量 commit」，创建留痕不是收口；
  `atb commit log <ID>` 经 git 历史消息扫描仍可检索到创建提交（验收口径满足）。
- **看板「已提交」徽标**：`itemCommitStatusIndex` 宽口径（主题含单号即关联）自然收录
  创建提交——条目自诞生即显示版本记录，与本需求目标一致，不改代码。
- **收口幂等交互（REQ-20260914-001）**：`autoCommitForRun` 的 `itemCommittedInGit`
  幂等跳过仅在「历史含单号且无可归因改动」时生效；创建提交入历史后，只要预留快照
  以来仍有本单差集，仍按差集归因提交源码/测试/条目文档——口径不变，测试覆盖此交互。
- **「创建并接受」与失败回滚**：提交调用位于 createItem 成功返回之后；accept 环节
  失败回滚删目录时 createItem 抛错，通道不调用提交，无残留半截创建提交。
- **不做**：不自动 push；不改状态机；不改 report 收口提交口径；不引入开源依赖
  （纯 Node 内置能力，无 licenses.md）。

## 风险与边界

- 提交失败（index.lock、钩子）不阻断创建：条目照常落盘，差异留工作区，reason 指引
  人工补提交；重试幂等由「无差异即 skipped」保证，不产生空提交。
- `atb new` 的 `projectRoot` 传 CLI `cwd`、server 传服务根、库内两处传
  `projectRootOfBoard(dataDir)`——与删除留痕同参口径；仓库根经
  `rev-parse --show-toplevel` 定位，条目目录在仓库外一律 skipped。
- 创建提交使新条目目录即刻被跟踪：后续收口差集归因（快照基线）不受影响；删除该
  submitted 条目时删除留痕从「无差异 skipped」变为正常产生删除提交（行为更正确）。
- 旧仓库兼容：历史中已有的创建/删除留痕主题（本需求上线后才会出现）不影响存量判定。
