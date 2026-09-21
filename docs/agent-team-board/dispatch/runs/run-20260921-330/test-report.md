# 测试报告 — REQ-20260921-014 版本计划详细内容页面中的概况页签增加修改功能（run-20260921-330）

- 日期：2026-09-21　执行：zcode-batch-060-4（批次 batch-20260921-060）
- 新增测试：`scripts/tests/build-plan-edit-req-20260921-014.test.mjs`（TDD 先红后绿，10 例
  E1~E10；实现前 10/10 跑红，实现后 10/10 跑绿；输出见同目录 test-output.log）
  - E1 显式入口与表单预填：概况页签（详情第 1 步「版本计划」）显式可见「编辑」按钮；
    空描述占位「（无描述）」；点开就地出表单（名称 input + 描述 textarea 预填当前值 +
    字数计数器 N / 80、N / 4000 + 保存 / 取消），焦点落名称输入框，不弹窗不跳步；
  - E2 客户端校验就地拦截不发请求：名称 trim 为空 →「版本名称不能为空」；名称 81 字 →
    「版本名称不超过 80 字」；描述 4001 字 →「版本描述不超过 4000 字」；改回合法值可保存；
  - E3 保存成功：名称与描述同一请求提交（/api/build/version/save 带 id + name + description）；
    退出编辑态；详情头部 / 概况页签 / 左侧版本列表名称同步刷新；toast「✓ 已保存版本信息」；
  - E4 保存失败（含 merging 409「版本合并中，暂不可修改」）：toast「✕ 保存失败：<原因>」+
    就地原因；表单与所填内容保留；修改后重试成功；
  - E5 保存中防重复：按钮「保存中…」且禁用、取消键禁用；连点只发一次请求；
  - E6 取消放弃修改回展示态；切换版本 / 步骤 / 项目编辑态重置为展示态、任何切换不误保存
    （同一步骤重复点击不丢草稿）；
  - E7 merging 锁定：编辑按钮 disabled + title「版本合并中，暂不可修改」（文字 + 禁用态，
    不只靠颜色）；遗留行内点击入口同样收口不进编辑并 toast 原因；
  - E8 后台重渲染（refresh）不冲掉表单未保存草稿（输入即时回写 + render 回同步双保险）；
  - E9 纯函数 validateVersionInfo：空白 / 空名称、80/81 与 4000/4001 边界、出错字段归因
    （name / desc）、合法输入返回 null（镜像 build-store validateInfo 口径）；
  - E10 i18n 同步（BUG-20260912-001）：新增词条（版本名称 / 版本描述 / 校验 / 锁定 / 成功
    toast /（无描述）/ 编辑版本信息）与欠账（点击编辑名称 / 点击编辑描述、✕ 保存失败：◇）
    入 EN / EN_DYNAMIC；旧键「（无描述，点击补充）」随占位更名清理。

## 实现范围

- `scripts/web/build.js`：概况页签显式编辑——state.planEdit 编辑态（按版本 id 归属）；
  openPlanEdit / cancelPlanEdit / submitPlanEdit / syncPlanEditDraft 行为接缝与
  validateVersionInfo 纯校验（导出供测试）；renderPlanEditForm 就地表单（复用 .field /
  .bld-edit-form 骨架）；描述块头部行显式「编辑」按钮（merging 禁用 + title 文字原因）；
  切换版本 / 步骤 / 项目重置编辑态不误保存；render(syncModalDrafts) 增补 planEdit 草稿回同步；
  遗留行内点击编辑保留（并存，design.md 落定）并在 merging 下与显式入口同口径收口；
  空描述占位更名「（无描述）」。
- `scripts/web/i18n.js`：EN 词条 11 条 + EN_DYNAMIC 1 条（见 E10），值唯一性 / 键规范经
  i18n-dict / i18n-coverage / i18n-runtime 测试校验。
- `scripts/web/style.css`：.bld-desc-block-head / .bld-plan-edit / .bld-plan-count（深浅色沿用
  既有 CSS 变量，窄屏 flex-wrap 纵向堆叠）。
- 后端无改动：POST /api/build/version/save 既有能力（名称 + 描述同请求、NAME_MAX/DESC_MAX
  校验、merging 409 锁定）直接复用；design.md 已记录入口并存、范围沿用现状（仅 merging
  锁定）、自研选型理由。

## 全量回归

- `npm test`（= node scripts/tests/run-all.mjs）：311 个测试文件，失败 0（含 i18n 全套、
  build-ui / build-serve / build-store / req-20260920-003 等构建模块既有测试，验证五步导航、
  AI 完善弹窗表单（REQ-20260913-006）、创建 / 添加面板、合并 / 删除等既有能力零回归）。
