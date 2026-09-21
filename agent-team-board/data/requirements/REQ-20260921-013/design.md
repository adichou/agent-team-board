# 设计 — REQ-20260921-013 AI 完善按钮移动到版本详细内容的版本计划页签内。版本计划页签改名为概况

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

「AI 完善」入口此前位于左侧每张版本卡片（BUG-20260913-004 迁入），与右侧详情展示的信息分离；
详情第一个页签沿用五步流程初版的「版本计划」名称，与模块外层导航「版本计划」同名易混。

## 方案

纯前端改动（既有模式内实现，不引入开源库；未使用第三方依赖故不建 licenses.md）：

- `scripts/web/build.js`
  - `STEP_LABEL.plan`：'版本计划' → '概况'。仅改显示名：内部步骤标识 `plan`、五步顺序、
    快照恢复（snapshot/restoreView 只认 key）、`setStep`、后端 `PUBLISH_STEPS`（publish-flow.mjs
    按 key 供给门禁）全部不动；模块外层 `TABS`「版本计划 / 分支浏览」不受影响。
  - `renderVersionList`：移除卡片 `answerBtn`（连同仅服务它的 `vPushed` / `answerLocked` 局部量），
    其余四键（合并入 main / 创建并预检 / 查看发布记录 / 删除）原位保留。
  - `renderDetail` → `planBody`：顶部新增 `bld-plan-acts` 操作行（右对齐、窄屏可换行），
    内含唯一「AI 完善」按钮，`data-ver-answer` 绑定当前选中版本 id；锁定口径原样迁移
    （BUG-20260920-005 基准：merging 禁用「合并中，请稍候……」、推送完成即正式发布禁用
    「已正式发布，不允许再 AI 完善」、merged 未推送可用）。`openAnswerModal(verId)` /
    绑定循环 `view.querySelectorAll('[data-ver-answer]')` 零改动——按钮仍在 `#buildView` 内，
    切版本后重新渲染即换绑，弹窗在途数据始终与 verId 绑定，不串单。
- `scripts/web/style.css`：新增 `.bld-plan-acts`（flex 右对齐 + wrap，窄屏不遮挡信息与导航）。
- `scripts/web/i18n.js`：'概况'（Overview）已有词条复用；补登记按钮 title 两条
  （'合并中，请稍候……'、'复制提示词给 Agent，回答直接粘贴回本弹窗自动解析'，此前缺词条）。

### 草稿互斥（README「待确认」项的落地方径）

不引入互斥锁：AI 完善弹窗（`state.answer`）与概况就地编辑表单（`state.planEdit`）是两个独立
UI 状态，弹窗覆盖在详情之上、互不关闭对方；重渲染前 `syncPlanEditDraft()` / `syncAnswerDraft()`
把未保存输入回写 state，任何一侧的打开 / 关闭 / 应用失败都不会静默覆盖另一侧草稿
（测试 T7 覆盖）。应用成功走既有 `saveInfo`，与手动编辑同一保存通道与权限。

## 测试

- 新增 `scripts/tests/req-20260921-013.test.mjs`（T1–T9：改名与兼容、卡片移除、概况入口与
  步骤隔离、切版本换绑、锁定口径、直调守卫、草稿共存、空态、i18n）。
- 既有断言卡片 AI 完善的回归测试按新入口位置适配（口径不变）：
  `bug-build-ver-card-acts-20260913-004.test.mjs`（B1/B2/B4）、`bug-20260920-005.test.mjs`（U1）、
  `build-ui.test.mjs`（N9a 顺序）、`build-release-card-items-search-20260915-003.test.mjs`（R1 顺序）。

## 风险与边界

- 全量回归中 `req-20260918-002` / `req-doc-entry-20260916-003` 两文件失败为**预存失败**：
  工作区存在发布文档流水线（BLD-20260920-001 待发布 README/CHANGELOG/FEATURES）的未提交改动，
  两测试断言旧 README 结构；已在 HEAD 干净版本上验证通过，与本单改动（零交集文件）无关。
- 后端 `PUBLISH_STEPS` 的 plan 步 label 仍为「版本计划」，仅出现在门禁 reason 文案上下文，
  前端页签名已不依赖后端 label（自行 `STEP_LABEL` 渲染），不动后端避免影响服务端测试契约。
