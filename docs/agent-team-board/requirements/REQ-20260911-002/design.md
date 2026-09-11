# 设计 — REQ-20260911-002 营销和发布模块隐藏

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

「营销」「发布」两个模块需要**暂态隐藏**（不是功能删除），口径与 REQ-20260909-013（讨论 / 文件模块暂隐藏）一致：仅让两个模块在界面上不可见、不可达；营销档案、渠道 / 实验 / 行动、指标 / 复盘、发布运行等数据与全部服务端接口保留不动，以低成本可恢复的方式实现。

## 方案

**沿用 REQ-20260909-013 的单一开关集中门控**：`scripts/web/app.js` 的 `HIDDEN_VIEWS` 集合扩展为
`new Set(['oncall', 'files', 'marketing', 'release'])`，所有收敛点读取该开关做「门控」而非「删除」：

| 收敛点 | 位置 | 行为 |
| ---- | ---- | ---- |
| 顶栏模块导航 | index.html `.module-nav` | 移除「营销」「发布」两个 `<button>`（收敛为 需求/任务/设置；无空占位，「设置」保持行末 `nav-extra` 辅助入口） |
| 旧深链 / 快照 / 残余入口 | app.js `setView` | `HIDDEN_VIEWS.has(v)` 兜底回落 `status` + 按模块名一次性 toast（新增 `HIDDEN_VIEW_LABEL` 名单，含 oncall / files / marketing / release）；URL 经 `syncProjectUrl` 按回落模块重写（view 参数清理、project 等保留），无空白视图 |
| 刷新快照恢复 | app.js `applyViewSnapshot` | 沿用现状：`snap.view` 为 marketing / release 时经 `setView` 兜底回落需求；`snap.marketing` / `snap.release` 子状态仍按现状交给 `ATBMarketing.restoreView` / `ATBRelease.restoreView` 暂存（纯内存暂存、不发请求、不删键、不做快照版本迁移——子状态随正常浏览按现状机制自然重建） |
| 隐藏模块 UI 文案 | app.js `MODULE_SUB` | marketing / release 两键移出（沿用 oncall / files 先例；`updatePageHead` / 搜索显隐中的营销 / 发布分支为不可达死配置，随模块代码保留） |
| 模块网络面 | `marketing.js` / `release.js` | 不加载入口即无 `enter`、无 `pollTimer` 轮询，全流程不出现 `/api/marketing/*` 与 `/api/release/*` 请求（boot / poll 主链路本就不含两模块） |

**零改动面**：`scripts/server.mjs` 全部 `/api/marketing/*` 与 `/api/release/*` 路由、`marketing.js` / `release.js` 源文件、`#marketingView` / `#releaseView` 容器与 index.html 脚本引用、`docs/agent-team-board/marketing/` 与 `releases/` 数据目录、全部 status.json 均不触碰；不写任何 status.json。

**开源选型（REQ-20260909-015）**：本项为纯界面开关收敛（既有 HIDDEN_VIEWS 机制扩展），无新增依赖、无引入开源库——无合适库的原因：需求本身是对自有代码的开关门控，不涉及第三方能力；未创建条目 licenses.md。

### 待确认项裁定（开发阶段，供人工复核）

1. **`MODULE_SUB` 两键**（README 待确认 2）：沿用 oncall / files 先例**随入口移出**，恢复时按下方恢复步骤加回（release 副标题保持 BUG-20260911-002 通用文案，不回退渠道枚举口径）。
2. **未保存表单草稿**（待确认 3）：不做额外提示——草稿仅存内存、不进快照属既有边界（刷新本就会丢失）；隐藏期间无法再进入营销模块属预期，恢复后重建。
3. **发布轮询与进行中 run**（待确认 4）：接受——`pollTimer` 仅在进入模块后调度，隐藏期间无轮询无网络请求；服务端 run 执行不受 UI 隐藏影响。
4. **快照兼容**（待确认 5）：沿用现状机制——旧快照 `snap.view` 经 `setView` 兜底回落；不做快照版本迁移，恢复开关后旧快照结构直接兼容。

## 恢复步骤（暂态可逆）

1. `scripts/web/app.js`：`const HIDDEN_VIEWS = new Set(['oncall', 'files', 'marketing', 'release']);` → 移除 `'marketing'` 与 `'release'` 两键（`HIDDEN_VIEW_LABEL` 中两键保留，无需改动）。
2. `scripts/web/index.html`：`.module-nav` 内加回两个按钮（营销在「任务」后、发布在「营销」后，均 `class="view-tab"`）：
   `<button type="button" class="view-tab" data-view="marketing">营销</button>`、
   `<button type="button" class="view-tab" data-view="release">发布</button>`。
3. `scripts/web/app.js`：`MODULE_SUB` 加回两键（含行内溯源注释）：
   `marketing: '项目营销档案：定位、证据与定价版本', // REQ-20260910-019`、
   `release: '构建与发布流程：预检 → 计划确认 → 执行 → 核验', // REQ-20260910-029 / BUG-20260911-002 通用化：不枚举渠道（目标能力由目标选择器表达）`。
4. 既有测试中被更新口径的断言（workbench-layout W2、hide-modules-20260909-013 H1、marketing-ui U1、marketing-serve H7、release-ui U1、layout-topbar-rail T3、release-sub-generic C1/C3、global-entry-panel B2、revert-ci-board T2）按 git 历史还原口径；`hide-marketing-release-20260911-002.test.mjs` 同步反转。

其余机制（`setView` 容器切换、`ATBMarketing.enter` / `ATBRelease.enter` 激活、`saveViewSnapshot` 快照节、`atb:marketing-state` / `atb:release-state` 事件、模块全部逻辑）均未删除，开关一开即恢复。

## 风险与边界

- **风险：开关外散落入口漏收敛**。已在 README「间接入口盘点」逐条核对：全网页源码无 `data-goto-view="marketing"` / `"release"` 跨模块跳转、无键盘快捷键、详情抽屉与统一新建无指向两模块的入口；残余未知入口即便触发 `setView('marketing'|'release')` 也会被兜底回落（防御纵深），并在 `hide-marketing-release-20260911-002.test.mjs` 以行为测试锁定（M2/M3）。
- **风险：旧会话快照含隐藏模块态**。`setView` 兜底回落 + 无空白视图、无控制台报错；快照子状态不做破坏性清理（M5）。
- **边界：`saveViewSnapshot` 与 `applyViewSnapshot` 的 marketing / release 节保留不门控**——restoreView 纯内存暂存、不发请求（保存浏览态无害），恢复后即接续。
- **边界：不引入运行时配置 / localStorage 开关**——避免半恢复中间态，恢复以一次代码变更为单位整体生效。
- **人工核对清单**（自动化未覆盖的验收项）：深浅色两种外观下导航行无被隐藏入口空占位、无残留样式；浏览器实测 `?view=marketing` / `?view=release` 回落与一次性提示、网络面板确认全流程无 `/api/marketing/*`、`/api/release/*` 请求；`curl` 抽查 `/api/marketing/state`、`/api/release/state`（带 project 参数）仍可用。
