# 测试用例 — BUG-20260928-012 发布页面取消草稿模块

自动化：`scripts/tests/bug-20260928-012.test.mjs`（vm 假 DOM 口径同 build-ui.test.mjs /
bug-20260928-002.test.mjs），另按新口径更新 `bug-20260928-002.test.mjs` 与
`bug-release-tab-inplace-20260915-014.test.mjs` 的受影响断言。

## M1 模块删除（验收 1 / 4）

- M1a 草稿态运行存在时：发布页签不渲染发布记录列表（无 `aria-label="发布记录"`、无 `data-rel-run`
  卡片）与运行详情（无 `aria-label="运行详情"`），无 `Web App [object Object]` 一类摘要；页面无
  「取消草稿」/ 取消后续阶段入口（无 `data-rel-act`）。
- M1b 运行详情既有动作入口整体移除：`data-rel-act="precheck" / "refreeze" / "plan" / "cancel" /
  "refresh"`、`data-rel-detail-retry`、`data-publish-open`、`#bldRelPlanCancel / #bldRelPlanConfirm`
  不再渲染；build.js 无 `renderRelDetailPane` / `relAction` / `openRelPlan` / `confirmRelStart` /
  `selectReleaseRun` / `openPublishDirectory` 残留。
- M1c release.js 摘要按状态标签渲染：`TARGET_STATUS_LABEL[r.targets?.webapp?.status] || '未提供'`，
  不再把 targets 对象当字符串拼接（全局检索无 `[object Object]` 展示路径）。

## M2 发布直线流程（验收 2 / 3）

- M2a 点击「发布」（有版本号）：弹「发布前检查」弹窗并自动执行检查（from-build → precheck），
  期间「发布」按钮禁用显示「发布中…」；检查全部通过后弹窗转为二次确认（列检查项 +
  「即将发布版本 v1.2.0。」）；未确认前不发出 start。
- M2b 检查未通过：弹窗列出失败项（label + detail）并明确提示「本次不进入发布」，不进入二次确认、
  不发出 start；关闭弹窗后可重新点击「发布」。
- M2c 二次确认后才执行：确认 → POST start（token = 预检指纹）；执行期间页面无「执行中」/ 阶段进度
  展示，仅按钮「发布中…」禁用。
- M2d 执行结束出结果：succeeded → 成功面板（`✓ 发布成功` + 发布时间本地时区格式化 +
  「（本地时间）」标注）；failed → 失败面板（`✕ 发布失败` + 失败阶段与错误信息 + 「重试」按钮）。
- M2e 重试：失败面板点「重试」重新走同一发布流程（重新检查 → 二次确认 → 执行），可再次到达结果态。
- M2f 存量计划无 version 字段：先弹发行版本号补填；空值确认提示且不发任何执行请求；填写后进入检查。
- M2g 防重复：检查 / 执行 busy 中重复确认不产生第二组请求；busy 中取消 / 遮罩 / Esc 不关闭弹窗。
- M2h 检查或执行请求失败（如创建 409 / start 失败）：链路中止，就近 role=alert 反馈服务端原因。
- M2i 草稿复用口径不变：同发行版本号存在可续跑（draft/failed/canceled）运行时不重复创建，
  直接对其预检；版本号不匹配则新建。
- M2j 进入发布步发现既有 running 运行（恢复场景）：按钮「发布中…」禁用、无中间进度界面，
  轮询结束后直接显示结果面板。

## M3 其余页签与状态（验收 5）

- M3a 空闲（未发布）：显示「尚未发布」直线流程说明；「发布」按钮唯一且可点击（已合并 + 已配置）。
- M3b 禁用口径保留：未合并 / 未配置官网仓库 / 发布中 / 已发布分别禁用并就近说明原因；
  未配置保留「前往设置」。
- M3c 加载 / 读取失败布局正常：加载提示；失败显示原因与只读重试（不发写请求）。
- M3d 构建模块其余页签不受影响（npm test 全量回归）。

## M4 i18n（验收 6）

- M4a 新增静态文案入 EN、含插值句入 EN_DYNAMIC，值不含中文；旧模块删除后不再渲染的词条清理。
