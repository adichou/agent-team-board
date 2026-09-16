# 设计 — BUG-20260915-003 提交确认面板计数与核验不一致、缺少待提交差异且 Git 错误被截断

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260914-001（自动提交不完整时挂起条目并暂停队列，人工确认后恢复开发；经 `atb list` 核验存在，状态 done）。挂起确认卡片/侧拉面板、清单计数（取自动提交回执字段）与「重新核验」（取快照归因扫描）两套口径、差异展示与错误透传均由该需求引入。
- BUG-20260914-020 仅为暴露现场（README 已声明不据此认定引入来源）。

## 根因分析

1. **计数口径分裂**：`declareCommitConfirm`（scripts/lib/confirm-store.mjs）把「待人工」计数绑定在自动提交回执的 `pendingManual` / `heldGroups` 字段上，而 `verifyCommitConfirm` → `remainingOf` → `attributablePathsForRun`（scripts/lib/git-flow.mjs）用「预留快照 → 现在」差集实时重算。`autoCommitForRun` 在 git add/commit 失败时返回 `{status:'failed', commits, reason}`，**不携带** `pendingManual`/`heldGroups` → 声明记录两者为空 → 面板「待人工 0 路径」，核验却报「仍有 11 个本单路径未入库」。
2. **候选文件与差异缺失**：`confirmDetail.files` 只由声明记录的 `pendingManual`+暂扣组构成；为空时面板无文件清单，用户无从核对差异。
3. **归属混同**：核验/补交把看板共享与全局文件（config.json、dispatch/settings.json 等）与本单路径合并为「本单路径」，确认补交 `supplementCommitForRun` 静默整批提交全部看板差集——文件级差异可能混有其他任务/系统写入，不能只因出现在差集中就归为本单。
4. **错误截断且无处可查**：`autoCommitForRun` 失败原因截断 160/200 字（仓库绝对路径处被截断）；且 0 组提交失败时 `writeAutoCommitLedger` 根本不被调用，`auto-commit.json` 明细缺失，原始错误无日志可回溯。

## 方案

单一候选范围扫描（替代 `attributablePathsForRun`，成为核验/补交唯一口径）：`confirmScopeForRun` 以「预留快照差集 + 当前 porcelain」把候选路径分为——

- **本单可归属（own）**：条目目录内路径；非看板路径中快照差集确定性归因（状态码变化 / 未跟踪内容哈希变化）的路径。变更类型（修改/新增/删除）由 porcelain XY 码推导。
- **归属待确认（undetermined）**：看板共享/全局文件（看板前缀且非本条目目录——即使差集显示本单期间有改动，文件级差异仍可能混有系统计数器、其他任务写入）；非看板「预留前已脏且本单动过」路径（原 pendingManual）。
- 其他条目目录路径仍排除（不越权收纳）。

分层修复：

1. **git-flow.mjs**
   - 自动提交失败：`autoCommitForRun` 返回值保留已归因的 `pendingManual`/`heldGroups` 与**不截断**的 `errorFull`（≤4000 字）；0 组提交失败也落 `auto-commit.json` 明细（status=failed + errorFull），原始错误可用于诊断。
   - `supplementCommitForRun` 改用统一范围扫描，并接受 `include`（归属待确认中明确计入的路径）：只提交「本单可归属 + 已计入的归属待确认」；`attributablePathsForRun` 移除（避免双口径复活）。
2. **confirm-store.mjs**
   - `declareCommitConfirm`：指纹覆盖全候选（声明扫描）；`status=failed` 时记录 `error:{summary, full}`（full 缺失=历史截断，如实标信息不足）。
   - `verifyCommitConfirm`：改用统一范围出原因（「仍有 N 个候选路径未入库（本单可归属 A · 归属待确认 B）」+ 归属待确认需人工选择）；核验后把指纹基线刷新为当前内容（重新核验=人工重新核对，其后确认绑定最新所见）。
   - `confirmCommitContinue`：接受 `include`（归属待确认显式选择；缺省兼容旧闭环=仅默认计入已声明 pendingManual/暂扣路径，全局文件不静默并入）；出现声明后新增的归属待确认路径 → 拦截要求先重新核验；完整性复验只按「本单可归属 + 已计入」范围。
   - 卡片/清单/详情（`viewRecord`/`confirmDetail`）：`pendingCount` 与文件表改用同一实时范围（带分组与变更类型）；无法扫描（非 git / 缺快照 / run 缺失）→ `pendingCount:null`（呈现「待核对」，不显示误导性 0）。
3. **server.mjs**：`/continue` 透传 `include`；`/diff` 区分「读取失败」（fileDiffText 返回 null → 500 + 明确错误，可重试）与「无差异」（200 空串）。
4. **Web 面板（app.js/style.css/i18n.js）**：卡片与面板计数行统一口径（待提交 N 路径（本单可归属 A · 归属待确认 B））；Git 失败错误块（摘要行 + 可折叠全文 + 复制；历史截断无原始日志时明确说明信息不足）；按归属分组的文件表（列：文件/变更类型/状态/差异/归属处理，归属待确认行须显式「计入本次补交 / 排除」）；差异读取失败显示错误 + 重试（不冒充无差异）；无候选时空态「无待提交文件：全部路径已入库」；确认范围摘要（提交前展示实际将提交的文件）；「重新核验」注明只检查、「确认并继续」注明补交+测试+恢复队列；确认被指纹/新增待确认路径拦截后要求先重新核验。新增文案同步 i18n 词典（覆盖卡点测试）。

**开源选型（REQ-20260909-015）**：未引入开源库。理由：本修复是既有自研提交流程（git-flow / confirm-store / 自建 Web 面板）内的小范围口径统一与展示修正，全部基于 Node 内建（child_process/fs）与现有代码路径，无对应成熟第三方库可替代；不创建 licenses.md。

## 风险与边界

- 不通过本 Bug 解除 BUG-20260914-020 挂起，不代替人工确认提交或验收；确认仍只输出「已确认恢复」，验收走既有「确认完成」。
- 兼容：CLI / 旧调用未携带 `include` 时，默认只并入已声明（pendingManual/暂扣）路径——REQ-20260914-001 的 C05/C08 闭环不回退；全局文件默认排除（不再静默整批并入），如需并入走面板显式选择。
- confirm-block-20260914-001 C11（清单/详情计数一致）断言更新为「与实时范围同源」口径——原断言绑定声明字段正是本 Bug 的缺陷口径。
- `run.json` 缺失或非 git / 无快照时计数显示「待核对」并回退声明字段口径，不再出现误导性 0。
- 核验仍同步跑测试（耗时问题归 BUG-20260915-008，不在本单处理）。
